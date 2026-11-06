// Browser-side WebTorrent adapter. The static web client injects a WebTorrent
// constructor/client so this module remains dependency-free and can also be
// reused by iOS/Android WebView adapters.

export const PUBLIC_TRACKERS = Object.freeze([
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
]);
export const PUBLIC_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: 'stun:stun.cloudflare.com:3478' }),
  Object.freeze({ urls: 'stun:stun.l.google.com:19302' }),
]);
export const PIECE_LENGTH = 256 * 1024;

type Progress = { infoHash: string; progress: number; downloaded: number; uploaded: number; peers: number; privacy: 'public' | 'private' };
type PrivatePeerSignal = {
  type?: string;
  sdp?: string;
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string;
};
type PeerSignalRecord = Record<string, unknown>;
type TransferFile = {
  path?: string;
  name?: string;
  length: number;
  downloaded?: number;
  select?(priority?: number): void;
  blob(): Promise<Blob>;
};
type Torrent = {
  infoHash?: string;
  progress?: number;
  downloaded?: number;
  uploaded?: number;
  numPeers?: number;
  files?: TransferFile[];
  on?(event: string, callback: (value?: unknown) => void): void;
  once?(event: string, callback: (value?: unknown) => void): void;
  addPeer?(peer: SimplePeer): boolean | void;
};
type SimplePeer = {
  signal(value: unknown): void;
  on(event: string, callback: (signal: unknown) => void): void;
  destroy(): void;
};
type WebTorrentClient = {
  seed(file: Blob, options: Record<string, unknown>, callback: (torrent: Torrent) => void): void;
  add(id: string, options: Record<string, unknown>, callback?: (torrent: Torrent) => void): Torrent;
  on?(event: string, callback: (value?: unknown) => void): void;
  infoHash?: string;
  progress?: number;
  downloaded?: number;
  uploaded?: number;
  numPeers?: number;
};
type PeerFactory = new(options: { initiator: boolean; trickle: boolean }) => SimplePeer;
type ProgressCallback = (progress: Progress) => void;

function torrentID(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new TypeError('torrentId must be a non-empty string');
  return value.trim();
}

function digest(value: unknown): string {
  const result = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new TypeError('sha256 must be a 64-character hexadecimal digest');
  return result;
}

function extension(value: unknown): string {
  const result = String(value || 'epub').trim().toLowerCase().replace(/^\./, '');
  if (!/^[a-z0-9][a-z0-9+.-]{0,15}$/.test(result)) throw new TypeError('extension must be a short safe file extension');
  return result;
}

function trackerList(trackers: unknown): string[] {
  const values = Array.isArray(trackers) ? trackers : PUBLIC_TRACKERS;
  return [...new Set(values.map((value: unknown) => String(value || '').trim()).filter(value => /^wss?:\/\//i.test(value)))];
}

const SIGNAL_TYPES = new Set(['offer', 'answer', 'pranswer', 'rollback']);
const MAX_SIGNAL_BYTES = 8192;

function signalPayload(value: unknown): PrivatePeerSignal {
  let candidate: unknown = value;
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
  const result: PrivatePeerSignal = {};
  if ((candidate as PeerSignalRecord).type !== undefined) {
    if (!SIGNAL_TYPES.has(String((candidate as PeerSignalRecord).type))) throw new TypeError('private peer signal has an invalid type');
    result.type = String((candidate as PeerSignalRecord).type);
  }
  if ((candidate as PeerSignalRecord).sdp !== undefined) {
    if (typeof (candidate as PeerSignalRecord).sdp !== 'string' || ((candidate as PeerSignalRecord).sdp as string).length > MAX_SIGNAL_BYTES) throw new TypeError('private peer signal has invalid SDP');
    result.sdp = (candidate as PeerSignalRecord).sdp as string;
  }
  if ((candidate as PeerSignalRecord).candidate !== undefined) {
    if (typeof (candidate as PeerSignalRecord).candidate !== 'string' || ((candidate as PeerSignalRecord).candidate as string).length > 2000) throw new TypeError('private peer signal has an invalid ICE candidate');
    result.candidate = (candidate as PeerSignalRecord).candidate as string;
  }
  if ((candidate as PeerSignalRecord).sdpMid !== undefined) {
    if ((candidate as PeerSignalRecord).sdpMid !== null && (typeof (candidate as PeerSignalRecord).sdpMid !== 'string' || ((candidate as PeerSignalRecord).sdpMid as string).length > 256)) throw new TypeError('private peer signal has an invalid SDP mid');
    result.sdpMid = (candidate as PeerSignalRecord).sdpMid as string | null;
  }
  if ((candidate as PeerSignalRecord).sdpMLineIndex !== undefined) {
    if ((candidate as PeerSignalRecord).sdpMLineIndex !== null && (!Number.isInteger((candidate as PeerSignalRecord).sdpMLineIndex) || ((candidate as PeerSignalRecord).sdpMLineIndex as number) < 0 || ((candidate as PeerSignalRecord).sdpMLineIndex as number) > 256)) throw new TypeError('private peer signal has an invalid SDP line index');
    result.sdpMLineIndex = (candidate as PeerSignalRecord).sdpMLineIndex as number | null;
  }
  if ((candidate as PeerSignalRecord).usernameFragment !== undefined) {
    if (typeof (candidate as PeerSignalRecord).usernameFragment !== 'string' || ((candidate as PeerSignalRecord).usernameFragment as string).length > 256) throw new TypeError('private peer signal has an invalid username fragment');
    result.usernameFragment = (candidate as PeerSignalRecord).usernameFragment as string;
  }
  if (!result.type && result.candidate === undefined) throw new TypeError('private peer signal must contain an offer, answer, or ICE candidate');
  if (JSON.stringify(result).length > MAX_SIGNAL_BYTES) throw new TypeError('private peer signal is too large');
  return result;
}

export function serializePrivatePeerSignal(signal: unknown): string {
  return JSON.stringify(signalPayload(signal));
}

function peerConnection(value: unknown): value is SimplePeer {
  return (value && typeof value === 'object'
    && typeof (value as Partial<SimplePeer>).signal === 'function'
    && typeof (value as Partial<SimplePeer>).on === 'function'
    && typeof (value as Partial<SimplePeer>).destroy === 'function') as boolean;
}

/**
 * Create the simple-peer connection used by WebTorrent's `torrent.addPeer`.
 * Nostr carries the serialized simple-peer signal messages in the transfer
 * contract's `ice` array; it never carries a peer object or local path.
 */
export function createPrivatePeer(peerFactory: PeerFactory, { initiator = false, ice = [], onSignal, trickle = false }: { initiator?: boolean; ice?: unknown[]; onSignal?: (signal: string) => void; trickle?: boolean } = {}): SimplePeer {
  if (typeof peerFactory !== 'function') throw new TypeError('a simple-peer factory is required for private WebTorrent transfer');
  const peer = new peerFactory({ initiator: Boolean(initiator), trickle: Boolean(trickle) });
  if (!peerConnection(peer)) throw new TypeError('simple-peer factory did not return a compatible peer');
  if (typeof onSignal === 'function') {
    peer.on('signal', (signal: unknown) => onSignal(serializePrivatePeerSignal(signal)));
  }
  if (!Array.isArray(ice) || ice.length > 32) throw new TypeError('private peer handoff must contain at most 32 signals');
  for (const signal of ice) peer.signal(signalPayload(signal));
  return peer;
}

function progressPayload(torrent: Torrent | WebTorrentClient, privacy: 'public' | 'private'): Progress {
  return {
    infoHash: String(torrent?.infoHash || ''),
    progress: Number.isFinite(Number(torrent?.progress)) ? Number(torrent.progress) : 0,
    downloaded: Number(torrent?.downloaded || 0),
    uploaded: Number(torrent?.uploaded || 0),
    peers: Number(torrent?.numPeers || 0),
    privacy,
  };
}

export function seedPublicTorrent(client: WebTorrentClient, file: Blob, { sha256, extension: ext = 'epub', trackers = PUBLIC_TRACKERS, onProgress, onSeed }: { sha256: string; extension?: string; trackers?: readonly string[]; onProgress?: ProgressCallback; onSeed?: (result: { torrent: Torrent; summary: Progress; trackers: string[] }) => void } ): Promise<{ torrent: Torrent; summary: Progress; trackers: string[] }> {
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

export function addPublicTorrent(client: WebTorrentClient, id: string, { path, trackers = PUBLIC_TRACKERS, onProgress, onDone, onError }: { path?: string; trackers?: readonly string[]; onProgress?: ProgressCallback; onDone?: ProgressCallback; onError?: (error: unknown) => void } = {}): Torrent {
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

export function downloadPublicTorrentFile(client: WebTorrentClient, id: string, {
  fileName,
  trackers = PUBLIC_TRACKERS,
  maxBytes = 512 * 1024 * 1024,
  onProgress,
}: { fileName: string; trackers?: readonly string[]; maxBytes?: number; onProgress?: (progress: Progress & { total: number }) => void }): Promise<{ blob: Blob; file: TransferFile; torrent: Torrent; summary: Progress }> {
  if (!client || typeof client.add !== 'function') throw new TypeError('a WebTorrent client is required');
  const wanted = String(fileName || '').trim().toLowerCase();
  if (!wanted || wanted.includes('/') || wanted.includes('\\')) throw new TypeError('fileName must be a safe torrent file name');
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('maxBytes must be a positive safe integer');
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error || 'WebTorrent failed')));
    };
    try {
      const torrent = client.add(id, {
        announce: trackerList(trackers),
        deselect: true,
      }, async (readyTorrent: Torrent) => {
        try {
          const file = readyTorrent.files?.find(candidate => (
            String(candidate?.path || candidate?.name || '').split(/[\\/]/).at(-1)?.toLowerCase() === wanted
          ));
          if (!file) throw new Error(`${wanted} is absent from the repository torrent`);
          if (!Number.isSafeInteger(Number(file.length)) || file.length <= 0 || file.length > limit) {
            throw new Error('torrent book file is invalid or exceeds the maximum size');
          }
          file.select?.(10);
          const report = () => onProgress?.({
            ...progressPayload(readyTorrent, 'public'),
            downloaded: Math.max(0, Number(file.downloaded || 0)),
            total: Number(file.length),
          });
          readyTorrent.on?.('download', report);
          report();
          const blob = await file.blob();
          report();
          if (settled) return;
          settled = true;
          resolve({ blob, file, torrent: readyTorrent, summary: progressPayload(readyTorrent, 'public') });
        } catch (error) {
          fail(error);
        }
      });
      torrent.on?.('error', fail);
    } catch (error) {
      fail(error);
    }
  });
}

export function addPrivateTorrent(client: WebTorrentClient, id: string, {
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
}: { path?: string; peer?: unknown; peerFactory?: PeerFactory; initiator?: boolean; ice?: unknown[]; onSignal?: (signal: string) => void; trickle?: boolean; onProgress?: ProgressCallback; onDone?: ProgressCallback; onError?: (error: unknown) => void } = {}): Torrent {
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
