import assert from 'node:assert/strict';
import test from 'node:test';
import { addPrivateTorrent, addPublicTorrent, createPrivatePeer, seedPublicTorrent } from '../webtorrent-transfer.js';

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
