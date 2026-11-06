import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import type * as WebTorrentTransfer from '../src/webtorrent-transfer.js';

const require = createRequire(import.meta.url);
const {
  addPrivateTorrent, addPublicTorrent, createPrivatePeer, downloadPublicTorrentFile,
  PUBLIC_ICE_SERVERS, seedPublicTorrent, serializePrivatePeerSignal,
} = require('../webtorrent-transfer.js') as typeof WebTorrentTransfer;

type Listener = (value?: unknown) => void;
type FileFixture = { path?: string; name?: string; length: number; downloaded: number; priority?: number; select(priority?: number): void; blob(): Promise<Blob> };
type TestClient = Parameters<typeof addPublicTorrent>[0];
function asClient(value: object): TestClient { return value as unknown as TestClient; }
function asPeer(peer: FakePeer): NonNullable<Parameters<typeof addPrivateTorrent>[2]> extends { peer?: infer P } ? P : never {
  return peer as unknown as NonNullable<Parameters<typeof addPrivateTorrent>[2]> extends { peer?: infer P } ? P : never;
}

class FakeTorrent {
  listeners = new Map<string, Listener>();
  infoHash = 'd'.repeat(40);
  progress = 1;
  downloaded = 0;
  uploaded = 0;
  numPeers = 0;
  files: FileFixture[] = [];
  peer: FakePeer | undefined;
  on(name: string, callback: Listener) { this.listeners.set(name, callback); return this; }
  addPeer(peer: FakePeer) { this.peer = peer; return true; }
  emit(name: string, value?: unknown) { this.listeners.get(name)?.(value); }
}

class FakePeer {
  options: Record<string, unknown>;
  listeners = new Map<string, Listener>();
  signals: unknown[] = [];
  constructor(options: Record<string, unknown>) { this.options = options; }
  on(name: string, callback: Listener) { this.listeners.set(name, callback); return this; }
  signal(value: unknown) { this.signals.push(value); }
  emit(name: string, value?: unknown) { this.listeners.get(name)?.(value); }
  destroy() {}
}

test('browser public adapter uses WSS trackers and canonical metadata', async () => {
  const log: { seed?: { file: Blob; opts: Record<string, unknown> } } = {};
  const client = {
    seed(file: Blob, opts: Record<string, unknown>, callback: (torrent: FakeTorrent) => void) { log.seed = { file, opts }; callback(Object.assign(new FakeTorrent(), { numPeers: 2 })); },
  };
  const result = await seedPublicTorrent(asClient(client), new Blob(['book']), { sha256: 'e'.repeat(64) });
  assert.equal(log.seed?.opts.name, `${'e'.repeat(64)}.epub`);
  assert.deepEqual(log.seed?.opts.announceList, [['wss://tracker.openwebtorrent.com'], ['wss://tracker.webtorrent.dev']]);
  assert.equal(result.summary.privacy, 'public');
});

test('browser public and private adapters configure discovery boundaries', () => {
  const calls: Array<{ id: string; opts: Record<string, unknown>; torrent: FakeTorrent }> = [];
  const client = {
    add(id: string, opts: Record<string, unknown>) { const torrent = new FakeTorrent(); calls.push({ id, opts, torrent }); return torrent; },
  };
  addPublicTorrent(asClient(client), 'magnet:?xt=urn:btih:abc');
  const peer = new FakePeer({});
  addPrivateTorrent(asClient(client), 'magnet:?xt=urn:btih:def', { peer: asPeer(peer) });
  const publicCall = calls[0];
  const privateCall = calls[1];
  assert.ok(publicCall && privateCall);
  assert.equal((publicCall.opts.announce as string[][]).length, 2);
  assert.deepEqual(privateCall.opts.announce, []);
  assert.equal(privateCall.opts.dht, false);
  assert.equal(privateCall.opts.tracker, false);
  assert.equal(privateCall.opts.private, true);
  assert.equal(privateCall.torrent.peer, peer);
  assert.throws(() => addPrivateTorrent(asClient(client), 'magnet:?xt=urn:btih:def'), /peer handoff/);
});

test('browser torrent peers use multiple STUN services for direct connectivity', () => {
  assert.deepEqual(PUBLIC_ICE_SERVERS, [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ]);
});

test('browser WebTorrent downloads only the requested repository file', async () => {
  const events: Array<{ downloaded: number; total: number; peers: number }> = [];
  const wanted: FileFixture = {
    path: `batch/${'a'.repeat(32)}`,
    length: 4,
    downloaded: 2,
    select(priority) { this.priority = priority; },
    async blob() { this.downloaded = 4; return new Blob(['book']); },
  };
  const torrent = new FakeTorrent();
  torrent.files = [{ path: 'batch/other', length: 2, downloaded: 0, select() {}, async blob() { return new Blob(); } }, wanted];
  torrent.numPeers = 2;
  const client = {
    options: {} as Record<string, unknown>,
    add(_id: string, options: Record<string, unknown>, callback?: (value: FakeTorrent) => void) {
      this.options = options;
      queueMicrotask(() => callback?.(torrent));
      return torrent;
    },
  };
  const result = await downloadPublicTorrentFile(asClient(client), new Uint8Array([1]) as unknown as string, {
    fileName: 'a'.repeat(32),
    onProgress: progress => events.push(progress),
  });
  assert.equal(client.options.deselect, true);
  assert.equal(wanted.priority, 10);
  assert.equal(await result.blob.text(), 'book');
  assert.deepEqual(events.map(event => [event.downloaded, event.total, event.peers]), [[2, 4, 2], [4, 4, 2]]);
});

test('browser selective download rejects missing and oversized repository files', async () => {
  const clientFor = (file: FileFixture | null) => ({
    add(_id: string, _options: Record<string, unknown>, callback?: (value: FakeTorrent) => void) {
      const torrent = new FakeTorrent();
      torrent.files = file ? [file] : [];
      queueMicrotask(() => callback?.(torrent));
      return torrent;
    },
  });
  await assert.rejects(
    downloadPublicTorrentFile(asClient(clientFor(null)), 'magnet:?xt=urn:btih:abc', { fileName: 'missing' }),
    /absent from the repository torrent/,
  );
  await assert.rejects(
    downloadPublicTorrentFile(asClient(clientFor({ name: 'large', length: 5, downloaded: 0, select() {}, async blob() { return new Blob(); } })), 'magnet:?xt=urn:btih:abc', { fileName: 'large', maxBytes: 4 }),
    /exceeds the maximum size/,
  );
  assert.throws(() => downloadPublicTorrentFile(asClient(clientFor(null)), 'id', { fileName: '../bad' }), /safe torrent file name/);
});

test('browser selective download reports a synchronous client add failure', async () => {
  await assert.rejects(
    downloadPublicTorrentFile(asClient({ add() { throw new Error('client add failed'); } }), 'id', { fileName: 'book' }),
    /client add failed/,
  );
});

test('browser private adapter turns encrypted offer/answer signals into a WebTorrent peer', () => {
  const signals: string[] = [];
  const peer = createPrivatePeer(FakePeer as unknown as Parameters<typeof createPrivatePeer>[0], {
    initiator: false,
    ice: [JSON.stringify({ type: 'offer', sdp: 'v=0' })],
    onSignal: signal => signals.push(signal),
  });
  const testPeer = peer as unknown as FakePeer;
  assert.equal(testPeer.options.initiator, false);
  assert.equal(testPeer.options.trickle, false);
  assert.deepEqual(testPeer.signals, [{ type: 'offer', sdp: 'v=0' }]);
  testPeer.emit('signal', { type: 'answer', sdp: 'v=1' });
  assert.deepEqual(signals, [JSON.stringify({ type: 'answer', sdp: 'v=1' })]);
  assert.throws(() => createPrivatePeer(FakePeer as unknown as Parameters<typeof createPrivatePeer>[0], { ice: ['not-json'] }), /JSON/);
});

test('browser adapter rejects malformed metadata', () => {
  assert.throws(() => addPublicTorrent(null as unknown as TestClient, ''), /client/);
  assert.throws(() => seedPublicTorrent(asClient({ seed() {} }), new Blob(), { sha256: 'bad' }), /sha256/);
});

test('browser transfer adapter validates signals and reports public lifecycle events', async () => {
  assert.equal(serializePrivatePeerSignal({ candidate: 'candidate:1', sdpMid: null, sdpMLineIndex: 0, usernameFragment: 'u' }), '{"candidate":"candidate:1","sdpMid":null,"sdpMLineIndex":0,"usernameFragment":"u"}');
  for (const value of [null, [], '{}', '{bad', { type: 'invalid' }, { sdp: 'v=0' }, { candidate: 2 }, { type: 'offer', sdpMLineIndex: -1 }]) {
    assert.throws(() => serializePrivatePeerSignal(value), /private peer signal/);
  }
  assert.throws(() => createPrivatePeer(null as unknown as Parameters<typeof createPrivatePeer>[0]), /factory/);
  function IncompatiblePeer(): object { return {}; }
  assert.throws(() => createPrivatePeer(IncompatiblePeer as unknown as Parameters<typeof createPrivatePeer>[0]), /compatible/);
  assert.throws(() => createPrivatePeer(FakePeer as unknown as Parameters<typeof createPrivatePeer>[0], { ice: Array(33).fill({ type: 'offer' }) }), /at most 32/);

  const torrent = new FakeTorrent();
  torrent.downloaded = 4;
  torrent.uploaded = 2;
  torrent.numPeers = 3;
  const events: Array<[string, unknown]> = [];
  const returned = addPublicTorrent(asClient({ add: () => torrent }), ' id ', {
    trackers: ['wss://one.example', 'invalid', 'wss://one.example'],
    onProgress: value => events.push(['progress', value]),
    onDone: value => events.push(['done', value]),
    onError: error => events.push(['error', error instanceof Error ? error.message : String(error)]),
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

  const uploads: Array<{ privacy: string }> = [];
  const seedClient = {
    upload: (() => {}) as Listener,
    on(name: string, callback: Listener) { assert.equal(name, 'upload'); this.upload = callback; },
    seed(_file: Blob, _options: Record<string, unknown>, callback: (torrent: FakeTorrent) => void) { callback(new FakeTorrent()); },
  };
  await seedPublicTorrent(asClient(seedClient), new Blob(['x']), { sha256: 'a'.repeat(64), trackers: ['wss://one.example'], onProgress: event => uploads.push(event) });
  seedClient.upload();
  const upload = uploads[0];
  assert.ok(upload);
  assert.equal(upload.privacy, 'public');
});

test('browser adapter handles seed and delayed private metadata failures', async () => {
  await assert.rejects(
    () => seedPublicTorrent(asClient({ seed() { throw new Error('seed failed'); } }), new Blob(['x']), { sha256: 'a'.repeat(64) }),
    /seed failed/,
  );
  const listeners = new Map<string, Listener>();
  const delayed = {
    infoHash: '',
    on(name: string, callback: Listener) { listeners.set(`on:${name}`, callback); },
    once(name: string, callback: Listener) { listeners.set(name, callback); },
    addPeer() { return true; },
  };
  const errors: string[] = [];
  addPrivateTorrent(asClient({ add: () => delayed }), 'private-id', { peer: asPeer(new FakePeer({})), onError: error => errors.push(error instanceof Error ? error.message : String(error)) });
  listeners.get('error')?.(new Error('metadata failed'));
  assert.deepEqual(errors, ['metadata failed']);
  assert.throws(
    () => addPrivateTorrent(asClient({ add: () => ({ infoHash: '' }) }), 'private-id', { peer: asPeer(new FakePeer({})) }),
    /metadata-ready event/,
  );
});
