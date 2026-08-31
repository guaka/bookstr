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

const SIGNAL_TYPES = new Set(['offer', 'answer', 'pranswer', 'rollback']);
const MAX_SIGNAL_BYTES = 8192;

function signalPayload(value) {
  let candidate = value;
  if (typeof candidate === 'string') {
    if (candidate.length > MAX_SIGNAL_BYTES) throw new TypeError('private peer signal is too large');
    try {
      candidate = JSON.parse(candidate);
    } catch {
      throw new TypeError('private peer signal must be JSON');
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('private peer signal must be an object');
  }
  const result = {};
  if (candidate.type !== undefined) {
    if (!SIGNAL_TYPES.has(String(candidate.type))) throw new TypeError('private peer signal has an invalid type');
    result.type = String(candidate.type);
  }
  if (candidate.sdp !== undefined) {
    if (typeof candidate.sdp !== 'string' || candidate.sdp.length > MAX_SIGNAL_BYTES) throw new TypeError('private peer signal has invalid SDP');
    result.sdp = candidate.sdp;
  }
  if (candidate.candidate !== undefined) {
    if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 2000) throw new TypeError('private peer signal has an invalid ICE candidate');
    result.candidate = candidate.candidate;
  }
  if (candidate.sdpMid !== undefined) {
    if (candidate.sdpMid !== null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 256)) throw new TypeError('private peer signal has an invalid SDP mid');
    result.sdpMid = candidate.sdpMid;
  }
  if (candidate.sdpMLineIndex !== undefined) {
    if (candidate.sdpMLineIndex !== null && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 256)) throw new TypeError('private peer signal has an invalid SDP line index');
    result.sdpMLineIndex = candidate.sdpMLineIndex;
  }
  if (candidate.usernameFragment !== undefined) {
    if (typeof candidate.usernameFragment !== 'string' || candidate.usernameFragment.length > 256) throw new TypeError('private peer signal has an invalid username fragment');
    result.usernameFragment = candidate.usernameFragment;
  }
  if (!result.type && result.candidate === undefined) throw new TypeError('private peer signal must contain an offer, answer, or ICE candidate');
  if (JSON.stringify(result).length > MAX_SIGNAL_BYTES) throw new TypeError('private peer signal is too large');
  return result;
}

export function serializePrivatePeerSignal(signal) {
  return JSON.stringify(signalPayload(signal));
}

function peerConnection(value) {
  return value && typeof value === 'object'
    && typeof value.signal === 'function'
    && typeof value.on === 'function'
    && typeof value.destroy === 'function';
}

/**
 * Create the simple-peer connection used by WebTorrent's `torrent.addPeer`.
 * Nostr carries the serialized simple-peer signal messages in the transfer
 * contract's `ice` array; it never carries a peer object or local path.
 */
export function createPrivatePeer(peerFactory, { initiator = false, ice = [], onSignal, trickle = false } = {}) {
  if (typeof peerFactory !== 'function') throw new TypeError('a simple-peer factory is required for private WebTorrent transfer');
  const peer = new peerFactory({ initiator: Boolean(initiator), trickle: Boolean(trickle) });
  if (!peerConnection(peer)) throw new TypeError('simple-peer factory did not return a compatible peer');
  if (typeof onSignal === 'function') {
    peer.on('signal', signal => onSignal(serializePrivatePeerSignal(signal)));
  }
  if (!Array.isArray(ice) || ice.length > 32) throw new TypeError('private peer handoff must contain at most 32 signals');
  for (const signal of ice) peer.signal(signalPayload(signal));
  return peer;
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

export function addPrivateTorrent(client, id, {
  path,
  peer,
  peerFactory,
  initiator = false,
  ice = [],
  onSignal,
  trickle = false,
  onProgress,
  onDone,
  onError,
} = {}) {
  if (!client || typeof client.add !== 'function') throw new TypeError('a WebTorrent client is required');
  const handoffPeer = peer || (peerFactory ? createPrivatePeer(peerFactory, { initiator, ice, onSignal, trickle }) : null);
  if (!peerConnection(handoffPeer)) {
    throw new TypeError('private WebTorrent transfer requires a WebRTC peer handoff');
  }
  const torrent = client.add(torrentID(id), {
    path,
    announce: [],
    dht: false,
    tracker: false,
    utPex: false,
    lsd: false,
    private: true,
  });
  const attachPeer = () => {
    if (!torrent.infoHash) throw new Error('private peer handoff requires torrent metadata');
    const added = torrent.addPeer?.(handoffPeer);
    if (added === false) throw new Error('private WebTorrent peer handoff was rejected');
    return added;
  };
  if (torrent.infoHash) {
    attachPeer();
  } else if (typeof torrent.once === 'function') {
    torrent.once('infoHash', attachPeer);
    torrent.once('error', error => onError?.(error));
  } else {
    throw new Error('private torrent did not expose a metadata-ready event');
  }
  torrent.on?.('download', () => onProgress?.(progressPayload(torrent, 'private')));
  torrent.on?.('done', () => onDone?.(progressPayload(torrent, 'private')));
  torrent.on?.('error', error => onError?.(error));
  return torrent;
}
