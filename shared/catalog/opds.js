// Dependency-free OPDS and LitRes normalizers. Network transport stays in the
// platform adapters: custom OPDS feeds are fetched directly by a client and
// LitRes is fetched only through Bookstr's fixed-origin worker.

export const FB2_MIME_TYPES = new Set([
  'application/x-fictionbook+xml',
  'application/fb2+xml',
]);

const MAX_PUBLIC_OPDS_FEEDS = 12;
const MAX_FEED_NAME_LENGTH = 80;

export function isPublicHTTPSURL(value) {
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
export function normalizePublicOPDSFeeds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const feeds = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
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

export function normalizeOPDSFeed(feedXML, options = {}) {
  return normalizeOPDS1Feed(feedXML, options);
}

export function normalizeOPDS1Feed(feedXML, { provider, feedURL } = {}) {
  const context = validatedContext(provider, feedURL);
  const xml = safeXML(feedXML);
  const entries = xmlEntries(xml);
  return entries.map((entry, index) => recordFromOPDS1Entry(entry, index, context)).filter(Boolean);
}

export function normalizeOPDS2Feed(feedJSON, { provider, feedURL } = {}) {
  const context = validatedContext(provider, feedURL);
  const document = parseOPDSJSON(feedJSON);
  const publications = Array.isArray(document.publications)
    ? document.publications
    : Array.isArray(document.items)
      ? document.items
      : [];
  return publications.map((publication, index) => recordFromOPDS2Publication(publication, index, context)).filter(Boolean);
}

// A discovery result includes any acquisitions in the current document plus a
// search URL/template. A caller can fetch an OpenSearch descriptor when
// `search.kind === 'opensearch'`, then pass it to discoverOpenSearchTemplate.
export function discoverOPDSFeed(payload, { provider, feedURL } = {}) {
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

export function discoverOpenSearchTemplate(documentXML, baseURL) {
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

export function resolveOPDSSearchURL(search, query, baseURL) {
  const href = typeof search === 'string' ? search : search?.href;
  if (!href) return null;
  let resolved;
  try {
    resolved = templateURL(href, baseURL);
  } catch {
    return null;
  }
  const encoded = encodeURIComponent(String(query || '').trim());
  if (!encoded) return resolved;
  if (/\{[?&][^}]+\}/.test(resolved)) {
    return resolved.replace(/\{([?&])([^}]+)\}/g, (_match, prefix, names) => {
      const values = names.split(',').map(name => name.trim()).filter(Boolean)
        .map((name, index) => `${index || prefix === '&' ? '&' : '?'}${encodeURIComponent(name)}=${encoded}`);
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
// HTTPS FB2 download. This prevents Bookstr from guessing rights from age,
// title, or a general catalogue landing page.
export function normalizeLitresPublicDomainRecords(payload) {
  const document = typeof payload === 'string' ? parseOPDSJSON(payload) : payload;
  const candidates = Array.isArray(document) ? document
    : Array.isArray(document?.records) ? document.records
      : Array.isArray(document?.results) ? document.results
        : Array.isArray(document?.items) ? document.items
          : [];
  return candidates.map((item, index) => litResRecord(item, index)).filter(Boolean);
}

function validatedContext(provider, feedURL) {
  const normalizedProvider = String(provider || '').trim();
  if (!normalizedProvider || !isPublicHTTPSURL(feedURL)) {
    throw new Error('OPDS source must have a provider id and public HTTPS URL');
  }
  return { provider: normalizedProvider, feedURL: new URL(feedURL).href };
}

function isPublicHostname(value) {
  const hostname = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1' || /^(?:fc|fd|fe80):/i.test(hostname)) return false;
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return true;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some(part => part > 255)) return false;
  return !(parts[0] === 0 || parts[0] === 10 || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168));
}

function safeXML(value) {
  if (typeof value !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('Invalid OPDS XML');
  return value;
}

function parseOPDSJSON(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch {
    throw new Error('Invalid OPDS JSON');
  }
}

function xmlEntries(xml) {
  return [...xml.matchAll(/<(?:[\w.-]+:)?entry\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?entry\s*>/gi)].map(match => match[1]);
}

function xmlLinks(xml, tagName = 'link') {
  const escaped = escapeRegExp(tagName);
  const expression = new RegExp(`<(?:[\\w.-]+:)?${escaped}\\b([^>]*?)(?:\\/\\s*>|>)`, 'gi');
  return [...xml.matchAll(expression)].map(match => attributes(match[1]));
}

function xmlValue(xml, name) {
  const localName = escapeRegExp(String(name).split(':').pop());
  const expression = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}\\s*>`, 'i');
  return decodeXML((xml.match(expression) || [])[1] || '').trim();
}

function xmlValues(xml, name) {
  const localName = escapeRegExp(String(name).split(':').pop());
  const expression = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}\\s*>`, 'gi');
  return [...xml.matchAll(expression)].map(match => decodeXML(match[1]).trim()).filter(Boolean);
}

function recordFromOPDS1Entry(entry, index, context) {
  const links = xmlLinks(entry);
  const acquisition = links.find(link => isFB2Link(link, context.feedURL));
  if (!acquisition) return null;
  const id = xmlValue(entry, 'id') || acquisition.href || String(index + 1);
  const authorBlocks = [...entry.matchAll(/<(?:[\w.-]+:)?author\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?author\s*>/gi)].map(match => match[1]);
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

function recordFromOPDS2Publication(publication, index, context) {
  if (!publication || typeof publication !== 'object') return null;
  const metadata = publication.metadata && typeof publication.metadata === 'object' ? publication.metadata : publication;
  const links = objectLinks(publication);
  const acquisition = links.find(link => isFB2Link(link, context.feedURL));
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

function makeRecord({ provider, recordId, title, authors, languages, publishedYear, rights, acquisitions }) {
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

function opds1SearchLink(xml, baseURL) {
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

function opds2SearchLink(document, baseURL) {
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

function objectLinks(value) {
  const groups = [value?.links, value?.acquisition, value?.acquisitions, value?.images];
  return groups.flatMap(group => Array.isArray(group) ? group : group && typeof group === 'object' ? [group] : [])
    .filter(link => link && typeof link === 'object')
    .map(link => ({
      href: scalar(link.href || link.url),
      type: scalar(link.type || link.mime || link.media_type),
      rel: Array.isArray(link.rel) ? link.rel.join(' ') : scalar(link.rel),
      title: scalar(link.title),
    }));
}

function acquisitionRecord(link, baseURL) {
  return { format: 'fb2', url: new URL(link.href, baseURL).href, availability: 'open' };
}

function isFB2Link(link, baseURL) {
  if (!link?.href) return false;
  const href = absoluteURL(link.href, baseURL);
  if (!href || !/^https?:/i.test(href)) return false;
  const type = String(link.type || '').split(';', 1)[0].trim().toLowerCase();
  return FB2_MIME_TYPES.has(type) || /\.fb2(?:\.zip)?$/i.test(new URL(href).pathname);
}

function absoluteURL(href, baseURL) {
  try { return new URL(href, baseURL).href; } catch { return ''; }
}

function templateURL(href, baseURL) {
  try {
    return new URL(href, baseURL).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  } catch {
    return '';
  }
}

function hasRel(link, expected) {
  return String(link?.rel || '').toLowerCase().split(/\s+/).includes(expected);
}

function attributes(source) {
  return Object.fromEntries([...String(source || '').matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)]
    .map(match => [match[1].toLowerCase(), decodeXML(match[3])]));
}

function people(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.map(entry => typeof entry === 'string' ? entry : scalar(entry?.name || entry?.title || entry?.identifier))
    .map(name => name.trim()).filter(Boolean);
}

function languagesFrom(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(item => scalar(item).trim().toLowerCase()).filter(item => /^[a-z]{2,3}$/i.test(item));
}

function yearFrom(value) {
  const match = String(value || '').match(/\b(\d{4})\b/);
  return match ? match[1] : '';
}

function scalar(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function rightsRecord(value, source) {
  const evidence = String(value || '').trim();
  const normalized = evidence.toLowerCase();
  const status = /public[ -]domain|общественн(?:ое|ого) достояни|\bcc0\b/.test(normalized) ? 'public_domain'
    : /creative commons|\bcc[ -]?by\b|gfdl|open publication/.test(normalized) ? 'open_license' : 'unknown';
  return { status, ...(evidence ? { license: evidence, source } : { source }) };
}

function litResRecord(item, index) {
  if (!item || typeof item !== 'object' || !explicitPublicDomain(item) || !explicitlyFree(item)) return null;
  const acquisition = litResFB2Acquisition(item);
  if (!acquisition) return null;
  const recordId = scalar(item.id || item.file_id || item.uuid || item.slug || index + 1);
  if (!recordId) return null;
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : item;
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

function explicitPublicDomain(item) {
  if (item.public_domain === true || item.is_public_domain === true) return true;
  const evidence = litResRightsEvidence(item).toLowerCase();
  return /public[ -]domain|общественн(?:ое|ого) достояни/.test(evidence);
}

function litResRightsEvidence(item) {
  const values = [item.rights, item.rights_status, item.license, item.license_name, item.copyright, item.access];
  if (item.rights && typeof item.rights === 'object') values.push(item.rights.status, item.rights.label, item.rights.license);
  for (const collection of [item.labels, item.tags, item.categories]) {
    if (Array.isArray(collection)) values.push(...collection.map(entry => typeof entry === 'string' ? entry : entry?.name || entry?.title));
  }
  return values.map(scalar).filter(Boolean).join(' · ');
}

function explicitlyFree(item) {
  if (item.free === true || item.is_free === true || item.isFree === true) return true;
  const prices = [item.price, item.price_rub, item.cost, item.amount, item.price?.amount, item.price?.value]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    .map(value => typeof value === 'number' ? value : Number(String(value).replace(',', '.')))
    .filter(Number.isFinite);
  return prices.some(value => value === 0);
}

function litResFB2Acquisition(item) {
  const groups = [item.acquisitions, item.files, item.downloads, item.links, item.formats];
  const candidates = groups.flatMap(group => Array.isArray(group) ? group : group && typeof group === 'object' ? [group] : []);
  if (item.download_url || item.downloadUrl) candidates.push({ href: item.download_url || item.downloadUrl, format: item.format || item.extension });
  const candidate = candidates.find(file => {
    const href = scalar(file?.href || file?.url || file?.download_url || file?.downloadUrl);
    const format = scalar(file?.format || file?.extension || file?.type || file?.mime || file?.media_type).toLowerCase();
    const labelledFB2 = /(?:^|\/)fb2(?:\.zip)?$/.test(format)
      || FB2_MIME_TYPES.has(format.split(';', 1)[0]);
    const fileURL = /\.fb2(?:\.zip)?(?:[?#]|$)/i.test(href);
    const direct = file?.direct === true || file?.is_direct === true || Boolean(file?.download_url || file?.downloadUrl);
    return isPublicHTTPSURL(href) && labelledFB2 && (fileURL || direct);
  });
  if (!candidate) return null;
  const url = scalar(candidate.href || candidate.url || candidate.download_url || candidate.downloadUrl);
  return { format: 'fb2', url, availability: 'open' };
}

function decodeXML(value) {
  const decoded = String(value).replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  })[entity]);
  // Decode before removing markup so entities cannot recreate an HTML tag
  // after sanitization. A small state machine also handles malformed or
  // deliberately overlapping tag syntax without partial string replacement.
  return textWithoutXMLMarkup(decoded);
}

function textWithoutXMLMarkup(value) {
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
