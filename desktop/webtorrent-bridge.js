'use strict';

const path = require('node:path');

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

  async addPublic(torrentId, { path: downloadPath, announce } = {}) {
    const client = await this.start();
    const options = {
      path: downloadPath ? safePath(downloadPath) : this.dataDir,
      announce: Array.isArray(announce) && announce.length ? announce : this.trackers,
    };
    return client.add(torrentId, options);
  }

  async downloadPublic(torrentId, options = {}) {
    const torrent = await this.addPublic(torrentId, options);
    if (torrent.done) return torrent;
    if (typeof torrent.once !== 'function') throw new Error('Public torrent does not expose completion events.');
    await new Promise((resolve, reject) => {
      const finish = () => {
        torrent.removeListener?.('error', fail);
        resolve();
      };
      const fail = error => {
        torrent.removeListener?.('done', finish);
        reject(error);
      };
      torrent.once('done', finish);
      torrent.once('error', fail);
    });
    return torrent;
  }

  async addPrivate(torrentId, { path: downloadPath } = {}) {
    const client = await this.start();
    return client.add(torrentId, {
      path: downloadPath ? safePath(downloadPath) : this.dataDir,
      private: true,
      announce: [],
      dht: false,
      tracker: false,
      utPex: false,
      lsd: false,
    });
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
};
