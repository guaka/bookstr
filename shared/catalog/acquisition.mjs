import { normalizeRightsV2 } from '../rights/rights.mjs';
import { sourceDescriptor } from './source-registry.mjs';

const FORMATS = new Set(['epub', 'pdf', 'fb2', 'cbz', 'cbr']);
const AVAILABILITY = new Set(['open', 'borrow', 'buy', 'preview', 'restricted']);

function text(value, max = 512) {
  const result = String(value ?? '').trim();
  return result && result.length <= max && !/[\u0000-\u001f]/.test(result) ? result : '';
}

function safeURL(value, { magnet = false } = {}) {
  const raw = text(value, 4096);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (magnet && parsed.protocol === 'magnet:') return parsed.href;
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return parsed.href;
  } catch {
    // Invalid locators are ignored; a record can still expose another format.
  }
  return '';
}

function digest(value) {
  const result = text(value, 64).toLowerCase();
  return /^[a-f0-9]{64}$/.test(result) ? result : '';
}

function safeSize(value) {
  if (value === undefined || value === null || value === '') return 0;
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : 0;
}

function normalizeAcquisition(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const format = text(source.format || source.extension, 16).toLowerCase().replace(/^\./, '');
  if (!FORMATS.has(format)) return null;
  const url = safeURL(source.url || source.href || source.sourceUrl);
  const torrent = safeURL(source.torrent || source.torrentUrl || source.magnet, { magnet: true });
  if (!url && !torrent) return null;
  const availability = text(source.availability || source.access, 16).toLowerCase();
  return {
    format,
    url,
    torrent,
    availability: AVAILABILITY.has(availability) ? availability : 'restricted',
    sha256: digest(source.sha256 || source.hash),
    size: safeSize(source.size || source.filesize || source.filesize_bytes),
    source_id: text(source.source_id || source.sourceId || source.nativeId, 256),
    title: text(source.title, 400),
    private: source.private === true,
  };
}

export function normalizeProviderRecord(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const provider = text(source.provider || source.source, 128).toLowerCase();
  if (!provider) throw new TypeError('provider is required');
  const recordId = text(source.recordId || source.record_id || source.id, 256);
  if (!recordId) throw new TypeError('recordId is required');
  const descriptor = sourceDescriptor(provider);
  const rights = normalizeRightsV2(source.rights || source);
  const acquisitions = (Array.isArray(source.acquisitions) ? source.acquisitions : [])
    .map(normalizeAcquisition)
    .filter(Boolean);
  return {
    provider,
    providerDescriptor: descriptor,
    recordId,
    publicationId: text(source.publicationId || source.publication_id, 400) || `${provider}:${recordId}`,
    title: text(source.title, 400),
    authors: text(source.authors || source.author, 400),
    languages: Array.isArray(source.languages)
      ? source.languages.map(language => text(language, 32)).filter(Boolean).slice(0, 16)
      : [],
    isbn: text(source.isbn, 64),
    year: text(source.year, 32),
    rights,
    acquisitions,
  };
}

function acquisitionScore(acquisition, source, preferTorrent) {
  let score = 0;
  if (acquisition.availability === 'open') score += 50;
  else if (acquisition.availability === 'borrow') score += 40;
  else if (acquisition.availability === 'preview') score += 10;
  if (preferTorrent && acquisition.torrent) score += 20;
  if (source?.delivery === 'native-torrent' && acquisition.torrent) score += 10;
  if (acquisition.url) score += 2;
  return score;
}

export function listAcquisitions(record, { format, preferTorrent = true, includeRestricted = false } = {}) {
  const normalized = normalizeProviderRecord(record);
  const wantedFormat = format ? text(format, 16).toLowerCase().replace(/^\./, '') : '';
  if (wantedFormat && !FORMATS.has(wantedFormat)) throw new TypeError('unsupported acquisition format');
  return normalized.acquisitions
    .filter(acquisition => !wantedFormat || acquisition.format === wantedFormat)
    .filter(acquisition => includeRestricted || ['open', 'borrow'].includes(acquisition.availability))
    .map((acquisition, index) => ({ acquisition, index, score: acquisitionScore(acquisition, normalized.providerDescriptor, preferTorrent) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(item => item.acquisition);
}

export function selectAcquisition(record, options = {}) {
  return listAcquisitions(record, options)[0] || null;
}

export function providerBookFields(record) {
  const normalized = normalizeProviderRecord(record);
  return {
    id: normalized.publicationId,
    title: normalized.title,
    authors: normalized.authors,
    language: normalized.languages[0] || '',
    year: normalized.year,
    isbn: normalized.isbn,
    source: normalized.provider,
    sourceNativeId: normalized.recordId,
    sourceUrl: normalized.providerDescriptor?.homepage || '',
    ...normalized.rights,
  };
}
