'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  WebTorrentBridge,
  PUBLIC_TRACKERS,
  PUBLIC_UPLOAD_LIMIT,
  safePeerAddress,
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

test('validates transfer inputs and uses safe public defaults', async () => {
  assert.equal(safePeerAddress('[2001:db8::1]:6881'), '[2001:db8::1]:6881');
  for (const peer of ['', '192.0.2.1:0', '192.0.2.1:65536', 'example.test:6881', '999.0.0.1:6881']) {
    assert.throws(() => safePeerAddress(peer), /IP address and port/);
  }
  const log = { adds: [] };
  const bridge = new WebTorrentBridge({
    clientFactory: fakeClientFactory(log),
    trackers: ['https://unsafe.example', 'wss://tracker.example', 'wss://tracker.example'],
    uploadLimit: -1,
  });
  await bridge.addPublic('public-id');
  assert.deepEqual(log.adds[0].options.announce, ['wss://tracker.example']);
  assert.equal(log.clientOptions.uploadLimit, PUBLIC_UPLOAD_LIMIT);
  await assert.rejects(() => bridge.seedPublic('', { sha256: 'f'.repeat(64) }), /valid local path/);
  await assert.rejects(() => bridge.seedPublic('/tmp/book.epub', { sha256: 'not-a-digest' }), /sha256/);
  await assert.rejects(() => bridge.seedPublic('/tmp/book.epub', { sha256: 'f'.repeat(64), extension: 'not/an-extension' }), /extension/);
});

test('private handoff waits for asynchronous metadata and bridge cleanup is safe', async () => {
  const events = {};
  const client = {
    torrents: [{ infohash: 'c'.repeat(40), numPeers: 2, downloaded: 7, uploaded: 3, private: true }],
    add() {
      return {
        once(name, handler) { events[name] = handler; },
        addPeer(peer) { events.peer = peer; },
      };
    },
    destroy() { throw new Error('already stopped'); },
  };
  const bridge = new WebTorrentBridge({ clientFactory: async () => client, dataDir: '/tmp/books' });
  const pending = bridge.addPrivate('private-id', { peer: '192.0.2.12:6881' });
  await new Promise(resolve => setImmediate(resolve));
  events.infoHash();
  await pending;
  assert.equal(events.peer, '192.0.2.12:6881');
  assert.deepEqual(bridge.active(), [{
    infoHash: 'c'.repeat(40), name: '', magnetURI: '', torrentFile: '', privacy: 'private', progress: 0, downloaded: 7, uploaded: 3, peers: 2,
  }]);
  await bridge.stop();
  assert.deepEqual(bridge.active(), []);
  await bridge.stop();

  const noPeerBridge = new WebTorrentBridge({ clientFactory: async () => ({ add: () => ({ infoHash: 'a'.repeat(40) }) }) });
  await assert.rejects(() => noPeerBridge.addPrivate('private-id', { peer: '192.0.2.12:6881' }), /does not support peer connections/);
});

test('repository torrent downloads only the selected MD5 file', async () => {
  const log = { adds: [] };
  const wanted = new EventEmitter();
  wanted.path = `r_1000/${'a'.repeat(32)}`;
  wanted.length = 42;
  wanted.downloaded = 0;
  wanted.done = false;
  wanted.select = priority => {
    log.priority = priority;
    setImmediate(() => {
      wanted.downloaded = wanted.length;
      wanted.done = true;
      wanted.emit('done');
    });
  };
  const torrent = new EventEmitter();
  torrent.path = '/tmp/bookstr-select';
  torrent.files = [{ path: `r_1000/${'b'.repeat(32)}`, length: 10 }, wanted];
  const bridge = new WebTorrentBridge({
    clientFactory: async () => ({
      torrents: [],
      add(id, options) {
        log.adds.push({ id, options });
        return torrent;
      },
    }),
  });
  const progress = [];
  const result = await bridge.downloadSelected(Buffer.from('torrent metadata'), {
    path: '/tmp/bookstr-select',
    fileName: 'a'.repeat(32),
    onProgress: value => progress.push(value),
  });
  assert.equal(log.adds[0].options.deselect, true);
  assert.equal(log.priority, 10);
  assert.equal(result.file, wanted);
  assert.equal(result.filePath, `/tmp/bookstr-select/r_1000/${'a'.repeat(32)}`);
  assert.deepEqual(progress.at(-1), { bytes: 42, totalBytes: 42, peers: 0 });
});

test('public download waits for completion', async () => {
  const log = { adds: [] };
  const bridge = new WebTorrentBridge({ clientFactory: async options => ({
    torrents: [],
    throttleUpload() {},
    add(id, addOptions) {
      log.adds.push({ id, options: addOptions });
      const torrent = new EventEmitter();
      torrent.infoHash = 'e'.repeat(40);
      torrent.files = [{ path: '/tmp/bookstr/book.epub' }];
      this.torrents.push(torrent);
      setImmediate(() => torrent.emit('done'));
      return torrent;
    },
    destroy(callback) { callback?.(); },
  }) });
  const torrent = await bridge.downloadPublic('magnet:?xt=urn:btih:test', { path: '/tmp/bookstr' });
  assert.equal(torrent.infoHash, 'e'.repeat(40));
  assert.equal(log.adds[0].options.path, '/tmp/bookstr');
});
