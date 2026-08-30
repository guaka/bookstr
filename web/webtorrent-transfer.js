// Browser-side WebTorrent adapter. The static web client injects a WebTorrent
// constructor/client so this module remains dependency-free and can also be
// reused by iOS/Android WebView adapters.

export const PUBLIC_TRACKERS = Object.freeze([
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
]);
export const PIECE_LENGTH = 256 * 1024;

function torrentID(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new TypeError('torrentId must be a non-empty string');
  return value.trim();
}

function digest(value) {
  const result = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new TypeError('sha256 must be a 64-character hexadecimal digest');
  return result;
}

function extension(value) {
  const result = String(value || 'epub').trim().toLowerCase().replace(/^\./, '');
  if (!/^[a-z0-9][a-z0-9+.-]{0,15}$/.test(result)) throw new TypeError('extension must be a short safe file extension');
  return result;
}

function trackerList(trackers) {
  const values = Array.isArray(trackers) ? trackers : PUBLIC_TRACKERS;
  return [...new Set(values.map(value => String(value || '').trim()).filter(value => /^wss?:\/\//i.test(value)))];
}

function progressPayload(torrent, privacy) {
  return {
    infoHash: String(torrent?.infoHash || ''),
    progress: Number.isFinite(Number(torrent?.progress)) ? Number(torrent.progress) : 0,
    downloaded: Number(torrent?.downloaded || 0),
    uploaded: Number(torrent?.uploaded || 0),
    peers: Number(torrent?.numPeers || 0),
    privacy,
  };
}

export function seedPublicTorrent(client, file, { sha256, extension: ext = 'epub', trackers = PUBLIC_TRACKERS, onProgress, onSeed } = {}) {
  if (!client || typeof client.seed !== 'function') throw new TypeError('a WebTorrent client is required');
  if (!file || typeof file !== 'object') throw new TypeError('a browser File or Blob is required');
  const digestValue = digest(sha256);
  const trackerValues = trackerList(trackers);
  if (!trackerValues.length) throw new TypeError('at least one public WSS tracker is required');
  const opts = {
    name: `${digestValue}.${extension(ext)}`,
    announceList: trackerValues.map(url => [url]),
    pieceLength: PIECE_LENGTH,
    info: { source: `bookstr-public-v1:${digestValue}` },
  };
  return new Promise((resolve, reject) => {
    try {
      client.seed(file, opts, torrent => {
        const result = { torrent, summary: progressPayload(torrent, 'public'), trackers: trackerValues };
        onSeed?.(result);
        resolve(result);
      });
      if (typeof onProgress === 'function' && client.on) client.on('upload', () => onProgress(progressPayload(client, 'public')));
    } catch (error) {
      reject(error);
    }
  });
}

export function addPublicTorrent(client, id, { path, trackers = PUBLIC_TRACKERS, onProgress, onDone, onError } = {}) {
  if (!client || typeof client.add !== 'function') throw new TypeError('a WebTorrent client is required');
  const torrent = client.add(torrentID(id), {
    path,
    announce: trackerList(trackers),
  });
  torrent.on?.('download', () => onProgress?.(progressPayload(torrent, 'public')));
  torrent.on?.('done', () => onDone?.(progressPayload(torrent, 'public')));
  torrent.on?.('error', error => onError?.(error));
  return torrent;
}

export function addPrivateTorrent(client, id, { path, onProgress, onDone, onError } = {}) {
  if (!client || typeof client.add !== 'function') throw new TypeError('a WebTorrent client is required');
  const torrent = client.add(torrentID(id), {
    path,
    announce: [],
    dht: false,
    tracker: false,
    utPex: false,
    lsd: false,
    private: true,
  });
  torrent.on?.('download', () => onProgress?.(progressPayload(torrent, 'private')));
  torrent.on?.('done', () => onDone?.(progressPayload(torrent, 'private')));
  torrent.on?.('error', error => onError?.(error));
  return torrent;
}

