import type { Torrent, ClientOptions, TorrentClient, WebRTC, IceServer, SeedOptions } from './torrent-types';

interface BridgeOptions {
  clientFactory?: (options: ClientOptions) => Promise<TorrentClient>;
  webRTCFactory?: (() => Promise<WebRTC | null>) | null;
  dataDir?: string; trackers?: readonly string[]; iceServers?: readonly IceServer[];
  downloadLimit?: unknown; uploadLimit?: unknown;
}

interface SeedResult {
  torrent?: Torrent;
  descriptor: { version: number; privacy: string; announce: string[]; info: { name: string; 'piece length': number; source: string; length?: number } };
  summary: ReturnType<typeof torrentSummary>;
}
interface AddOptions { path?: string; announce?: string[]; deselect?: boolean; bookId?: string }
interface SelectedOptions extends AddOptions {
  fileName?: string; signal?: AbortSignal; maxBytes?: number;
  onProgress?(progress: { bytes: number; totalBytes: number; peers: number }): void;
}

'use strict';

const path = require('node:path') as typeof import('node:path');
const net = require('node:net') as typeof import('node:net');

const PUBLIC_TRACKERS = Object.freeze([
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
]);
const PUBLIC_ICE_SERVERS = Object.freeze([
  Object.freeze({ urls: 'stun:stun.cloudflare.com:3478' }),
  Object.freeze({ urls: 'stun:stun.l.google.com:19302' }),
]);
const DEFAULT_DOWNLOAD_LIMIT = 10 * 1000 * 1000;
const PUBLIC_UPLOAD_LIMIT = 1000 * 1000;
const MAX_TRANSFER_LIMIT = 1000 * 1000 * 1000;
const MAX_ACTIVE_TORRENTS = 100;
const MAX_CONNECTIONS_PER_TORRENT = 16;
const PIECE_LENGTH = 256 * 1024;

function safeDigest(value: unknown) {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError('sha256 must be a 64-character hexadecimal digest');
  return digest;
}

function safeExtension(value: unknown) {
  const extension = String(value || 'epub').trim().toLowerCase().replace(/^\./, '');
  if (!/^[a-z0-9][a-z0-9+.-]{0,15}$/.test(extension)) throw new TypeError('extension must be a short safe file extension');
  return extension;
}

function safePath(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new TypeError('filePath must be a valid local path');
  return path.resolve(value);
}

function safeCounter(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function safeTransferLimit(value: unknown, fallback: number) {
  const rate = Number(value);
  if (rate === -1) return -1;
  if (!Number.isFinite(rate) || rate < 16 * 1000 || rate > MAX_TRANSFER_LIMIT) return fallback;
  return Math.round(rate);
}

function safePeerAddress(value: unknown) {
  const peer = String(value || '').trim();
  // WebTorrent accepts an address string for Node/TCP peers. Do not accept
  // hostnames here: this value can arrive through the renderer IPC boundary,
  // and resolving arbitrary names would turn private transfer into SSRF.
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}:(\d{1,5})$/;
  const ipv6 = /^\[([0-9a-f:]+)\]:(\d{1,5})$/i;
  const ipv4Match = ipv4.exec(peer);
  const ipv6Match = ipv6.exec(peer);
  const match = ipv4Match || ipv6Match;
  const port = Number(match?.[ipv4Match ? 1 : 2]);
  const host = ipv4Match ? peer.slice(0, peer.lastIndexOf(':')) : ipv6Match?.[1];
  if (!match || !net.isIP(host!) || port < 1 || port > 65535) {
    throw new TypeError('private peer handoff must be an IP address and port');
  }
  return peer;
}

function seedOptions({ sha256, extension, trackers }: { sha256: unknown; extension: unknown; trackers: string[] }): SeedOptions {
  const digest = safeDigest(sha256);
  const ext = safeExtension(extension);
  return {
    name: `${digest}.${ext}`,
    announceList: trackers.map(url => [url]),
    pieceLength: PIECE_LENGTH,
    info: {
      source: `bookstr-public-v1:${digest}`,
    },
  };
}

function torrentSummary(torrent: Torrent | null | undefined, privacy: 'private' | 'public') {
  if (!torrent) return null;
  const seededBookIds = torrent.bookstrSeedingBookIds instanceof Set
    ? [...torrent.bookstrSeedingBookIds].map(value => String(value || '')).filter(Boolean)
    : [];
  const torrentFile = torrent.torrentFile && Buffer.isBuffer(torrent.torrentFile)
    ? torrent.torrentFile.toString('base64')
    : '';
  const seeding = seededBookIds.length > 0 || Boolean(torrent.done || Number(torrent.progress) >= 1);
  const bookIds = seededBookIds.length
    ? seededBookIds
    : seeding && torrent.bookstrBookId ? [String(torrent.bookstrBookId)] : [];
  return {
    infoHash: String(torrent.infoHash || torrent.infohash || ''),
    bookId: bookIds[0] || String(torrent.bookstrBookId || ''),
    ...(bookIds.length ? { bookIds } : {}),
    name: String(torrent.name || ''),
    magnetURI: String(torrent.magnetURI || ''),
    torrentFile,
    privacy,
    progress: Math.min(1, safeCounter(torrent.progress)),
    downloaded: safeCounter(torrent.downloaded),
    uploaded: safeCounter(torrent.uploaded),
    peers: Array.isArray(torrent.wires) ? torrent.wires.length : Number(torrent.numPeers || 0),
    downloadSpeed: safeCounter(torrent.downloadSpeed),
    uploadSpeed: safeCounter(torrent.uploadSpeed),
    seeding,
  };
}

class WebTorrentBridge {
  declare readonly clientFactory: (options: ClientOptions) => Promise<TorrentClient>;
  declare readonly webRTCFactory: (() => Promise<WebRTC | null>) | null;
  declare readonly dataDir: string | undefined;
  declare trackers: string[];
  declare readonly iceServers: readonly IceServer[];
  declare downloadLimit: number;
  declare uploadLimit: number;
  declare client: TorrentClient | null;
  declare startPromise: Promise<TorrentClient> | null;
  declare webRTCEnabled: boolean;
  declare pendingTorrentAdds: number;
  declare capacityMutex: Promise<void>;
  constructor({ clientFactory, webRTCFactory, dataDir, trackers = PUBLIC_TRACKERS, iceServers = PUBLIC_ICE_SERVERS, downloadLimit = DEFAULT_DOWNLOAD_LIMIT, uploadLimit = PUBLIC_UPLOAD_LIMIT }: BridgeOptions = {}) {
    this.clientFactory = clientFactory || (async options => {
      const module = await import('webtorrent');
      const Client = module.default || module;
      return new Client(options);
    });
    this.webRTCFactory = webRTCFactory || (clientFactory ? null : async () => {
      try {
        return require('@roamhq/wrtc') as WebRTC;
      } catch (error) {
        console.warn(`WebRTC torrent peers are unavailable: ${(error as Error)?.message || error}`);
        return null;
      }
    });
    this.dataDir = dataDir ? path.resolve(dataDir) : undefined;
    this.trackers = [...new Set(trackers.map(value => String(value || '').trim()).filter(value => /^wss?:\/\//i.test(value)))];
    if (!this.trackers.length) this.trackers = [...PUBLIC_TRACKERS];
    this.iceServers = Array.isArray(iceServers) ? iceServers.filter(server => server && typeof server === 'object') : [];
    this.downloadLimit = safeTransferLimit(downloadLimit, DEFAULT_DOWNLOAD_LIMIT);
    this.uploadLimit = safeTransferLimit(uploadLimit, PUBLIC_UPLOAD_LIMIT);
    this.client = null;
    this.startPromise = null;
    this.webRTCEnabled = false;
    this.pendingTorrentAdds = 0;
    // Serialize capacity checks so concurrent add/seed cannot oversubscribe
    // while an eviction await yields the event loop.
    this.capacityMutex = Promise.resolve();
  }

  async start(): Promise<TorrentClient> {
    if (this.client) return this.client;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      const wrtc = await this.webRTCFactory?.();
      this.webRTCEnabled = Boolean(wrtc?.RTCPeerConnection);
      this.client = await this.clientFactory({
        downloadLimit: this.downloadLimit,
        uploadLimit: this.uploadLimit,
        maxConns: MAX_CONNECTIONS_PER_TORRENT,
        path: this.dataDir,
        ...(this.webRTCEnabled ? {
          tracker: {
            wrtc,
            rtcConfig: { iceServers: this.iceServers },
          },
        } : {}),
      });
      if (typeof this.client.throttleDownload === 'function') this.client.throttleDownload(this.downloadLimit);
      if (typeof this.client.throttleUpload === 'function') this.client.throttleUpload(this.uploadLimit);
      return this.client;
    })().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async setLimits({ downloadLimit, uploadLimit }: { downloadLimit?: unknown; uploadLimit?: unknown } = {}) {
    this.downloadLimit = safeTransferLimit(downloadLimit, this.downloadLimit);
    this.uploadLimit = safeTransferLimit(uploadLimit, this.uploadLimit);
    if (this.client) {
      this.client.throttleDownload?.(this.downloadLimit);
      this.client.throttleUpload?.(this.uploadLimit);
    }
    return { downloadLimit: this.downloadLimit, uploadLimit: this.uploadLimit };
  }

  async seedPublic(filePath: unknown, { sha256, extension = 'epub', size, publicSeedAllowed = true, bookId, onSeed }: { sha256?: unknown; extension?: unknown; size?: unknown; publicSeedAllowed?: boolean; bookId?: string; onSeed?: (result: SeedResult) => void } = {}): Promise<SeedResult> {
    if (!publicSeedAllowed) throw new Error('rights policy does not allow public seeding');
    const input = safePath(filePath);
    const client = await this.start();
    const opts = seedOptions({ sha256, extension, trackers: this.trackers });
    if (this.dataDir) opts.path = this.dataDir;
    await this.#reserveCapacity(client);
    return new Promise<SeedResult>((resolve, reject) => {
      let settled = false;
      const finish = (torrent?: Torrent) => {
        if (settled) return;
        settled = true;
        if (torrent && bookId) torrent.bookstrBookId = String(bookId);
        const result = {
          torrent,
          descriptor: {
            version: 1,
            privacy: 'public',
            announce: [...this.trackers],
            info: {
              name: opts.name,
              'piece length': PIECE_LENGTH,
              source: opts.info.source,
              ...(Number.isSafeInteger(Number(size)) ? { length: Number(size) } : {}),
            },
          },
          summary: torrentSummary(torrent, 'public'),
        };
        if (typeof onSeed === 'function') onSeed(result);
        resolve(result);
      };
      try {
        const returned = client.seed(input, opts, finish);
        this.#releaseCapacityReservation();
        // Test doubles and some compatible clients return a ready torrent but
        // do not invoke the callback; real WebTorrent always invokes it.
        if (returned?.ready && !settled) finish(returned);
      } catch (error) {
        this.#releaseCapacityReservation();
        reject(error);
      }
    });
  }

  async addPublic(torrentId: string | Buffer, { path: downloadPath, announce, deselect = false, bookId }: AddOptions = {}) {
    const client = await this.start();
    const existing = typeof client.get === 'function' ? await client.get(torrentId).catch(() => null) : null;
    if (existing && !existing.destroyed) {
      if (bookId) {
        existing.bookstrBookId = String(bookId);
        existing.bookstrBookIds ||= new Set();
        existing.bookstrBookIds.add(String(bookId));
      }
      return existing;
    }
    if (existing) await this.remove(existing);
    const options = {
      path: downloadPath ? safePath(downloadPath) : this.dataDir,
      announce: Array.isArray(announce) && announce.length ? announce : this.trackers,
      deselect: deselect === true,
    };
    await this.#reserveCapacity(client);
    let torrent;
    try {
      torrent = client.add(torrentId, options);
    } finally {
      this.#releaseCapacityReservation();
    }
    if (torrent && bookId) {
      torrent.bookstrBookId = String(bookId);
      torrent.bookstrBookIds ||= new Set();
      torrent.bookstrBookIds.add(String(bookId));
    }
    return torrent;
  }

  async downloadSelected(torrentId: string | Buffer, { path: downloadPath, fileName, bookId, signal, maxBytes, onProgress }: SelectedOptions = {}) {
    const wantedName = String(fileName || '').trim().toLowerCase();
    if (!wantedName || wantedName.includes('/') || wantedName.includes('\\')) {
      throw new TypeError('selected torrent file name is invalid');
    }
    const torrent = await this.addPublic(torrentId, { path: downloadPath, deselect: true, bookId });
    try {
      if (signal?.aborted) throw new Error('torrent download aborted');
      const waitForMetadata = async () => {
        if (Array.isArray(torrent.files) && torrent.files.length) return;
        if (typeof torrent.once !== 'function') throw new Error('torrent did not expose metadata events');
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: unknown) => {
            signal?.removeEventListener?.('abort', abort);
            if (error) reject(error); else resolve();
          };
          const abort = () => finish(new Error('torrent download aborted'));
          torrent.once('metadata', () => finish());
          torrent.once('error', finish);
          signal?.addEventListener?.('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
      };
      await waitForMetadata();
      const file = torrent.files.find(candidate => {
        const name = path.basename(String(candidate.path || candidate.name || '')).toLowerCase();
        return name === wantedName || /^[a-f0-9]{32}$/.test(wantedName)
          && name.replace(/\.(?:epub|pdf|cbz|cbr)$/, '') === wantedName;
      });
      if (!file) throw new Error(`${wantedName} is absent from the repository torrent`);
      const limit = Number(maxBytes);
      if (Number.isFinite(limit) && limit > 0 && Number(file.length) > limit) {
        throw new Error('selected torrent file exceeds the maximum acquisition size');
      }
      if (typeof file.select !== 'function') throw new Error('selected torrent file cannot be downloaded');
      if (signal?.aborted) throw new Error('torrent download aborted');
      file.select(10);
      const report = () => onProgress?.({
        bytes: safeCounter(file.downloaded),
        totalBytes: safeCounter(file.length),
        peers: Array.isArray(torrent.wires) ? torrent.wires.length : Number(torrent.numPeers || 0),
      });
      report();
      if (!file.done) {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (error?: unknown) => {
            if (settled) return;
            settled = true;
            torrent.removeListener?.('download', report);
            signal?.removeEventListener?.('abort', abort);
            if (error) reject(error); else resolve();
          };
          const abort = () => finish(new Error('torrent download aborted'));
          torrent.on?.('download', report);
          file.once?.('done', () => finish());
          torrent.once?.('error', error => finish(error));
          signal?.addEventListener?.('abort', abort, { once: true });
        });
      }
      report();
      const root = safePath(torrent.path || downloadPath || this.dataDir);
      const filePath = path.resolve(root, String(file.path || file.name || ''));
      const relative = path.relative(root, filePath);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('selected torrent file escaped its download directory');
      }
      return { torrent, file, filePath };
    } catch (error) {
      await this.remove(torrent);
      throw error;
    }
  }

  async remove(torrent: Torrent | null | undefined) {
    if (!torrent) return;
    if (this.client && typeof this.client.remove === 'function') {
      try {
        await this.client.remove(torrent);
        return;
      } catch { /* fall through to direct cleanup */ }
    }
    try { torrent.destroy?.(); } catch { /* best effort cleanup */ }
  }

  async downloadPublic(torrentId: string | Buffer, options: AddOptions = {}) {
    const torrent = await this.addPublic(torrentId, options);
    if (torrent.done) return torrent;
    if (typeof torrent.once !== 'function') throw new Error('Public torrent does not expose completion events.');
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        torrent.removeListener?.('error', fail);
        resolve();
      };
      const fail = (error: unknown) => {
        torrent.removeListener?.('done', finish);
        reject(error);
      };
      torrent.once('done', finish);
      torrent.once('error', fail);
    });
    return torrent;
  }

  async addPrivate(torrentId: string | Buffer, { path: downloadPath, peer }: { path?: string; peer?: unknown } = {}) {
    const peerAddress = safePeerAddress(peer);
    const client = await this.start();
    await this.#reserveCapacity(client);
    let torrent;
    try {
      torrent = client.add(torrentId, {
        path: downloadPath ? safePath(downloadPath) : this.dataDir,
        private: true,
        announce: [],
        dht: false,
        tracker: false,
        utPex: false,
        lsd: false,
      });
    } finally {
      this.#releaseCapacityReservation();
    }
    // An info hash is available synchronously for the supported private
    // handoff inputs (magnet/info-hash/torrent bytes). If a compatible client
    // resolves it asynchronously, wait for the same event before calling the
    // WebTorrent API; addPeer() is invalid before that point.
    if (torrent.infoHash) {
      this.addPeer(torrent, peerAddress);
    } else if (typeof torrent.once === 'function') {
      await new Promise<void>((resolve, reject) => {
        const onInfoHash = () => {
          try {
            this.addPeer(torrent, peerAddress);
            resolve();
          } catch (error) {
            reject(error);
          }
        };
        torrent.once('infoHash', onInfoHash);
        torrent.once('error', reject);
      });
    } else {
      throw new Error('private torrent did not expose an info hash before peer handoff');
    }
    return torrent;
  }

  async #reserveCapacity(client: TorrentClient) {
    let release!: () => void;
    const previous = this.capacityMutex;
    this.capacityMutex = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      while (Array.isArray(client.torrents)
        && client.torrents.length + this.pendingTorrentAdds >= MAX_ACTIVE_TORRENTS) {
        // Completed swarms can be removed without deleting their on-disk data.
        // Retire the oldest completed swarm so new work can proceed while
        // keeping the total number of peer managers bounded.
        const completed = client.torrents.find(torrent => torrent.done || Number(torrent.progress) >= 1);
        if (!completed) {
          throw new Error(`maximum active torrent count reached (${MAX_ACTIVE_TORRENTS}); retry after a transfer completes`);
        }
        await this.remove(completed);
      }
      this.pendingTorrentAdds += 1;
    } finally {
      release();
    }
  }

  #releaseCapacityReservation() {
    this.pendingTorrentAdds = Math.max(0, this.pendingTorrentAdds - 1);
  }

  addPeer(torrent: Torrent | null | undefined, peer: string) {
    if (!torrent || typeof torrent.addPeer !== 'function') throw new TypeError('torrent does not support peer connections');
    if (!peer) throw new TypeError('peer is required');
    return torrent.addPeer(peer);
  }

  active() {
    return this.client && Array.isArray(this.client.torrents)
      ? this.client.torrents.map(torrent => torrentSummary(torrent, torrent.private ? 'private' : 'public'))
      : [];
  }

  async stopSeeding() {
    if (!this.client || !Array.isArray(this.client.torrents)) return { stopped: 0 };
    const torrents = [...this.client.torrents].filter(torrent => (
      torrent.bookstrSeedingBookIds instanceof Set
      || torrent.done
      || Number(torrent.progress) >= 1
    ));
    for (const torrent of torrents) await this.remove(torrent);
    return { stopped: torrents.length };
  }

  async stop() {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    await new Promise<void>(resolve => {
      try {
        client.destroy(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}

export = {
  WebTorrentBridge,
  PUBLIC_TRACKERS,
  PUBLIC_ICE_SERVERS,
  DEFAULT_DOWNLOAD_LIMIT,
  PUBLIC_UPLOAD_LIMIT,
  PIECE_LENGTH,
  safePeerAddress,
};
