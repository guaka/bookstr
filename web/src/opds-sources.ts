// Custom OPDS feeds are fetched by this browser module. They are deliberately
// never sent through the Bookstr worker.
const FB2_TYPES = new Set(['application/x-fictionbook+xml', 'application/fb2+xml']);
const MAX_FEEDS = 12;

type PublicFeed = { name: string; url: string };
type FeedContext = { provider: string; feedURL: string };
type OPDSLink = { href?: string; type?: string; rel?: string | string[]; template?: string; [key: string]: string | string[] | undefined };
type ProviderRecord = {
  provider: string;
  recordId: string;
  publicationId: string;
  title: string;
  authors: string[];
  languages: string[];
  publishedYear?: string;
  rights: { status: string; license?: string; source: string };
  acquisitions: Array<{ format: string; url: string; availability: string }>;
};
type SearchDescriptor = { kind: 'opensearch' | 'template'; href: string };
type DiscoveredDocument = { records: ProviderRecord[]; search: SearchDescriptor | null };
type RecordValues = {
  provider: string;
  recordId: unknown;
  title: unknown;
  authors: string[];
  language: unknown;
  published: unknown;
  rights: unknown;
  acquisition: OPDSLink;
  feedURL: string;
};
type RawRecord = Record<string, unknown>;

export function isPublicHTTPSURL(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password && publicHost(url.hostname);
  } catch {
    return false;
  }
}

export function normalizePublicOPDSFeeds(value: unknown): PublicFeed[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const feeds: PublicFeed[] = [];
  for (const item of value) {
    const candidate = item as { name?: unknown; url?: unknown } | null | undefined;
    const name = String(candidate?.name || '').replace(/\s+/g, ' ').trim();
    const rawURL = String(candidate?.url || '').trim();
    if (!name || name.length > 80 || !isPublicHTTPSURL(rawURL)) continue;
    const url = new URL(rawURL).href;
    if (seen.has(url)) continue;
    seen.add(url);
    feeds.push({ name, url });
    if (feeds.length === MAX_FEEDS) break;
  }
  return feeds;
}

export function providerForOPDSFeed(feed: unknown): string {
  const valid = normalizePublicOPDSFeeds([feed])[0];
  if (!valid) throw new Error('OPDS feed must have a name and public HTTPS URL');
  let hash = 2166136261;
  for (const character of valid.url) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return 'opds-' + (hash >>> 0).toString(36);
}

export async function searchOPDSFeed(feed: unknown, query: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<ProviderRecord[]> {
  const valid = normalizePublicOPDSFeeds([feed])[0];
  if (!valid) throw new Error('OPDS feed must have a name and public HTTPS URL');
  if (typeof fetchImpl !== 'function') throw new Error('No network fetch is available for OPDS search');
  const context = { provider: providerForOPDSFeed(valid), feedURL: valid.url };
  const initial = await fetchDocument(valid.url, context, fetchImpl);
  let search = initial.search;
  if (search?.kind === 'opensearch') {
    const descriptor = await requestText(search.href, fetchImpl);
    search = openSearchTemplate(descriptor.body, descriptor.url);
  }
  const searchURL = search ? resolveSearchURL(search.href, query, valid.url) : '';
  if (searchURL && searchURL !== valid.url) {
    return (await fetchDocument(searchURL, context, fetchImpl)).records;
  }
  return filterRecords(initial.records, query);
}

export function providerRecordToBook(record: ProviderRecord, sourceURL: string): Record<string, unknown> | null {
  const acquisition = record?.acquisitions?.find(item => item?.format === 'fb2' && item?.availability === 'open');
  if (!record || !acquisition) return null;
  return {
    id: record.publicationId,
    source: record.provider,
    sourceNativeId: record.recordId,
    sourceUrl: sourceURL || '',
    title: record.title || 'Untitled',
    authors: record.authors.join(', '),
    language: record.languages[0] || '',
    year: record.publishedYear || '',
    extension: 'fb2',
    readUrl: acquisition.url,
    rights_status: record.rights.status,
    license: record.rights.license || '',
    rights_source: record.rights.source || record.provider,
  };
}

async function fetchDocument(url: string, context: FeedContext, fetchImpl: typeof fetch): Promise<DiscoveredDocument> {
  const response = await requestText(url, fetchImpl);
  return discover(response.body, { ...context, feedURL: response.url });
}

async function requestText(url: string, fetchImpl: typeof fetch): Promise<{ body: string; url: string }> {
  if (!isPublicHTTPSURL(url)) throw new Error('OPDS requests must use public HTTPS URLs');
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/opds+json, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.1' },
      redirect: 'error',
    });
  } catch (error) {
    const detail = error as { message?: unknown } | null | undefined;
    throw new Error('OPDS request failed: ' + (detail?.message || error as string));
  }
  if (!response?.ok) throw new Error('OPDS request failed (' + (response?.status || 0) + ')');
  const finalURL = String(response.url || url);
  if (!isPublicHTTPSURL(finalURL)) throw new Error('OPDS request left the configured public HTTPS endpoint');
  return { body: await response.text(), url: finalURL };
}

function discover(payload: unknown, context: FeedContext): DiscoveredDocument {
  const source = String(payload || '').trim();
  if (source.startsWith('{') || source.startsWith('[')) {
    const document = parseJSON(source);
    return { records: recordsFromJSON(document, context), search: jsonSearch(document, context.feedURL) };
  }
  const xml = safeXML(source);
  return { records: recordsFromXML(xml, context), search: xmlSearch(xml, context.feedURL) };
}

function recordsFromJSON(document: RawRecord, context: FeedContext): ProviderRecord[] {
  const publications: unknown[] = Array.isArray(document.publications) ? document.publications
    : Array.isArray(document.items) ? document.items : [];
  return publications.map((item: unknown, index): ProviderRecord | null => {
    if (!item || typeof item !== 'object') return null;
    const publication = item as RawRecord;
    const metadata = publication.metadata && typeof publication.metadata === 'object'
      ? publication.metadata as RawRecord
      : publication;
    const acquisition = objectLinks(publication).find(link => isFB2Link(link, context.feedURL));
    if (!acquisition) return null;
    return makeRecord({
      provider: context.provider,
      recordId: scalar(metadata.identifier || metadata.id || publication.id || acquisition.href || index + 1),
      title: scalar(metadata.title || publication.title || 'Untitled'),
      authors: people(metadata.author || metadata.authors || metadata.creator || publication.author),
      language: metadata.language || metadata.languages || publication.language,
      published: metadata.published || metadata.modified || publication.published,
      rights: scalar(metadata.rights || metadata.license || publication.rights || publication.license),
      acquisition,
      feedURL: context.feedURL,
    });
  }).filter((record): record is ProviderRecord => Boolean(record));
}

function recordsFromXML(xml: string, context: FeedContext): ProviderRecord[] {
  const entries = [...xml.matchAll(/<(?:[\w.-]+:)?entry\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?entry\s*>/gi)].map(match => match[1]!);
  return entries.map((entry, index): ProviderRecord | null => {
    const acquisition = xmlLinks(entry).find(link => isFB2Link(link, context.feedURL));
    if (!acquisition) return null;
    const authors = [...entry.matchAll(/<(?:[\w.-]+:)?author\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?author\s*>/gi)]
      .flatMap(match => xmlValues(match[1]!, 'name'));
    return makeRecord({
      provider: context.provider,
      recordId: xmlValue(entry, 'id') || acquisition.href || String(index + 1),
      title: xmlValue(entry, 'title') || 'Untitled',
      authors,
      language: xmlValue(entry, 'language'),
      published: xmlValue(entry, 'issued') || xmlValue(entry, 'published'),
      rights: xmlValue(entry, 'rights'),
      acquisition,
      feedURL: context.feedURL,
    });
  }).filter((record): record is ProviderRecord => Boolean(record));
}

function makeRecord(value: RecordValues): ProviderRecord | null {
  const recordId = String(value.recordId || '').trim();
  if (!recordId) return null;
  const evidence = String(value.rights || '').trim();
  const lower = evidence.toLowerCase();
  const status = /public[ -]domain|общественн(?:ое|ого) достояни|\bcc0\b/.test(lower) ? 'public_domain'
    : /creative commons|\bcc[ -]?by\b|gfdl|open publication/.test(lower) ? 'open_license' : 'unknown';
  return {
    provider: value.provider,
    recordId,
    publicationId: value.provider + ':' + recordId,
    title: String(value.title || 'Untitled').trim() || 'Untitled',
    authors: value.authors.filter(Boolean),
    languages: languageList(value.language),
    ...(year(value.published) ? { publishedYear: year(value.published) } : {}),
    rights: evidence ? { status, license: evidence, source: value.provider } : { status, source: value.provider },
    acquisitions: [{ format: 'fb2', url: new URL(value.acquisition.href!, value.feedURL).href, availability: 'open' }],
  };
}

function jsonSearch(document: RawRecord, baseURL: string): SearchDescriptor | null {
  const link = objectLinks(document).find(item => hasRel(item, 'search'));
  return link?.href ? {
    kind: /opensearchdescription\+xml/i.test(link.type || '') ? 'opensearch' : 'template',
    href: templateURL(link.href, baseURL),
  } : null;
}

function xmlSearch(xml: string, baseURL: string): SearchDescriptor | null {
  const link = xmlLinks(xml).find(item => hasRel(item, 'search'));
  return link?.href ? {
    kind: /opensearchdescription\+xml/i.test(link.type || '') ? 'opensearch' : 'template',
    href: templateURL(link.href, baseURL),
  } : null;
}

function openSearchTemplate(xml: string, baseURL: string): SearchDescriptor | null {
  const link = xmlLinks(safeXML(xml), 'url').find(item => /(?:searchterms|query|q)[^}]*}/i.test(item.template || ''));
  return link?.template ? { kind: 'template', href: templateURL(link.template, baseURL) } : null;
}

function resolveSearchURL(href: string, query: string, baseURL: string): string {
  let url;
  try {
    url = templateURL(href, baseURL);
  } catch {
    return '';
  }
  const encoded = encodeURIComponent(String(query || '').trim());
  if (!encoded) return url;
  if (/\{[?&][^}]+\}/.test(url)) {
    return url.replace(/\{([?&])([^}]+)\}/g, (_match, prefix, names) => names.split(',').map((name: string, index: number) =>
      (index || prefix === '&' ? '&' : '?') + encodeURIComponent(name.trim()) + '=' + encoded,
    ).join(''));
  }
  return /\{(?:searchTerms|query|q)\}/i.test(url)
    ? url.replace(/\{(?:searchTerms|query|q)\}/ig, encoded) : '';
}

function filterRecords(records: ProviderRecord[], query: string): ProviderRecord[] {
  const terms = String(query || '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return terms.length ? records.filter(record => {
    const searchable = [record.title, ...record.authors].join(' ').toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  }) : records;
}

function objectLinks(value: unknown): OPDSLink[] {
  const record = value as RawRecord | null | undefined;
  return [record?.links, record?.acquisition, record?.acquisitions].flatMap(group =>
    Array.isArray(group) ? group : group && typeof group === 'object' ? [group] : [],
  ).filter(Boolean).map((item) => {
    const link = item as RawRecord;
    return {
      href: scalar(link.href || link.url),
      type: scalar(link.type || link.mime || link.media_type),
      rel: Array.isArray(link.rel) ? link.rel.map(scalar).join(' ') : scalar(link.rel),
    };
  });
}

function xmlLinks(xml: string, tag = 'link'): OPDSLink[] {
  const expression = new RegExp('<(?:[\\w.-]+:)?' + escapeRegExp(tag) + '\\b([^>]*?)(?:\\/\\s*>|>)', 'gi');
  return [...xml.matchAll(expression)].map(match => attributes(match[1]));
}

function xmlValue(xml: string, tag: string): string {
  const local = escapeRegExp(String(tag).split(':').pop()!);
  const expression = new RegExp('<(?:[\\w.-]+:)?' + local + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + local + '\\s*>', 'i');
  return decodeXML((xml.match(expression) || [])[1] || '').trim();
}

function xmlValues(xml: string, tag: string): string[] {
  const local = escapeRegExp(String(tag).split(':').pop()!);
  const expression = new RegExp('<(?:[\\w.-]+:)?' + local + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + local + '\\s*>', 'gi');
  return [...xml.matchAll(expression)].map(match => decodeXML(match[1]!).trim()).filter(Boolean);
}

function isFB2Link(link: OPDSLink, baseURL: string): boolean {
  try {
    const url = new URL(link?.href as string, baseURL);
    const type = String(link?.type || '').split(';', 1)[0]!.trim().toLowerCase();
    return /^https?:$/.test(url.protocol) && (FB2_TYPES.has(type) || /\.fb2(?:\.zip)?$/i.test(url.pathname));
  } catch {
    return false;
  }
}

function attributes(source: string | undefined): OPDSLink {
  return Object.fromEntries([...String(source || '').matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)]
    .map(match => [match[1]!.toLowerCase(), decodeXML(match[3]!)]));
}

function people(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map(item => typeof item === 'string' ? item : scalar((item as { name?: unknown; title?: unknown } | null | undefined)?.name || (item as { name?: unknown; title?: unknown } | null | undefined)?.title))
    .map(item => item.trim()).filter(Boolean);
}

function languageList(value: unknown): string[] {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map(scalar).map(item => item.trim().toLowerCase()).filter(item => /^[a-z]{2,3}$/i.test(item));
}

function year(value: unknown): string {
  return String(value || '').match(/\b(\d{4})\b/)?.[1] || '';
}

function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function templateURL(value: string, baseURL: string): string {
  return new URL(value, baseURL).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
}

function hasRel(link: OPDSLink, value: string): boolean {
  return String(link?.rel || '').toLowerCase().split(/\s+/).includes(value);
}

function safeXML(value: string): string {
  if (typeof value !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('Invalid OPDS XML');
  return value;
}

function parseJSON(value: string): RawRecord {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') throw new Error('not object');
    return parsed;
  } catch {
    throw new Error('Invalid OPDS JSON');
  }
}

function decodeXML(value: string): string {
  const decoded = String(value).replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  }[entity] as string));
  // Entity decoding must precede markup removal; otherwise encoded markup can
  // be introduced after the sanitizer has already run.
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

function publicHost(value: string): boolean {
  const host = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === '::1' || /^(?:fc|fd|fe80):/i.test(host)) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return true;
  const parts = ipv4.slice(1).map(Number);
  return !parts.some(item => item > 255) && !(parts[0]! === 0 || parts[0]! === 10 || parts[0]! === 127
    || (parts[0]! === 169 && parts[1]! === 254)
    || (parts[0]! === 172 && parts[1]! >= 16 && parts[1]! <= 31)
    || (parts[0]! === 192 && parts[1]! === 168));
}

function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
