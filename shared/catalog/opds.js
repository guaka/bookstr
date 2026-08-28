// Small, dependency-free OPDS 1 acquisition-feed normalizer. Clients own
// transport and persistence; this module only turns trusted feed XML into the
// cross-client provider-record shape.
const FB2_TYPES = new Set(['application/x-fictionbook+xml', 'application/fb2+xml']);

export function isPublicHTTPSURL(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function normalizeOPDSFeed(feedXML, { provider, feedURL } = {}) {
  if (!provider || !isPublicHTTPSURL(feedURL)) throw new Error('OPDS source must have a provider id and public HTTPS URL');
  if (typeof feedXML !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(feedXML)) throw new Error('Invalid OPDS XML');
  const entries = [...feedXML.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(match => match[1]);
  return entries.map((entry, index) => {
    const value = name => decodeXML((entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')) || [])[1] || '').trim();
    const links = [...entry.matchAll(/<link\b([^>]*?)(?:\/>|><\/link>)/gi)].map(match => attributes(match[1]));
    const acquisition = links.find(link => isFB2Link(link, feedURL));
    if (!acquisition) return null;
    const id = value('id') || acquisition.href || String(index + 1);
    const authors = [...entry.matchAll(/<author\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
      .map(match => decodeXML(match[1]).trim()).filter(Boolean);
    const language = value('dc:language') || value('language');
    const rights = value('dc:rights') || value('rights');
    const href = new URL(acquisition.href, feedURL).href;
    return {
      provider, recordId: id, publicationId: `${provider}:${id}`,
      title: value('title') || 'Untitled', authors, languages: /^[a-z]{2,3}$/i.test(language) ? [language.toLowerCase()] : [],
      rights: rightsRecord(rights, provider),
      acquisitions: [{ format: 'fb2', url: href, availability: 'open' }],
    };
  }).filter(Boolean);
}

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(match => [match[1].toLowerCase(), decodeXML(match[3])]));
}

function isFB2Link(link, feedURL) {
  if (!link.href) return false;
  let url;
  try { url = new URL(link.href, feedURL); } catch { return false; }
  return FB2_TYPES.has(String(link.type || '').toLowerCase()) || /\.fb2(?:\.zip)?$/i.test(url.pathname);
}

function rightsRecord(value, source) {
  const evidence = String(value || '').trim();
  const normalized = evidence.toLowerCase();
  const status = /public[ -]domain|\bcc0\b/.test(normalized) ? 'public_domain'
    : /creative commons|\bcc[ -]?by\b|gfdl|open publication/.test(normalized) ? 'open_license' : 'unknown';
  return { status, ...(evidence ? { license: evidence, source } : {}) };
}

function decodeXML(value) {
  return String(value).replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]);
}
