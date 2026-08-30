import assert from 'node:assert/strict';
import test from 'node:test';
import { addPrivateTorrent, addPublicTorrent, createPrivatePeer, seedPublicTorrent, serializePrivatePeerSignal } from '../webtorrent-transfer.js';

class FakeTorrent {
  constructor() { this.listeners = new Map(); this.infoHash = 'd'.repeat(40); this.progress = 1; }
  on(name, callback) { this.listeners.set(name, callback); return this; }
  addPeer(peer) { this.peer = peer; return true; }
  emit(name, value) { this.listeners.get(name)?.(value); }
}

class FakePeer {
  constructor(options) { this.options = options; this.listeners = new Map(); this.signals = []; }
  on(name, callback) { this.listeners.set(name, callback); return this; }
  signal(value) { this.signals.push(value); }
  emit(name, value) { this.listeners.get(name)?.(value); }
  destroy() {}
}

test('browser public adapter uses WSS trackers and canonical metadata', async () => {
  const log = {};
  const client = {
    seed(file, opts, callback) { log.seed = { file, opts }; callback(Object.assign(new FakeTorrent(), { numPeers: 2 })); },
  };
  const result = await seedPublicTorrent(client, { name: 'book.epub', size: 3 }, { sha256: 'e'.repeat(64) });
  assert.equal(log.seed.opts.name, `${'e'.repeat(64)}.epub`);
  assert.deepEqual(log.seed.opts.announceList, [['wss://tracker.openwebtorrent.com'], ['wss://tracker.webtorrent.dev']]);
  assert.equal(result.summary.privacy, 'public');
});

test('browser public and private adapters configure discovery boundaries', () => {
  const calls = [];
  const client = {
    add(id, opts) { const torrent = new FakeTorrent(); calls.push({ id, opts, torrent }); return torrent; },
  };
  addPublicTorrent(client, 'magnet:?xt=urn:btih:abc');
  const peer = new FakePeer({});
  addPrivateTorrent(client, 'magnet:?xt=urn:btih:def', { peer });
  assert.equal(calls[0].opts.announce.length, 2);
  assert.deepEqual(calls[1].opts.announce, []);
  assert.equal(calls[1].opts.dht, false);
  assert.equal(calls[1].opts.tracker, false);
  assert.equal(calls[1].opts.private, true);
  assert.equal(calls[1].torrent.peer, peer);
  assert.throws(() => addPrivateTorrent(client, 'magnet:?xt=urn:btih:def'), /peer handoff/);
});

test('browser private adapter turns encrypted offer/answer signals into a WebTorrent peer', () => {
  const signals = [];
  const peer = createPrivatePeer(FakePeer, {
    initiator: false,
    ice: [JSON.stringify({ type: 'offer', sdp: 'v=0' })],
    onSignal: signal => signals.push(signal),
  });
  assert.equal(peer.options.initiator, false);
  assert.equal(peer.options.trickle, false);
  assert.deepEqual(peer.signals, [{ type: 'offer', sdp: 'v=0' }]);
  peer.emit('signal', { type: 'answer', sdp: 'v=1' });
  assert.deepEqual(signals, [JSON.stringify({ type: 'answer', sdp: 'v=1' })]);
  assert.throws(() => createPrivatePeer(FakePeer, { ice: ['not-json'] }), /JSON/);
});

test('browser adapter rejects malformed metadata', () => {
  assert.throws(() => addPublicTorrent(null, ''), /client/);
  assert.throws(() => seedPublicTorrent({ seed() {} }, {}, { sha256: 'bad' }), /sha256/);
});

test('browser transfer adapter validates signals and reports public lifecycle events', async () => {
  assert.equal(serializePrivatePeerSignal({ candidate: 'candidate:1', sdpMid: null, sdpMLineIndex: 0, usernameFragment: 'u' }), '{"candidate":"candidate:1","sdpMid":null,"sdpMLineIndex":0,"usernameFragment":"u"}');
  for (const value of [null, [], '{}', '{bad', { type: 'invalid' }, { sdp: 'v=0' }, { candidate: 2 }, { type: 'offer', sdpMLineIndex: -1 }]) {
    assert.throws(() => serializePrivatePeerSignal(value), /private peer signal/);
  }
  assert.throws(() => createPrivatePeer(null), /factory/);
  function IncompatiblePeer() { return {}; }
  assert.throws(() => createPrivatePeer(IncompatiblePeer), /compatible/);
  assert.throws(() => createPrivatePeer(FakePeer, { ice: Array(33).fill({ type: 'offer' }) }), /at most 32/);

  const torrent = new FakeTorrent();
  torrent.downloaded = 4;
  torrent.uploaded = 2;
  torrent.numPeers = 3;
  const events = [];
  const returned = addPublicTorrent({ add: () => torrent }, ' id ', {
    trackers: ['wss://one.example', 'invalid', 'wss://one.example'],
    onProgress: value => events.push(['progress', value]),
    onDone: value => events.push(['done', value]),
    onError: error => events.push(['error', error.message]),
  });
  assert.equal(returned, torrent);
  torrent.emit('download');
  torrent.emit('done');
  torrent.emit('error', new Error('network'));
  assert.deepEqual(events, [
    ['progress', { infoHash: 'd'.repeat(40), progress: 1, downloaded: 4, uploaded: 2, peers: 3, privacy: 'public' }],
    ['done', { infoHash: 'd'.repeat(40), progress: 1, downloaded: 4, uploaded: 2, peers: 3, privacy: 'public' }],
    ['error', 'network'],
  ]);

  const uploads = [];
  const seedClient = {
    on(name, callback) { assert.equal(name, 'upload'); this.upload = callback; },
    seed(_file, _options, callback) { callback(new FakeTorrent()); },
  };
  await seedPublicTorrent(seedClient, { size: 1 }, { sha256: 'a'.repeat(64), trackers: ['wss://one.example'], onProgress: event => uploads.push(event) });
  seedClient.upload();
  assert.equal(uploads[0].privacy, 'public');
});
