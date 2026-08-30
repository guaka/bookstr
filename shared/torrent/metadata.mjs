import { createHash, createHmac } from 'node:crypto';

export const PIECE_LENGTH = 256 * 1024;
export const PUBLIC_TRACKERS = Object.freeze([
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
]);

function assertSHA256(value) {
  const sha256 = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError('sha256 must be a 64-character hexadecimal digest');
  return sha256;
}
function assertSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError('size must be a non-negative safe integer');
  return size;
}

export function canonicalBookFilename(sha256, extension = 'epub') {
  const digest = assertSHA256(sha256);
  const ext = String(extension || '').trim().toLowerCase().replace(/^\./, '');
  if (!/^[a-z0-9][a-z0-9+.-]{0,15}$/.test(ext)) throw new TypeError('extension must be a short safe file extension');
  return `${digest}.${ext}`;
}

function cleanTrackers(trackers) {
  const values = Array.isArray(trackers) ? trackers : PUBLIC_TRACKERS;
  const seen = new Set();
  return values.map(value => String(value || '').trim()).filter(value => {
    if (!/^wss?:\/\/[^\s]+$/i.test(value) || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function publicTorrentInfo({ sha256, extension = 'epub', size }) {
  const digest = assertSHA256(sha256);
  return {
    name: canonicalBookFilename(digest, extension),
    'piece length': PIECE_LENGTH,
    source: `bookstr-public-v1:${digest}`,
    length: assertSize(size),
  };
}

export function publicTorrentDescriptor({ sha256, extension = 'epub', size, trackers = PUBLIC_TRACKERS } = {}) {
  const announce = cleanTrackers(trackers);
  return {
    version: 1,
    privacy: 'public',
    announce,
    info: publicTorrentInfo({ sha256, extension, size }),
  };
}

export function privateTorrentInfo({ sha256, extension = 'epub', size, syncSecret } = {}) {
  const digest = assertSHA256(sha256);
  const secret = String(syncSecret || '');
  if (!secret) throw new TypeError('syncSecret is required for private torrents');
  const accountSalt = createHmac('sha256', secret).update(digest).digest('hex');
  return {
    name: canonicalBookFilename(digest, extension),
    'piece length': PIECE_LENGTH,
    private: 1,
    source: `bookstr-private-v1:${accountSalt}`,
    length: assertSize(size),
  };
}

export function privateTorrentDescriptor({ sha256, extension = 'epub', size, syncSecret } = {}) {
  return {
    version: 1,
    privacy: 'private',
    announce: [],
    info: privateTorrentInfo({ sha256, extension, size, syncSecret }),
  };
}

// Minimal BEP-3 encoder used for deterministic contract tests and info-hash
// calculation. Buffers are emitted as byte strings; dictionaries sort keys by
// their encoded byte representation rather than JavaScript insertion order.
export function bencode(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return Buffer.from(`i${value}e`);
  if (typeof value === 'bigint') return Buffer.from(`i${value}e`);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from('l'), ...value.map(item => bencode(item)), Buffer.from('e')]);
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const parts = [Buffer.from('d')];
    for (const key of keys) parts.push(bencode(key), bencode(value[key]));
    parts.push(Buffer.from('e'));
    return Buffer.concat(parts);
  }
  throw new TypeError(`cannot bencode ${typeof value}`);
}

export function infoHashV1(info) {
  return createHash('sha1').update(bencode(info)).digest('hex');
}
