import { normalizeRightsV2 } from '../rights/rights.mjs';

export const NIP94_FILE_METADATA_KIND_V1 = 1063;

const FORMATS = Object.freeze({
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  fb2: 'application/x-fictionbook+xml',
});

function text(value, max) {
  const result = String(value ?? '').trim();
  return result && result.length <= max && !/[\u0000-\u001f]/.test(result) ? result : '';
}

function sha256(value) {
  const result = text(value, 64).toLowerCase();
  return /^[a-f0-9]{64}$/.test(result) ? result : '';
}

function byteSize(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : 0;
}

function httpsURL(value) {
  try {
    const parsed = new URL(String(value ?? '').trim());
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' ? parsed.href : '';
  } catch {
    return '';
  }
}

function urls(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).map(httpsURL).filter(Boolean))].slice(0, 8);
}

function tagsFor(input) {
  const primary = urls(input.url || input.urls)[0];
  if (!primary) throw new TypeError('an HTTPS publication URL is required');
  const digest = sha256(input.sha256);
  if (!digest) throw new TypeError('sha256 must be a 64-character hexadecimal digest');
  const size = byteSize(input.size);
  if (!size) throw new TypeError('size must be a positive safe integer');
  const format = text(input.format, 16).toLowerCase();
  const mime = FORMATS[format] || text(input.mime, 120);
  if (!mime || !/^[a-z]+\/[a-z0-9.+-]+$/i.test(mime)) throw new TypeError('a supported format or MIME type is required');
  const title = text(input.title, 400);
  const publicationId = text(input.publicationId, 256);
  const allURLs = urls(input.urls || primary);
  const tags = [['url', primary], ['m', mime], ['x', digest], ['size', String(size)]];
  for (const fallback of allURLs.filter(url => url !== primary)) tags.push(['fallback', fallback]);
  if (title) tags.push(['title', title]);
  if (publicationId) tags.push(['bookstr', publicationId]);
  return tags;
}

/**
 * Build the unsigned NIP-94 metadata only when publication is deliberately
 * enabled, a completed local verification is supplied, and the edition may be
 * publicly redistributed.  The contract never accepts filesystem paths.
 */
export function createPublicFileMetadataEvent(input = {}, { pubkey, now } = {}) {
  if (input.operatorOptIn !== true) throw new Error('public metadata publication is not enabled');
  if (input.verified !== true) throw new Error('the local file must be completely verified before publication');
  if (!normalizeRightsV2(input.rights || input).public_seed_allowed) {
    throw new Error('rights policy does not allow public metadata publication');
  }
  const author = text(pubkey, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(author)) throw new TypeError('pubkey must be a 64-character hexadecimal key');
  const createdAt = Number(now);
  if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new TypeError('now must be a positive Unix timestamp');
  return {
    pubkey: author,
    created_at: createdAt,
    kind: NIP94_FILE_METADATA_KIND_V1,
    tags: tagsFor(input),
    content: '',
  };
}

export function parsePublicFileMetadataEvent(event) {
  if (!event || event.kind !== NIP94_FILE_METADATA_KIND_V1 || typeof event.content !== 'string' || event.content !== '' || !Array.isArray(event.tags)) return null;
  const values = name => event.tags.filter(tag => Array.isArray(tag) && tag[0] === name).map(tag => tag[1]);
  const primary = httpsURL(values('url')[0]);
  const digest = sha256(values('x')[0]);
  const size = byteSize(values('size')[0]);
  const mime = text(values('m')[0], 120);
  if (!primary || !digest || !size || !mime || !/^[a-z]+\/[a-z0-9.+-]+$/i.test(mime)) return null;
  return {
    url: primary,
    fallbacks: urls(values('fallback')).filter(url => url !== primary),
    sha256: digest,
    size,
    mime,
    title: text(values('title')[0], 400) || null,
    publicationId: text(values('bookstr')[0], 256) || null,
  };
}
