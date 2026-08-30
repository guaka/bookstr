import assert from 'node:assert/strict';
import test from 'node:test';
import { addPrivateTorrent, addPublicTorrent, seedPublicTorrent } from '../webtorrent-transfer.js';

class FakeTorrent {
  constructor() { this.listeners = new Map(); this.infoHash = 'd'.repeat(40); this.progress = 1; }
  on(name, callback) { this.listeners.set(name, callback); return this; }
  emit(name, value) { this.listeners.get(name)?.(value); }
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
    add(id, opts) { calls.push({ id, opts }); return new FakeTorrent(); },
  };
  addPublicTorrent(client, 'magnet:?xt=urn:btih:abc');
  addPrivateTorrent(client, 'magnet:?xt=urn:btih:def');
  assert.equal(calls[0].opts.announce.length, 2);
  assert.deepEqual(calls[1].opts.announce, []);
  assert.equal(calls[1].opts.dht, false);
  assert.equal(calls[1].opts.tracker, false);
  assert.equal(calls[1].opts.private, true);
});

test('browser adapter rejects malformed metadata', () => {
  assert.throws(() => addPublicTorrent(null, ''), /client/);
  assert.throws(() => seedPublicTorrent({ seed() {} }, {}, { sha256: 'bad' }), /sha256/);
});

