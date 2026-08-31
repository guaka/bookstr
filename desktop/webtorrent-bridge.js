'use strict';

const path = require('node:path');
const net = require('node:net');

const PUBLIC_TRACKERS = Object.freeze([
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
]);
const PUBLIC_UPLOAD_LIMIT = 1024 * 1024;
const PIECE_LENGTH = 256 * 1024;

function safeDigest(value) {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError('sha256 must be a 64-character hexadecimal digest');
  return digest;
}

function safeExtension(value) {
  const extension = String(value || 'epub').trim().toLowerCase().replace(/^\./, '');
  if (!/^[a-z0-9][a-z0-9+.-]{0,15}$/.test(extension)) throw new TypeError('extension must be a short safe file extension');
  return extension;
}

function safePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new TypeError('filePath must be a valid local path');
  return path.resolve(value);
}

function safePeerAddress(value) {
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
  if (!match || !net.isIP(host) || port < 1 || port > 65535) {
    throw new TypeError('private peer handoff must be an IP address and port');
  }
  return peer;
}

function seedOptions({ sha256, extension, trackers }) {
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

function torrentSummary(torrent, privacy) {
  if (!torrent) return null;
  const torrentFile = torrent.torrentFile && Buffer.isBuffer(torrent.torrentFile)
    ? torrent.torrentFile.toString('base64')
    : '';
  return {
    infoHash: String(torrent.infoHash || torrent.infohash || ''),
    name: String(torrent.name || ''),
    magnetURI: String(torrent.magnetURI || ''),
    torrentFile,
    privacy,
    progress: Number.isFinite(Number(torrent.progress)) ? Number(torrent.progress) : 0,
    downloaded: Number(torrent.downloaded || 0),
    uploaded: Number(torrent.uploaded || 0),
    peers: Array.isArray(torrent.wires) ? torrent.wires.length : Number(torrent.numPeers || 0),
  };
}

class WebTorrentBridge {
  constructor({ clientFactory, dataDir, trackers = PUBLIC_TRACKERS, uploadLimit = PUBLIC_UPLOAD_LIMIT } = {}) {
    this.clientFactory = clientFactory || (async options => {
      const module = await import('webtorrent');
      const Client = module.default || module;
      return new Client(options);
    });
    this.dataDir = dataDir ? path.resolve(dataDir) : undefined;
    this.trackers = [...new Set(trackers.map(value => String(value || '').trim()).filter(value => /^wss?:\/\//i.test(value)))];
    if (!this.trackers.length) this.trackers = [...PUBLIC_TRACKERS];
    this.uploadLimit = Number.isFinite(Number(uploadLimit)) && Number(uploadLimit) >= 0
      ? Math.round(Number(uploadLimit))
      : PUBLIC_UPLOAD_LIMIT;
    this.client = null;
  }

  async start() {
    if (this.client) return this.client;
    this.client = await this.clientFactory({
      uploadLimit: this.uploadLimit,
      path: this.dataDir,
    });
    if (typeof this.client.throttleUpload === 'function') this.client.throttleUpload(this.uploadLimit);
    return this.client;
  }

  async seedPublic(filePath, { sha256, extension = 'epub', size, publicSeedAllowed = true, onSeed } = {}) {
    if (!publicSeedAllowed) throw new Error('rights policy does not allow public seeding');
    const input = safePath(filePath);
    const client = await this.start();
    const opts = seedOptions({ sha256, extension, trackers: this.trackers });
    if (this.dataDir) opts.path = this.dataDir;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = torrent => {
        if (settled) return;
        settled = true;
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
        // Test doubles and some compatible clients return a ready torrent but
        // do not invoke the callback; real WebTorrent always invokes it.
        if (returned?.ready && !settled) finish(returned);
      } catch (error) {
        reject(error);
      }
    });
  }

  async addPublic(torrentId, { path: downloadPath, announce, deselect = false } = {}) {
    const client = await this.start();
    const options = {
      path: downloadPath ? safePath(downloadPath) : this.dataDir,
      announce: Array.isArray(announce) && announce.length ? announce : this.trackers,
      deselect: deselect === true,
    };
    return client.add(torrentId, options);
  }

  async downloadSelected(torrentId, { path: downloadPath, fileName, signal, maxBytes, onProgress } = {}) {
    const wantedName = String(fileName || '').trim().toLowerCase();
    if (!wantedName || wantedName.includes('/') || wantedName.includes('\\')) {
      throw new TypeError('selected torrent file name is invalid');
    }
    const torrent = await this.addPublic(torrentId, { path: downloadPath, deselect: true });
    try {
      const waitForMetadata = async () => {
        if (Array.isArray(torrent.files) && torrent.files.length) return;
        if (typeof torrent.once !== 'function') throw new Error('torrent did not expose metadata events');
        await new Promise((resolve, reject) => {
          const finish = error => {
            signal?.removeEventListener?.('abort', abort);
            if (error) reject(error); else resolve();
          };
          const abort = () => finish(new Error('torrent download aborted'));
          torrent.once('metadata', () => finish());
          torrent.once('error', finish);
          signal?.addEventListener?.('abort', abort, { once: true });
        });
      };
      await waitForMetadata();
      const file = torrent.files.find(candidate => path.basename(String(candidate.path || candidate.name || '')).toLowerCase() === wantedName);
      if (!file) throw new Error(`${wantedName} is absent from the repository torrent`);
      const limit = Number(maxBytes);
      if (Number.isFinite(limit) && limit > 0 && Number(file.length) > limit) {
        throw new Error('selected torrent file exceeds the maximum acquisition size');
      }
      if (typeof file.select !== 'function') throw new Error('selected torrent file cannot be downloaded');
      if (signal?.aborted) throw new Error('torrent download aborted');
      file.select(10);
      const report = () => onProgress?.({
        bytes: Number(file.downloaded || 0),
        totalBytes: Number(file.length || 0),
        peers: Array.isArray(torrent.wires) ? torrent.wires.length : Number(torrent.numPeers || 0),
      });
      report();
      if (!file.done) {
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = error => {
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
      try { torrent.destroy?.(); } catch { /* best effort cleanup */ }
      throw error;
    }
  }

  async addPrivate(torrentId, { path: downloadPath, peer } = {}) {
    const peerAddress = safePeerAddress(peer);
    const client = await this.start();
    const torrent = client.add(torrentId, {
      path: downloadPath ? safePath(downloadPath) : this.dataDir,
      private: true,
      announce: [],
      dht: false,
      tracker: false,
      utPex: false,
      lsd: false,
    });
    // An info hash is available synchronously for the supported private
    // handoff inputs (magnet/info-hash/torrent bytes). If a compatible client
    // resolves it asynchronously, wait for the same event before calling the
    // WebTorrent API; addPeer() is invalid before that point.
    if (torrent.infoHash) {
      this.addPeer(torrent, peerAddress);
    } else if (typeof torrent.once === 'function') {
      await new Promise((resolve, reject) => {
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

  addPeer(torrent, peer) {
    if (!torrent || typeof torrent.addPeer !== 'function') throw new TypeError('torrent does not support peer connections');
    if (!peer) throw new TypeError('peer is required');
    return torrent.addPeer(peer);
  }

  active() {
    return this.client && Array.isArray(this.client.torrents)
      ? this.client.torrents.map(torrent => torrentSummary(torrent, torrent.private ? 'private' : 'public'))
      : [];
  }

  async stop() {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    await new Promise(resolve => {
      try {
        client.destroy(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}

module.exports = {
  WebTorrentBridge,
  PUBLIC_TRACKERS,
  PUBLIC_UPLOAD_LIMIT,
  PIECE_LENGTH,
  safePeerAddress,
};
