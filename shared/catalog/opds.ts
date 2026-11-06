// Dependency-free OPDS and LitRes normalizers. Network transport stays in the
// platform adapters: custom OPDS feeds are fetched directly by a client and
// LitRes is fetched only through Bookstr's fixed-origin worker.

const ACQUISITION_TYPES = new Map([['application/epub+zip', 'epub'], ['application/pdf', 'pdf']]);

const MAX_PUBLIC_OPDS_FEEDS = 12;
const MAX_FEED_NAME_LENGTH = 80;
type JsonRecord = Record<string, unknown>;
type FeedContext = { provider: string; feedURL: string };
type OPDSLink = { href?: string; type?: string; rel?: string; title?: string; template?: string };
type CatalogRecord = {
  provider: string; recordId: string; publicationId: string; title: string; authors: string[];
  languages: string[]; publishedYear?: string;
  rights: { status: string; license?: string; source: string };
  acquisitions: Array<{ format: string; url: string; availability: string }>;
};
type CatalogRecordInput = Omit<CatalogRecord, 'publicationId'>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

export function isPublicHTTPSURL(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:'
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && isPublicHostname(url.hostname);
  } catch {
    return false;
  }
}

// Only the portable, non-secret part of a custom feed setting is eligible for
// persistence or Nostr synchronization. Keep this deliberately conservative:
// a private network URL should never be synced to another client.
export function normalizePublicOPDSFeeds(value: unknown): Array<{ name: string; url: string }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const feeds = [];
  for (const item of value) {
    const candidate = asRecord(item);
    if (!candidate) continue;
    const name = String(candidate.name || '').replace(/\s+/g, ' ').trim();
    const url = String(candidate.url || '').trim();
    if (!name || name.length > MAX_FEED_NAME_LENGTH || !isPublicHTTPSURL(url)) continue;
    const canonicalURL = new URL(url).href;
    if (seen.has(canonicalURL)) continue;
    seen.add(canonicalURL);
    feeds.push({ name, url: canonicalURL });
    if (feeds.length === MAX_PUBLIC_OPDS_FEEDS) break;
  }
  return feeds;
}

export function normalizeOPDSFeed(feedXML: unknown, options: { provider?: unknown; feedURL?: unknown } = {}) {
  return normalizeOPDS1Feed(feedXML, options);
}

export function normalizeOPDS1Feed(feedXML: unknown, { provider, feedURL }: { provider?: unknown; feedURL?: unknown } = {}): Array<CatalogRecord> {
  const context = validatedContext(provider, feedURL);
  const xml = safeXML(feedXML);
  const entries = xmlEntries(xml);
  return entries.map((entry, index) => recordFromOPDS1Entry(entry, index, context)).filter((item): item is CatalogRecord => item !== null);
}

export function normalizeOPDS2Feed(feedJSON: unknown, { provider, feedURL }: { provider?: unknown; feedURL?: unknown } = {}): Array<CatalogRecord> {
  const context = validatedContext(provider, feedURL);
  const document = asRecord(parseOPDSJSON(feedJSON)) || {};
  const publications = Array.isArray(document.publications)
    ? document.publications as unknown[]
    : Array.isArray(document.items)
      ? document.items as unknown[]
      : [];
  return publications.map((publication: unknown, index: number) => recordFromOPDS2Publication(publication, index, context)).filter((item): item is CatalogRecord => item !== null);
}

// A discovery result includes any acquisitions in the current document plus a
// search URL/template. A caller can fetch an OpenSearch descriptor when
// `search.kind === 'opensearch'`, then pass it to discoverOpenSearchTemplate.
export function discoverOPDSFeed(payload: unknown, { provider, feedURL }: { provider?: unknown; feedURL?: unknown } = {}) {
  const context = validatedContext(provider, feedURL);
  const text = String(payload || '').trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    const document = parseOPDSJSON(text);
    return {
      kind: 'opds2',
      records: normalizeOPDS2Feed(document, context),
      search: opds2SearchLink(document, context.feedURL),
    };
  }
  const xml = safeXML(text);
  return {
    kind: 'opds1',
    records: normalizeOPDS1Feed(xml, context),
    search: opds1SearchLink(xml, context.feedURL),
  };
}

export function discoverOpenSearchTemplate(documentXML: unknown, baseURL: string) {
  const xml = safeXML(documentXML);
  const urls = xmlLinks(xml, 'url');
  const search = urls.find(link => /(?:searchterms|query|q)[^}]*}/i.test(link.template || ''));
  if (!search?.template) return null;
  return {
    kind: 'template',
    href: templateURL(search.template, baseURL),
    type: String(search.type || '').toLowerCase(),
  };
}

export function resolveOPDSSearchURL(search: unknown, query: unknown, baseURL?: string): string | null {
  const searchRecord = asRecord(search);
  const href = typeof search === 'string' ? search : searchRecord ? scalar(searchRecord.href) : '';
  if (!href) return null;
  const resolved = templateURL(href, baseURL);
  const encoded = encodeURIComponent(String(query || '').trim());
  if (!encoded) return resolved;
  if (/\{[?&][^}]+\}/.test(resolved)) {
    return resolved.replace(/\{([?&])([^}]+)\}/g, (_match: string, prefix: string, names: string) => {
      const values = names.split(',').map((name: string) => name.trim()).filter(Boolean)
        .map((name: string, index: number) => `${index || prefix === '&' ? '&' : '?'}${encodeURIComponent(name)}=${encoded}`);
      return values.join('');
    });
  }
  if (/\{(?:searchTerms|query|q)\}/i.test(resolved)) {
    return resolved.replace(/\{(?:searchTerms|query|q)\}/ig, encoded);
  }
  return resolved;
}

// LitRes results are accepted only when the provider sends every required
// piece of evidence: explicitly public-domain, explicitly free, and a direct
// HTTPS EPUB or PDF download. This prevents Bookstr from guessing rights from age,
// title, or a general catalogue landing page.
export function normalizeLitresPublicDomainRecords(payload: unknown): Array<CatalogRecord> {
  const document = typeof payload === 'string' ? parseOPDSJSON(payload) : payload;
  const documentRecord = asRecord(document);
  const candidates = Array.isArray(document) ? document
    : Array.isArray(documentRecord?.records) ? documentRecord.records as unknown[]
      : Array.isArray(documentRecord?.results) ? documentRecord.results as unknown[]
        : Array.isArray(documentRecord?.items) ? documentRecord.items as unknown[]
          : [];
  return candidates.map((item: unknown, index: number) => litResRecord(item, index)).filter((item): item is CatalogRecord => item !== null);
}

function validatedContext(provider: unknown, feedURL: unknown): FeedContext {
  const normalizedProvider = String(provider || '').trim();
  if (!normalizedProvider || !isPublicHTTPSURL(feedURL)) {
    throw new Error('OPDS source must have a provider id and public HTTPS URL');
  }
  return { provider: normalizedProvider, feedURL: new URL(String(feedURL)).href };
}

function isPublicHostname(value: unknown): boolean {
  const hostname = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1' || /^(?:fc|fd|fe80):/i.test(hostname)) return false;
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return true;
  const parts = (ipv4.slice(1) as [string, string, string, string]).map(Number) as [number, number, number, number];
  if (parts.some(part => part > 255)) return false;
  return !(parts[0] === 0 || parts[0] === 10 || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168));
}

function safeXML(value: unknown): string {
  if (typeof value !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('Invalid OPDS XML');
  return value;
}

function parseOPDSJSON(value: unknown): unknown {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch {
    throw new Error('Invalid OPDS JSON');
  }
}

function xmlEntries(xml: string): string[] {
  return [...xml.matchAll(/<(?:[\w.-]+:)?entry\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?entry\s*>/gi)].map(match => match[1] as string);
}

function xmlLinks(xml: string, tagName = 'link'): OPDSLink[] {
  const escaped = escapeRegExp(tagName);
  const expression = new RegExp(`<(?:[\\w.-]+:)?${escaped}\\b([^>]*?)(?:\\/\\s*>|>)`, 'gi');
  return [...xml.matchAll(expression)].map(match => attributes(match[1] as string));
}

function xmlValue(xml: string, name: string): string {
  const localName = escapeRegExp(String(name).split(':').pop());
  const expression = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}\\s*>`, 'i');
  return decodeXML(((xml.match(expression) || [])[1] as string) || '').trim();
}

function xmlValues(xml: string, name: string): string[] {
  const localName = escapeRegExp(String(name).split(':').pop());
  const expression = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}\\s*>`, 'gi');
  return [...xml.matchAll(expression)].map(match => decodeXML(match[1] as string).trim()).filter(Boolean);
}

function recordFromOPDS1Entry(entry: string, index: number, context: FeedContext): CatalogRecord | null {
  const links = xmlLinks(entry);
  const acquisition = links.find(link => isReadableLink(link, context.feedURL));
  if (!acquisition) return null;
  const id = xmlValue(entry, 'id') || acquisition.href || String(index + 1);
  const authorBlocks = [...entry.matchAll(/<(?:[\w.-]+:)?author\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?author\s*>/gi)].map(match => match[1] as string);
  const authors = authorBlocks.flatMap(author => xmlValues(author, 'name'));
  const language = xmlValue(entry, 'language');
  const rights = xmlValue(entry, 'rights');
  return makeRecord({
    provider: context.provider,
    recordId: id,
    title: xmlValue(entry, 'title') || 'Untitled',
    authors,
    languages: languagesFrom(language),
    publishedYear: yearFrom(xmlValue(entry, 'issued') || xmlValue(entry, 'published')),
    rights: rightsRecord(rights, context.provider),
    acquisitions: [acquisitionRecord(acquisition, context.feedURL)],
  });
}

function recordFromOPDS2Publication(value: unknown, index: number, context: FeedContext): CatalogRecord | null {
  const publication = asRecord(value);
  if (!publication) return null;
  const metadata = asRecord(publication.metadata) || publication;
  const links = objectLinks(publication);
  const acquisition = links.find(link => isReadableLink(link, context.feedURL));
  if (!acquisition) return null;
  const recordId = scalar(metadata.identifier || metadata.id || publication.id || acquisition.href || index + 1);
  const title = scalar(metadata.title || publication.title || 'Untitled');
  const authors = people(metadata.author || metadata.authors || metadata.creator || publication.author);
  const language = metadata.language || metadata.languages || publication.language;
  const rightsEvidence = scalar(metadata.rights || metadata.license || publication.rights || publication.license);
  return makeRecord({
    provider: context.provider,
    recordId,
    title,
    authors,
    languages: languagesFrom(language),
    publishedYear: yearFrom(metadata.published || metadata.modified || publication.published),
    rights: rightsRecord(rightsEvidence, context.provider),
    acquisitions: [acquisitionRecord(acquisition, context.feedURL)],
  });
}

function makeRecord({ provider, recordId, title, authors, languages, publishedYear, rights, acquisitions }: CatalogRecordInput): CatalogRecord | null {
  const id = String(recordId || '').trim();
  if (!id || !acquisitions.length) return null;
  return {
    provider,
    recordId: id,
    publicationId: `${provider}:${id}`,
    title: String(title || 'Untitled').trim() || 'Untitled',
    authors: authors.filter(Boolean),
    languages,
    ...(publishedYear ? { publishedYear } : {}),
    rights,
    acquisitions,
  };
}

function opds1SearchLink(xml: string, baseURL: string) {
  const link = xmlLinks(xml).find(candidate => hasRel(candidate, 'search'));
  if (!link?.href) return null;
  const href = templateURL(link.href, baseURL);
  if (!href) return null;
  return {
    kind: /opensearchdescription\+xml/i.test(link.type || '') ? 'opensearch' : 'template',
    href,
    type: String(link.type || '').toLowerCase(),
  };
}

function opds2SearchLink(document: unknown, baseURL: string) {
  const link = objectLinks(document).find(candidate => hasRel(candidate, 'search'));
  if (!link?.href) return null;
  const href = templateURL(link.href, baseURL);
  if (!href) return null;
  return {
    kind: /opensearchdescription\+xml/i.test(link.type || '') ? 'opensearch' : 'template',
    href,
    type: String(link.type || '').toLowerCase(),
  };
}

function objectLinks(value: unknown): OPDSLink[] {
  const source = asRecord(value);
  if (!source) return [];
  const groups = [source.links, source.acquisition, source.acquisitions, source.images];
  return groups.flatMap(group => Array.isArray(group) ? group : group && typeof group === 'object' ? [group] : [])
    .filter((link): link is JsonRecord => asRecord(link) !== null)
    .map(link => ({
      href: scalar(link.href || link.url),
      type: scalar(link.type || link.mime || link.media_type),
      rel: Array.isArray(link.rel) ? link.rel.join(' ') : scalar(link.rel),
      title: scalar(link.title),
    }));
}

function acquisitionRecord(link: OPDSLink, baseURL: string): CatalogRecord['acquisitions'][number] {
  return { format: acquisitionFormat(link.type, new URL(link.href || '', baseURL).pathname), url: new URL(link.href || '', baseURL).href, availability: 'open' };
}

function isReadableLink(link: OPDSLink, baseURL: string): boolean {
  if (!link?.href) return false;
  const href = absoluteURL(link.href, baseURL);
  if (!href || !/^https?:/i.test(href)) return false;
  const type = (String(link.type || '').split(';', 1)[0] as string).trim().toLowerCase();
  return Boolean(acquisitionFormat(type, new URL(href).pathname));
}

function absoluteURL(href: string, baseURL: string): string {
  try { return new URL(href, baseURL).href; } catch { return ''; }
}

function templateURL(href: string, baseURL?: string): string {
  try {
    return new URL(href, baseURL).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  } catch {
    return '';
  }
}

function hasRel(link: OPDSLink | null | undefined, expected: string): boolean {
  return String(link?.rel || '').toLowerCase().split(/\s+/).includes(expected);
}

function attributes(source: string): Record<string, string> {
  return Object.fromEntries([...String(source || '').matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)]
    .map(match => [(match[1] as string).toLowerCase(), decodeXML(match[3] as string)]));
}

function people(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.map((entry: unknown) => typeof entry === 'string' ? entry : scalar(asRecord(entry)?.name || asRecord(entry)?.title || asRecord(entry)?.identifier))
    .map(name => name.trim()).filter(Boolean);
}

function languagesFrom(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(item => scalar(item).trim().toLowerCase()).filter(item => /^[a-z]{2,3}$/i.test(item));
}

function yearFrom(value: unknown): string {
  const match = String(value || '').match(/\b(\d{4})\b/);
  return match ? match[1] as string : '';
}

function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function rightsRecord(value: unknown, source: string): CatalogRecord['rights'] {
  const evidence = String(value || '').trim();
  const normalized = evidence.toLowerCase();
  const status = /public[ -]domain|общественн(?:ое|ого) достояни|\bcc0\b/.test(normalized) ? 'public_domain'
    : /creative commons|\bcc[ -]?by\b|gfdl|open publication/.test(normalized) ? 'open_license' : 'unknown';
  return { status, ...(evidence ? { license: evidence, source } : { source }) };
}

function litResRecord(value: unknown, index: number): CatalogRecord | null {
  const item = asRecord(value);
  if (!item || !explicitPublicDomain(item) || !explicitlyFree(item)) return null;
  const acquisition = litResAcquisition(item);
  if (!acquisition) return null;
  const recordId = scalar(item.id || item.file_id || item.uuid || item.slug || index + 1);
  if (!recordId) return null;
  const metadata = asRecord(item.metadata) || item;
  const rightsEvidence = litResRightsEvidence(item) || 'Public Domain';
  return makeRecord({
    provider: 'litres-public-domain',
    recordId,
    title: scalar(metadata.title || item.name || 'Untitled'),
    authors: people(metadata.authors || metadata.author || item.authors || item.author),
    languages: languagesFrom(metadata.languages || metadata.language || item.language),
    publishedYear: yearFrom(metadata.published || metadata.year || item.year),
    rights: { status: 'public_domain', license: rightsEvidence, source: 'litres' },
    acquisitions: [acquisition],
  });
}

function explicitPublicDomain(item: JsonRecord): boolean {
  if (item.public_domain === true || item.is_public_domain === true) return true;
  const evidence = litResRightsEvidence(item).toLowerCase();
  return /public[ -]domain|общественн(?:ое|ого) достояни/.test(evidence);
}

function litResRightsEvidence(item: JsonRecord): string {
  const values = [item.rights, item.rights_status, item.license, item.license_name, item.copyright, item.access];
  const nestedRights = asRecord(item.rights);
  if (nestedRights) values.push(nestedRights.status, nestedRights.label, nestedRights.license);
  for (const collection of [item.labels, item.tags, item.categories]) {
    if (Array.isArray(collection)) values.push(...collection.map((entry: unknown) => {
      const label = asRecord(entry);
      return typeof entry === 'string' ? entry : label?.name || label?.title;
    }));
  }
  return values.map(scalar).filter(Boolean).join(' · ');
}

function explicitlyFree(item: JsonRecord): boolean {
  if (item.free === true || item.is_free === true || item.isFree === true) return true;
  const price = asRecord(item.price);
  const prices = [item.price, item.price_rub, item.cost, item.amount, price?.amount, price?.value]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    .map(value => typeof value === 'number' ? value : Number(String(value).replace(',', '.')))
    .filter(Number.isFinite);
  return prices.some(value => value === 0);
}

function litResAcquisition(item: JsonRecord): CatalogRecord['acquisitions'][number] | null {
  const groups = [item.acquisitions, item.files, item.downloads, item.links, item.formats];
  const candidates = groups.flatMap(group => Array.isArray(group) ? group : group && typeof group === 'object' ? [group] : []);
  if (item.download_url || item.downloadUrl) candidates.push({ href: item.download_url || item.downloadUrl, format: item.format || item.extension });
  const candidate = candidates.find((value: unknown) => {
    const file = asRecord(value);
    if (!file) return false;
    const href = scalar(file?.href || file?.url || file?.download_url || file?.downloadUrl);
    const format = scalar(file?.format || file?.extension || file?.type || file?.mime || file?.media_type).toLowerCase();
    const formatName = acquisitionFormat(format, '');
    const fileURL = /\.(?:epub|pdf)(?:[?#]|$)/i.test(href);
    const direct = file?.direct === true || file?.is_direct === true || Boolean(file?.download_url || file?.downloadUrl);
    return isPublicHTTPSURL(href) && formatName && (fileURL || direct);
  });
  if (!candidate) return null;
  const url = scalar(candidate.href || candidate.url || candidate.download_url || candidate.downloadUrl);
  return { format: acquisitionFormat(scalar(candidate.format || candidate.extension || candidate.type || candidate.mime || candidate.media_type), ''), url, availability: 'open' };
}

function decodeXML(value: string): string {
  const decoded = String(value).replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  } as Record<string, string>)[entity] || entity);
  // Decode before removing markup so entities cannot recreate an HTML tag
  // after sanitization. A small state machine also handles malformed or
  // deliberately overlapping tag syntax without partial string replacement.
  return textWithoutXMLMarkup(decoded);
}

function textWithoutXMLMarkup(value: string): string {
  let text = '';
  let insideTag = false;
  for (const character of value) {
    if (character === '<') {
      insideTag = true;
    } else if (character === '>') {
      insideTag = false;
    } else if (!insideTag) {
      text += character;
    }
  }
  return text;
}

function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function acquisitionFormat(type: unknown, path: string): string {
  const normalized = (String(type || '').split(';', 1)[0] || '').trim().toLowerCase();
  return ACQUISITION_TYPES.get(normalized) || (/^(?:epub|pdf)$/.test(normalized) ? normalized : path.match(/\.(epub|pdf)$/i)?.[1]?.toLowerCase() || '');
}
