'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  WebTorrentBridge,
  PUBLIC_TRACKERS,
  PUBLIC_UPLOAD_LIMIT,
} = require('../../webtorrent-bridge');

function fakeClientFactory(log) {
  return async options => {
    log.clientOptions = options;
    const client = {
      torrents: [],
      throttleUpload(rate) { log.throttle = rate; },
      seed(input, options, callback) {
        log.seed = { input, options };
        const torrent = { infoHash: 'a'.repeat(40), name: options.name, magnetURI: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), torrentFile: Buffer.from('metadata'), progress: 1, ready: true, wires: [] };
        client.torrents.push(torrent);
        callback(torrent);
        return torrent;
      },
      add(id, options) {
        log.adds.push({ id, options });
        const torrent = { infoHash: typeof id === 'string' ? id : 'b'.repeat(40), private: Boolean(options.private), addPeer(peer) { log.peer = peer; } };
        client.torrents.push(torrent);
        return torrent;
      },
      destroy(callback) { log.destroyed = true; callback?.(); },
    };
    return client;
  };
}

test('public seed enforces rights, stable naming, trackers, and upload cap', async () => {
  const log = { adds: [] };
  const bridge = new WebTorrentBridge({ clientFactory: fakeClientFactory(log), dataDir: '/tmp/bookstr' });
  const digest = 'c'.repeat(64);
  const result = await bridge.seedPublic('/tmp/example.epub', { sha256: digest, size: 42 });
  assert.equal(log.clientOptions.uploadLimit, PUBLIC_UPLOAD_LIMIT);
  assert.equal(log.throttle, PUBLIC_UPLOAD_LIMIT);
  assert.equal(log.seed.options.name, `${digest}.epub`);
  assert.deepEqual(log.seed.options.announceList, PUBLIC_TRACKERS.map(url => [url]));
  assert.equal(result.descriptor.info.length, 42);
  assert.equal(result.summary.magnetURI.startsWith('magnet:?xt=urn:btih:'), true);
  assert.equal(result.summary.torrentFile, Buffer.from('metadata').toString('base64'));
  await bridge.stop();
  assert.equal(log.destroyed, true);
});

test('private add disables all public discovery', async () => {
  const log = { adds: [] };
  const bridge = new WebTorrentBridge({ clientFactory: fakeClientFactory(log) });
  await assert.rejects(() => bridge.addPrivate('deadbeef', { path: '/tmp/books' }), /peer handoff/);
  const torrent = await bridge.addPrivate('deadbeef', { path: '/tmp/books', peer: '192.0.2.10:6881' });
  assert.deepEqual(log.adds[0].options.announce, []);
  assert.equal(log.adds[0].options.private, true);
  assert.equal(log.adds[0].options.dht, false);
  assert.equal(log.adds[0].options.tracker, false);
  assert.equal(log.adds[0].options.utPex, false);
  assert.equal(log.adds[0].options.lsd, false);
  assert.equal(log.peer, '192.0.2.10:6881');
  assert.equal(torrent.private, true);
  await assert.rejects(() => bridge.addPrivate('deadbeef', { peer: 'peer.example:6881' }), /IP address/);
});

test('public seeding requires explicit rights permission', async () => {
  const bridge = new WebTorrentBridge({ clientFactory: fakeClientFactory({ adds: [] }) });
  await assert.rejects(() => bridge.seedPublic('/tmp/book.epub', { sha256: 'd'.repeat(64), publicSeedAllowed: false }), /rights policy/);
});
