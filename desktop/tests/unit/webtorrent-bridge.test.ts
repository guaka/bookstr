'use strict';

const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { EventEmitter }: typeof import('node:events') = require('node:events');
const test: typeof import('node:test') = require('node:test');
type ClientOptions = import('../../src/torrent-types').ClientOptions;
type TorrentClient = import('../../src/torrent-types').TorrentClient;
type Torrent = import('../../src/torrent-types').Torrent;
type SeedOptions = import('../../src/torrent-types').SeedOptions;
type BridgeOptions = NonNullable<ConstructorParameters<typeof WebTorrentBridge>[0]>;
type BridgeHarness = Omit<InstanceType<typeof WebTorrentBridge>, 'client' | 'remove' | 'addPublic'> & {
  client: TorrentClient;
  remove(torrent: Torrent): Promise<void>;
  addPublic(id: string | Buffer, options?: Record<string, unknown>): Promise<Torrent>;
};
function fakeTorrent(properties: Partial<Torrent> & { select?: (priority: number) => void }): Torrent & import('node:events').EventEmitter & { select?: (priority: number) => void } {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { files: [], on: emitter.on.bind(emitter), once: emitter.once.bind(emitter), ...properties }) as unknown as Torrent & import('node:events').EventEmitter & { select?: (priority: number) => void };
}
class FakeClient extends EventEmitter implements TorrentClient {
  torrents: Torrent[] = [];
  seed(_input: string, options: SeedOptions, callback?: (torrent?: Torrent) => void): Torrent {
    const torrent = fakeTorrent({ infoHash: 'a'.repeat(40), name: options.name, magnetURI: `magnet:?xt=urn:btih:${'a'.repeat(40)}`, torrentFile: Buffer.from('metadata'), progress: 1, ready: true });
    this.torrents.push(torrent);
    callback?.(torrent);
    return torrent;
  }
  add(id: string | Buffer, options: Record<string, unknown> = {}): Torrent {
    const torrent = fakeTorrent({ infoHash: typeof id === 'string' ? id : 'b'.repeat(40), private: Boolean(options.private) });
    this.torrents.push(torrent);
    return torrent;
  }
  async remove(torrent: Torrent): Promise<void> {
    const index = this.torrents.indexOf(torrent);
    if (index >= 0) this.torrents.splice(index, 1);
  }
  get(_id: string | Buffer): Promise<Torrent | null> { return Promise.resolve(null); }
  destroy(callback?: () => void): void { callback?.(); }
  throttleDownload(_limit: number): void {}
  throttleUpload(_limit: number): void {}
}
function fakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return Object.assign(new FakeClient(), overrides);
}
function createBridge(options?: Omit<BridgeOptions, 'clientFactory'> & { clientFactory?: (options: ClientOptions) => Promise<unknown> }): BridgeHarness {
  return new WebTorrentBridge(options as BridgeOptions) as unknown as BridgeHarness;
}
interface FakeLog {
  adds: Array<{ id: unknown; options: Record<string, unknown> }>;
  clientsCreated: number;
  clientOptions: ClientOptions;
  downloadThrottle: number;
  uploadThrottle: number;
  seed: { input: string; options: import('../../src/torrent-types').SeedOptions };
  seeds: number;
  removed: Array<{ torrent: Torrent; options?: Record<string, unknown> }>;
  destroyed: boolean;
  peer: string;
  priority: number;
}
function fakeLog(): FakeLog {
  return {
    adds: [], clientsCreated: 0, clientOptions: { downloadLimit: 0, uploadLimit: 0, maxConns: 0 },
    downloadThrottle: 0, uploadThrottle: 0, seed: { input: '', options: { name: '', announceList: [], pieceLength: 0, info: { source: '' } } },
    seeds: 0, removed: [], destroyed: false, peer: '', priority: 0,
  };
}
const {
  WebTorrentBridge,
  PUBLIC_TRACKERS,
  PUBLIC_ICE_SERVERS,
  DEFAULT_DOWNLOAD_LIMIT,
  PUBLIC_UPLOAD_LIMIT,
  safePeerAddress,
} = require('../../webtorrent-bridge') as typeof import('../../src/webtorrent-bridge');

function fakeClientFactory(log: FakeLog): (options: ClientOptions) => Promise<TorrentClient> {
  return async (_options: ClientOptions) => {
    log.clientsCreated = (log.clientsCreated || 0) + 1;
    log.clientOptions = _options;
    return fakeClient({
      throttleDownload(rate: number) { log.downloadThrottle = rate; },
      throttleUpload(rate: number) { log.uploadThrottle = rate; },
      seed(this: FakeClient, input: string, options: SeedOptions, callback?: (torrent?: Torrent) => void) {
        log.seed = { input, options };
        const torrent = fakeTorrent({ infoHash: 'a'.repeat(40), name: options.name, magnetURI: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), torrentFile: Buffer.from('metadata'), progress: 1, ready: true });
        this.torrents.push(torrent);
        callback?.(torrent);
        return torrent;
      },
      add(this: FakeClient, id: string | Buffer, options: Record<string, unknown> = {}) {
        log.adds.push({ id, options });
        const torrent = fakeTorrent({ infoHash: typeof id === 'string' ? id : 'b'.repeat(40), private: Boolean(options.private), addPeer(peer: string) { log.peer = peer; } });
        this.torrents.push(torrent);
        return torrent;
      },
      async remove(this: FakeClient, torrent: Torrent) {
        log.removed.push({ torrent });
        const index = this.torrents.indexOf(torrent);
        if (index >= 0) this.torrents.splice(index, 1);
      },
      destroy(callback?: () => void) { log.destroyed = true; callback?.(); },
    });
  };
}

test('public seed enforces rights, stable naming, trackers, and upload cap', async () => {
  const log = fakeLog();
  const bridge = createBridge({ clientFactory: fakeClientFactory(log), dataDir: '/tmp/bookstr' });
  const digest = 'c'.repeat(64);
  const result = await bridge.seedPublic('/tmp/example.epub', { sha256: digest, size: 42, bookId: 'book-1' });
  assert.equal(log.clientOptions.uploadLimit, PUBLIC_UPLOAD_LIMIT);
  assert.equal(log.clientOptions.downloadLimit, DEFAULT_DOWNLOAD_LIMIT);
  assert.equal(log.uploadThrottle, PUBLIC_UPLOAD_LIMIT);
  assert.equal(log.downloadThrottle, DEFAULT_DOWNLOAD_LIMIT);
  assert.equal(log.seed.options.name, `${digest}.epub`);
  assert.deepEqual(log.seed.options.announceList, PUBLIC_TRACKERS.map(url => [url]));
  assert.equal(result.descriptor.info.length, 42);
  assert.equal(result.summary!.magnetURI.startsWith('magnet:?xt=urn:btih:'), true);
  assert.equal(result.summary!.torrentFile, Buffer.from('metadata').toString('base64'));
  assert.equal(result.summary!.bookId, 'book-1');
  assert.equal(result.summary!.seeding, true);
  await bridge.stop();
  assert.equal(log.destroyed, true);
});

test('Electron enables browser-compatible torrent peers with cross-platform WebRTC and STUN', async () => {
  const log = fakeLog();
  const wrtc = { RTCPeerConnection() {} };
  const bridge = createBridge({
    clientFactory: fakeClientFactory(log),
    webRTCFactory: async () => wrtc,
  });
  await bridge.start();
  assert.equal(bridge.webRTCEnabled, true);
  assert.equal(log.clientOptions.tracker!.wrtc, wrtc);
  assert.deepEqual(log.clientOptions.tracker!.rtcConfig.iceServers, PUBLIC_ICE_SERVERS);
});

test('the packaged WebRTC runtime can create torrent data channels', () => {
  const wrtc: typeof import('@roamhq/wrtc') = require('@roamhq/wrtc');
  const peer = new wrtc.RTCPeerConnection({ iceServers: [...PUBLIC_ICE_SERVERS] });
  const channel = peer.createDataChannel('bookstr-torrent');
  assert.equal(channel.label, 'bookstr-torrent');
  peer.close();
});

test('Electron retains ordinary torrent support when WebRTC is unavailable', async () => {
  const log = fakeLog();
  const bridge = createBridge({
    clientFactory: fakeClientFactory(log),
    webRTCFactory: async () => null,
  });
  await bridge.start();
  assert.equal(bridge.webRTCEnabled, false);
  assert.equal(log.clientOptions.tracker, undefined);
});

test('torrent client bounds peer managers and retires a completed swarm before rejecting new work', async () => {
  const log = fakeLog();
  const bridge = createBridge({ clientFactory: fakeClientFactory(log) });
  for (let index = 0; index < 100; index += 1) await bridge.addPublic(`torrent-${index}`);
  assert.equal(log.clientOptions.maxConns, 16);
  assert.equal(log.adds.length, 100);
  await assert.rejects(() => bridge.addPublic('torrent-over-cap'), /maximum active torrent count reached \(100\)/);
  assert.equal(log.adds.length, 100);
  const oldest = bridge.client.torrents[0]!;
  oldest.done = true;
  await bridge.addPublic('torrent-after-seed-eviction');
  assert.equal(log.removed[0]!.torrent, oldest);
  assert.equal(log.removed[0]!.options, undefined);
  assert.equal(bridge.client.torrents.length, 100);
  assert.equal(log.adds.length, 101);
  await bridge.stop();
});

test('simultaneous torrent requests share one bounded WebTorrent client', async () => {
  const log = fakeLog();
  const bridge = createBridge({ clientFactory: fakeClientFactory(log) });
  const results = await Promise.allSettled(Array.from({ length: 102 }, (_, index) => bridge.addPublic(`parallel-${index}`)));
  assert.equal(log.clientsCreated, 1);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 100);
  assert.equal(bridge.client.torrents.length, 100);
  await bridge.stop();
});

test('concurrent reservation during slow eviction cannot exceed the active torrent cap', async () => {
  const log = fakeLog();
  const bridge = createBridge({
    clientFactory: async () => {
      const client = fakeClient({
        add(this: FakeClient, id: string | Buffer) {
          log.adds.push({ id, options: {} });
          const torrent = fakeTorrent({ infoHash: String(id), progress: 0, done: false });
          this.torrents.push(torrent);
          return torrent;
        },
        async remove(this: FakeClient, torrent: Torrent) {
          // Yield so unsynchronized callers could both pass the capacity check.
          await new Promise(resolve => setTimeout(resolve, 25));
          const index = this.torrents.indexOf(torrent);
          if (index >= 0) this.torrents.splice(index, 1);
          log.removed.push({ torrent });
        },
      });
      return client;
    },
  });
  for (let index = 0; index < 99; index += 1) await bridge.addPublic(`active-${index}`);
  await bridge.addPublic('completed-slot');
  bridge.client.torrents[99]!.done = true;

  const results = await Promise.allSettled([
    bridge.addPublic('concurrent-a'),
    bridge.addPublic('concurrent-b'),
  ]);
  assert.equal(bridge.client.torrents.length, 100);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected);
  assert.match(rejected.reason.message, /maximum active torrent count reached \(100\)/);
  assert.equal(log.removed.length, 1);
  await bridge.stop();
});

test('concurrent seed and add reservations stay within the active torrent cap', async () => {
  const log = fakeLog();
  const bridge = createBridge({
    clientFactory: async () => {
      const client = fakeClient({
        seed(this: FakeClient, _input: string, options: SeedOptions, callback?: (torrent?: Torrent) => void) {
          log.seeds += 1;
          const torrent = fakeTorrent({
            infoHash: `seed-${log.seeds}`,
            name: options.name,
            magnetURI: `magnet:?xt=urn:btih:${'a'.repeat(40)}`,
            torrentFile: Buffer.from('metadata'),
            progress: 1,
            ready: true,
          });
          this.torrents.push(torrent);
          callback?.(torrent);
          return torrent;
        },
        add(this: FakeClient, id: string | Buffer) {
          log.adds.push({ id, options: {} });
          const torrent = fakeTorrent({ infoHash: String(id), progress: 0, done: false });
          this.torrents.push(torrent);
          return torrent;
        },
        async remove(this: FakeClient, torrent: Torrent) {
          await new Promise(resolve => setTimeout(resolve, 25));
          const index = this.torrents.indexOf(torrent);
          if (index >= 0) this.torrents.splice(index, 1);
        },
      });
      return client;
    },
  });
  for (let index = 0; index < 99; index += 1) await bridge.addPublic(`held-${index}`);
  await bridge.addPublic('completed-for-seed');
  bridge.client.torrents[99]!.done = true;

  const results = await Promise.allSettled([
    bridge.seedPublic('/tmp/concurrent-seed.epub', { sha256: 'e'.repeat(64) }),
    bridge.addPublic('concurrent-add'),
  ]);
  assert.equal(bridge.client.torrents.length, 100);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  await bridge.stop();
});

test('private add disables all public discovery', async () => {
  const log = fakeLog();
  const bridge = createBridge({ clientFactory: fakeClientFactory(log) });
  await assert.rejects(() => bridge.addPrivate('deadbeef', { path: '/tmp/books' }), /peer handoff/);
  const torrent = await bridge.addPrivate('deadbeef', { path: '/tmp/books', peer: '192.0.2.10:6881' });
  assert.deepEqual(log.adds[0]!.options.announce, []);
  assert.equal(log.adds[0]!.options.private, true);
  assert.equal(log.adds[0]!.options.dht, false);
  assert.equal(log.adds[0]!.options.tracker, false);
  assert.equal(log.adds[0]!.options.utPex, false);
  assert.equal(log.adds[0]!.options.lsd, false);
  assert.equal(log.peer, '192.0.2.10:6881');
  assert.equal(torrent.private, true);
  await assert.rejects(() => bridge.addPrivate('deadbeef', { peer: 'peer.example:6881' }), /IP address/);
});

test('public seeding requires explicit rights permission', async () => {
  const bridge = createBridge({ clientFactory: fakeClientFactory(fakeLog()) });
  await assert.rejects(() => bridge.seedPublic('/tmp/book.epub', { sha256: 'd'.repeat(64), publicSeedAllowed: false }), /rights policy/);
});

test('validates transfer inputs and preserves an explicit unlimited upload rate', async () => {
  assert.equal(safePeerAddress('[2001:db8::1]:6881'), '[2001:db8::1]:6881');
  for (const peer of ['', '192.0.2.1:0', '192.0.2.1:65536', 'example.test:6881', '999.0.0.1:6881']) {
    assert.throws(() => safePeerAddress(peer), /IP address and port/);
  }
  const log = fakeLog();
  const bridge = createBridge({
    clientFactory: fakeClientFactory(log),
    trackers: ['https://unsafe.example', 'wss://tracker.example', 'wss://tracker.example'],
    uploadLimit: -1,
    downloadLimit: -1,
  });
  await bridge.addPublic('public-id');
  assert.deepEqual(log.adds[0]!.options.announce, ['wss://tracker.example']);
  assert.equal(log.clientOptions.uploadLimit, -1);
  assert.equal(log.clientOptions.downloadLimit, -1);
  await assert.rejects(() => bridge.seedPublic('', { sha256: 'f'.repeat(64) }), /valid local path/);
  await assert.rejects(() => bridge.seedPublic('/tmp/book.epub', { sha256: 'not-a-digest' }), /sha256/);
  await assert.rejects(() => bridge.seedPublic('/tmp/book.epub', { sha256: 'f'.repeat(64), extension: 'not/an-extension' }), /extension/);
});

test('live transfer limits apply immediately and summaries expose rates', async () => {
  const log = fakeLog();
  const bridge = createBridge({ clientFactory: fakeClientFactory(log) });
  const client = await bridge.start();
  client.torrents.push(fakeTorrent({
    infoHash: 'e'.repeat(40),
    progress: 0.5,
    downloadSpeed: 1_250_000,
    uploadSpeed: 240_000,
    wires: [],
  }));
  assert.deepEqual(await bridge.setLimits({ downloadLimit: 5_000_000, uploadLimit: 500_000 }), {
    downloadLimit: 5_000_000,
    uploadLimit: 500_000,
  });
  assert.equal(log.downloadThrottle, 5_000_000);
  assert.equal(log.uploadThrottle, 500_000);
  assert.equal(bridge.active()[0]!.downloadSpeed, 1_250_000);
  assert.equal(bridge.active()[0]!.uploadSpeed, 240_000);
});

test('public add reuses a live repository torrent and replaces a stale destroyed one', async () => {
  let existing: Torrent | null = fakeTorrent({ infoHash: 'a'.repeat(40), destroyed: false });
  const live = existing;
  const fresh = fakeTorrent({ infoHash: 'a'.repeat(40), destroyed: false });
  let addCount = 0;
  const removed: Array<{ infoHash: string; destroyed: boolean }> = [];
  const client = fakeClient({
    torrents: [existing],
    async get() { return existing; },
    add() { addCount += 1; return fresh; },
    async remove(torrent) { removed.push({ infoHash: String(torrent.infoHash), destroyed: Boolean(torrent.destroyed) }); existing = null; },
  });
  const bridge = createBridge({ clientFactory: async () => client });
  assert.equal(await bridge.addPublic(Buffer.from('torrent metadata')), live);
  assert.equal(addCount, 0);

  existing!.destroyed = true;
  assert.equal(await bridge.addPublic(Buffer.from('torrent metadata')), fresh);
  assert.deepEqual(removed, [{ infoHash: 'a'.repeat(40), destroyed: true }]);
  assert.equal(addCount, 1);
});

test('private handoff waits for asynchronous metadata and bridge cleanup is safe', async () => {
  const events: Record<string, (() => void) | string> = {};
  const client = fakeClient({
    torrents: [fakeTorrent({ infohash: 'c'.repeat(40), numPeers: 2, downloaded: -84, uploaded: -3, progress: -0.84, private: true })],
    add() {
      return fakeTorrent({
        once(name, handler) { events[name] = handler; },
        addPeer(peer) { events.peer = peer; },
      });
    },
    destroy() { throw new Error('already stopped'); },
  });
  const bridge = createBridge({ clientFactory: async () => client, dataDir: '/tmp/books' });
  const pending = bridge.addPrivate('private-id', { peer: '192.0.2.12:6881' });
  await new Promise(resolve => setImmediate(resolve));
  const infoHashListener = events.infoHash;
  assert.equal(typeof infoHashListener, 'function');
  if (typeof infoHashListener !== 'function') throw new Error('metadata listener was not registered');
  infoHashListener();
  await pending;
  assert.equal(events.peer, '192.0.2.12:6881');
  assert.deepEqual(bridge.active(), [{
    infoHash: 'c'.repeat(40), bookId: '', name: '', magnetURI: '', torrentFile: '', privacy: 'private', progress: 0, downloaded: 0, uploaded: 0, peers: 2, downloadSpeed: 0, uploadSpeed: 0, seeding: false,
  }]);
  await bridge.stop();
  assert.deepEqual(bridge.active(), []);
  await bridge.stop();

  const noPeerBridge = createBridge({ clientFactory: async () => fakeClient({ add: () => fakeTorrent({ infoHash: 'a'.repeat(40) }) }) });
  await assert.rejects(() => noPeerBridge.addPrivate('private-id', { peer: '192.0.2.12:6881' }), /does not support peer connections/);
});

test('repository torrent downloads only the selected MD5 file', async () => {
  const log = fakeLog();
  const wanted = fakeTorrent({ path: `r_1000/${'a'.repeat(32)}`, length: 42, downloaded: 0, done: false });
  wanted.select = (priority: number) => {
    log.priority = priority;
    setImmediate(() => {
      wanted.downloaded = wanted.length;
      wanted.done = true;
      wanted.emit('done');
    });
  };
  const torrent = fakeTorrent({ path: '/tmp/bookstr-select', files: [{ path: `r_1000/${'b'.repeat(32)}`, length: 10 }, wanted] });
  const bridge = createBridge({
    clientFactory: async () => fakeClient({
      add(id, options) {
        log.adds.push({ id, options: options ?? {} });
        return torrent;
      },
    }),
  });
  const progress: Array<{ bytes: number; totalBytes: number; peers: number }> = [];
  const result = await bridge.downloadSelected(Buffer.from('torrent metadata'), {
    path: '/tmp/bookstr-select',
    fileName: 'a'.repeat(32),
    bookId: 'a'.repeat(32),
    onProgress: value => progress.push(value),
  });
  assert.equal(log.adds[0]!.options.deselect, true);
  assert.equal(log.priority, 10);
  assert.equal(result.file, wanted);
  assert.deepEqual([...result.torrent.bookstrBookIds!], ['a'.repeat(32)]);
  assert.equal(result.filePath, `/tmp/bookstr-select/r_1000/${'a'.repeat(32)}`);
  assert.deepEqual(progress.at(-1), { bytes: 42, totalBytes: 42, peers: 0 });
});

test('selected torrent download rejects an abort that arrives while addPublic is pending', async () => {
  const bridge = createBridge({ clientFactory: async () => ({ torrents: [] }) });
  const torrent = fakeTorrent({});
  let finishAdd: () => void = () => {};
  bridge.addPublic = () => new Promise(resolve => { finishAdd = () => resolve(torrent); });
  let removed = 0;
  bridge.remove = async received => { assert.equal(received, torrent); removed += 1; };
  const controller = new AbortController();
  const download = bridge.downloadSelected('metadata', { fileName: 'a'.repeat(32), signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  finishAdd();
  await assert.rejects(download, /torrent download aborted/);
  assert.equal(removed, 1);
  assert.equal(torrent.listenerCount('metadata'), 0);
});

test('selected torrent metadata wait catches abort during listener registration', async () => {
  const bridge = createBridge({ clientFactory: async () => ({ torrents: [] }) });
  const controller = new AbortController();
  const torrent = fakeTorrent({});
  const registerOnce = torrent.once.bind(torrent);
  torrent.once = (event: string, listener: (error?: unknown) => void) => {
    registerOnce(event, listener);
    if (event === 'metadata') controller.abort();
    return torrent;
  };
  bridge.addPublic = async () => torrent;
  let removed = 0;
  bridge.remove = async received => { assert.equal(received, torrent); removed += 1; };

  await assert.rejects(bridge.downloadSelected('metadata', {
    fileName: 'a'.repeat(32), signal: controller.signal,
  }), /torrent download aborted/);
  assert.equal(removed, 1);
});

test('public download waits for completion', async () => {
  const log = fakeLog();
  const bridge = createBridge({ clientFactory: async _options => fakeClient({
    throttleUpload() {},
    add(id, addOptions) {
      log.adds.push({ id, options: addOptions ?? {} });
      const torrent = fakeTorrent({ infoHash: 'e'.repeat(40), files: [{ path: '/tmp/bookstr/book.epub' }] });
      (this.torrents ??= []).push(torrent);
      setImmediate(() => torrent.emit('done'));
      return torrent;
    },
  }) });
  const torrent = await bridge.downloadPublic('magnet:?xt=urn:btih:test', { path: '/tmp/bookstr' });
  assert.equal(torrent.infoHash, 'e'.repeat(40));
  assert.equal(log.adds[0]!.options.path, '/tmp/bookstr');
});

test('automatic seeding can stop completed torrents without interrupting downloads', async () => {
  const bridge = createBridge();
  const downloading = fakeTorrent({ progress: 0.4 });
  const seeded = fakeTorrent({ progress: 1, done: true });
  const markedSeed = fakeTorrent({ progress: 0.8, bookstrSeedingBookIds: new Set(['book-1']) });
  const removed: Torrent[] = [];
  bridge.client = fakeClient({ torrents: [downloading, seeded, markedSeed] });
  bridge.remove = async torrent => { removed.push(torrent); };
  assert.deepEqual(await bridge.stopSeeding(), { stopped: 2 });
  assert.deepEqual(removed, [seeded, markedSeed]);
});


test('comics repository selects an MD5 with a format suffix without matching a different book', async () => {
  const md5 = 'a'.repeat(32);
  const wanted = fakeTorrent({ path: `2521000/${md5}.CBR`, length: 42, downloaded: 42, done: true, select() {} });
  const torrent = fakeTorrent({ path: '/tmp/bookstr-comics', files: [
    { path: `2521000/${md5}.cbr.exe` },
    { path: `2521000/${'b'.repeat(32)}.cbr` },
    wanted,
  ] });
  const bridge = createBridge({ clientFactory: async () => fakeClient({ add: () => torrent }) });
  const result = await bridge.downloadSelected('comics-metadata', { fileName: md5 });
  assert.equal(result.file, wanted);
  assert.equal(result.filePath, `/tmp/bookstr-comics/2521000/${md5}.CBR`);
});
