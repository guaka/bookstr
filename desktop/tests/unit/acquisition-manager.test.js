'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { AcquisitionManager, createProgressThrottle, extensionFor, libgenTorrentMetadataURL, libgenCollection } = require('../../acquisition-manager');
const { LibraryImporter } = require('../../library-import');
const { LibraryStore } = require('../../library-store');

const BOOK_SHA256 = crypto.createHash('sha256').update('book bytes').digest('hex');

test('acquisition format validation includes CBZ and CBR', () => {
  assert.equal(extensionFor('cbz'), 'cbz');
  assert.equal(extensionFor('cbr'), 'cbr');
});

test('1000 torrent progress samples coalesce to at most 11 persistence/IPC updates', () => {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const reported = [];
  const throttle = createProgressThrottle(value => reported.push(value), 100, {
    now: () => now,
    schedule: (callback, delay) => {
      const id = ++nextTimerId;
      timers.set(id, { callback, dueAt: now + delay });
      return id;
    },
    unschedule: id => timers.delete(id),
  });
  for (let sample = 1; sample <= 1000; sample += 1) {
    now = sample - 1;
    throttle.report({ bytes: sample });
    for (const [id, timer] of timers) {
      if (timer.dueAt <= now) {
        timers.delete(id);
        timer.callback();
        break;
      }
    }
  }
  throttle.flush();
  assert.equal(reported.length, 11);
  assert.deepEqual(reported.at(-1), { bytes: 1000 });
});

test('closing acquisition manager cancels trailing progress and drains torrent jobs', async () => {
  const root = await fsp.mkdtemp(path.join(__dirname, '.bookstr-acquisition-shutdown-'));
  let storeClosed = false;
  const writes = [];
  const store = {
    upsertBook(book) { return book; },
    setDownload(download) {
      if (storeClosed) throw new Error('database is not open');
      writes.push(download);
    },
  };
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  let signalDownloadStarted;
  const downloadStarted = new Promise(resolve => { signalDownloadStarted = resolve; });
  const manager = new AcquisitionManager({
    store,
    importer,
    stagingRoot: path.join(root, 'staging'),
    fetchImpl: async () => ({ ok: true, headers: new Headers({ 'content-length': '14' }), arrayBuffer: async () => Buffer.from('d4:test4:datae') }),
    torrentBridge: {
      downloadSelected(_metadata, { signal, onProgress }) {
        onProgress({ bytes: 1, totalBytes: 10 });
        onProgress({ bytes: 2, totalBytes: 10 });
        signalDownloadStarted();
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new Error('acquisition aborted'));
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
      },
    },
  });
  const acquisition = manager.acquireLibgen({ md5: 'a'.repeat(32), id: 123, extension: 'epub' });
  await downloadStarted;
  await manager.close();
  await assert.rejects(acquisition, /acquisition manager is closing|acquisition aborted/);
  storeClosed = true;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.deepEqual(writes.map(write => write.status), ['finding-peers', 'downloading']);
  await fsp.rm(root, { recursive: true, force: true });
});

async function withManager(fn) {
  const root = await fsp.mkdtemp(path.join(__dirname, '.bookstr-acquisition-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: path.join(root, 'library') });
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  const manager = new AcquisitionManager({
    store,
    importer,
    stagingRoot: path.join(root, 'staging'),
    trustedOrigins: {
      gutenberg: ['https://example.test', 'https://slow.example', 'https://fast.example'],
      propagate: ['https://example.test'],
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '10' }),
      body: Readable.toWeb(Readable.from(Buffer.from('book bytes'))),
    }),
  });
  try { return await fn({ manager, store, root }); } finally { store.close(); await fsp.rm(root, { recursive: true, force: true }); }
}

test('acquisition downloads, verifies, imports, and registers a book', () => withManager(async ({ manager, store }) => {
  const result = await manager.acquire({
    provider: 'gutenberg',
    recordId: 'g-1',
    title: 'Book',
    languages: ['en'],
    rights_status: 'public_domain',
    acquisitions: [{ format: 'epub', url: 'https://example.test/book.epub', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  });
  assert.equal(result.size, 10);
  assert.equal(store.getBook('gutenberg:g-1').sha256, result.sha256);
  assert.equal(store.downloads()[0].status, 'ready');
}));

test('desktop queue can acquire an open trusted HTTPS file without a catalog hash', () => withManager(async ({ manager, store }) => {
  const record = {
    provider: 'gutenberg', recordId: 'g-open', title: 'Open Book',
    acquisitions: [{ format: 'epub', url: 'https://example.test/open.epub', availability: 'open' }],
  };
  await assert.rejects(() => manager.acquire(record), /verified SHA-256/);
  const result = await manager.acquire(record, { allowUnverifiedOpen: true });
  assert.equal(result.sha256, BOOK_SHA256);
  assert.equal(store.downloads()[0].status, 'ready');
  await assert.rejects(() => manager.acquire({ ...record, recordId: 'bad-origin', acquisitions: [
    { format: 'epub', url: 'https://outside.test/book.epub', availability: 'open' },
  ] }, { allowUnverifiedOpen: true }), /all eligible acquisitions failed/);
}));

test('LibGen acquisition resolves the repository batch and imports only the selected book', () => withManager(async ({ manager, store, root }) => {
  const md5 = 'a'.repeat(32);
  const body = Buffer.from('%PDF-book bytes');
  let metadataRequest = '';
  manager.fetch = async url => {
    metadataRequest = url;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '14' }),
      arrayBuffer: async () => Buffer.from('d4:test4:datae'),
    };
  };
  let requestedFile = '';
  let requestedBookId = '';
  let destroyed = 0;
  const seedTorrent = { destroy() { destroyed += 1; } };
  manager.torrentBridge = {
    async downloadSelected(_metadata, options) {
      requestedFile = options.fileName;
      requestedBookId = options.bookId;
      const filePath = path.join(options.path, 'r_2412000', md5);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, body);
      options.onProgress({ bytes: body.length, totalBytes: body.length });
      return { filePath, torrent: seedTorrent };
    },
  };
  const result = await manager.acquireLibgen({
    md5,
    id: 2412930,
    title: 'Torrent PDF',
    extension: 'pdf',
    filesize_bytes: body.length,
  });
  assert.equal(metadataRequest, libgenTorrentMetadataURL(2412930));
  assert.equal(requestedFile, md5);
  assert.equal(requestedBookId, md5);
  assert.equal(result.source, 'torrent');
  assert.equal(store.getBook(md5).sha256, result.sha256);
  assert.equal(store.downloads()[0].status, 'ready');
  assert.equal(destroyed, 0);
  assert.equal(seedTorrent.bookstrBookId, md5);
  assert.deepEqual([...seedTorrent.bookstrSeedingBookIds], [md5]);
  assert.deepEqual(await fsp.readdir(path.join(root, 'staging')), ['libgen-seeds']);
}));

test('a LibGen download remains one background job when another view requests the same book', () => withManager(async ({ manager }) => {
  const md5 = 'b'.repeat(32);
  const body = Buffer.from('persistent torrent bytes');
  manager.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': '14' }),
    arrayBuffer: async () => Buffer.from('d4:test4:datae'),
  });
  let beginDownload;
  const downloadStarted = new Promise(resolve => { beginDownload = resolve; });
  let finishDownload;
  const mayFinish = new Promise(resolve => { finishDownload = resolve; });
  let downloadCalls = 0;
  manager.torrentBridge = {
    async downloadSelected(_metadata, options) {
      downloadCalls += 1;
      beginDownload();
      await mayFinish;
      const filePath = path.join(options.path, md5);
      await fsp.writeFile(filePath, body);
      options.onProgress({ bytes: body.length, totalBytes: body.length, peers: 1 });
      return { filePath, torrent: { destroy() {} } };
    },
  };
  const book = { md5, id: 2412930, title: 'Persistent Job', extension: 'epub', filesize_bytes: body.length };
  const firstProgress = [];
  const secondProgress = [];
  const first = manager.acquireLibgen(book, { autoSeed: false, onProgress: progress => firstProgress.push(progress) });
  await downloadStarted;
  const second = manager.acquireLibgen(book, { autoSeed: false, onProgress: progress => secondProgress.push(progress) });
  assert.equal(downloadCalls, 1);
  finishDownload();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.sha256, secondResult.sha256);
  assert.equal(firstProgress.at(-1).bytes, body.length);
  assert.equal(secondProgress.at(-1).bytes, body.length);
  assert.equal(manager.libgenAcquisitionJobs.size, 0);
}));

test('opening Electron can resume completed LibGen seeds from persistent torrent data', () => withManager(async ({ manager, store, root }) => {
  const md5 = 'c'.repeat(32);
  const libgenId = 2412930;
  const seedRoot = path.join(root, 'staging', 'libgen-seeds');
  const seedFile = path.join(seedRoot, '2412000', md5);
  await fsp.mkdir(path.dirname(seedFile), { recursive: true });
  await fsp.writeFile(seedFile, 'seed bytes');
  store.upsertBook({ id: md5, md5, title: 'Persistent Seed', extension: 'epub', sourceNativeId: String(libgenId) });
  store.setDownload({ bookId: md5, status: 'ready', source: 'torrent', bytes: 10, totalBytes: 10 });
  manager.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('d4:test4:datae') });
  const torrent = {};
  let options;
  manager.torrentBridge = {
    async downloadSelected(_metadata, input) {
      options = input;
      return { filePath: seedFile, torrent };
    },
  };

  assert.deepEqual(await manager.resumeLibgenSeeds(), { seeded: 1, resumed: 0 });
  assert.equal(options.path, seedRoot);
  assert.equal(options.fileName, md5);
  assert.equal(options.bookId, md5);
  assert.deepEqual([...torrent.bookstrSeedingBookIds], [md5]);
  assert.equal(torrent.bookstrBookId, md5);
}));

test('startup reconstructs missing retained torrent payloads from verified library files', () => withManager(async ({ manager, store, root }) => {
  const md5 = 'e'.repeat(32);
  const libgenId = 4082731;
  const bytes = Buffer.from('verified library payload');
  const relativePath = `books/${crypto.createHash('sha256').update(bytes).digest('hex')}.epub`;
  const libraryFile = path.join(root, 'library', relativePath);
  const seedFile = path.join(root, 'staging', 'libgen-seeds', '4082000', md5);
  await fsp.mkdir(path.dirname(libraryFile), { recursive: true });
  await fsp.writeFile(libraryFile, bytes);
  store.upsertBook({ id: md5, md5, title: 'Rebuilt Seed', extension: 'epub', sourceNativeId: String(libgenId) });
  store.registerLibraryFile({ bookId: md5, relativePath, sizeBytes: bytes.length });
  store.setDownload({ bookId: md5, status: 'ready', source: 'torrent', bytes: bytes.length, totalBytes: bytes.length });
  manager.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('d4:test4:datae') });
  manager.torrentBridge = {
    async downloadSelected() {
      return { filePath: seedFile, torrent: {} };
    },
  };

  assert.deepEqual(await manager.resumeLibgenSeeds(), { seeded: 1, resumed: 0 });
  assert.deepEqual(await fsp.readFile(seedFile), bytes);
  assert.equal((await fsp.stat(seedFile)).ino, (await fsp.stat(libraryFile)).ino);
}));

test('startup resumes interrupted LibGen downloads in the background', () => withManager(async ({ manager, store }) => {
  const md5 = 'f'.repeat(32);
  const libgenId = 4082731;
  const bytes = Buffer.from('resumed torrent payload');
  store.upsertBook({ id: md5, md5, title: 'Interrupted Download', extension: 'epub', sourceNativeId: String(libgenId) });
  store.setDownload({ bookId: md5, status: 'downloading', source: 'torrent', bytes: 4, totalBytes: bytes.length });
  manager.seedResumeIntervalMs = 0;
  manager.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('d4:test4:datae') });
  let started;
  const downloadStarted = new Promise(resolve => { started = resolve; });
  manager.torrentBridge = {
    async downloadSelected(_metadata, options) {
      started(options);
      const filePath = path.join(options.path, '4082000', md5);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, bytes);
      options.onProgress({ bytes: bytes.length, totalBytes: bytes.length });
      return { filePath, torrent: {} };
    },
  };

  assert.deepEqual(await manager.resumeLibgenSeeds(), { seeded: 0, resumed: 1 });
  const options = await downloadStarted;
  assert.equal(options.fileName, md5);
  assert.equal(options.bookId, md5);
  await manager.libgenAcquisitionJobs.get(md5)?.promise;
  assert.equal(store.downloads().find(item => item.bookId === md5).status, 'ready');
}));

test('startup resumes eligible LibGen seeds gradually instead of all at once', () => withManager(async ({ manager, store, root }) => {
  const records = [
    { md5: '1'.repeat(32), libgenId: 2412930 },
    { md5: '2'.repeat(32), libgenId: 2412931 },
  ];
  const seedRoot = path.join(root, 'staging', 'libgen-seeds');
  for (const record of records) {
    const seedFile = path.join(seedRoot, 'r_2412000', record.md5);
    await fsp.mkdir(path.dirname(seedFile), { recursive: true });
    await fsp.writeFile(seedFile, 'seed bytes');
    store.upsertBook({ id: record.md5, md5: record.md5, title: 'Persistent Seed', extension: 'epub', sourceNativeId: String(record.libgenId) });
    store.setDownload({ bookId: record.md5, status: 'ready', source: 'torrent', bytes: 10, totalBytes: 10 });
  }
  manager.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('d4:test4:datae') });
  const waits = [];
  manager.sleep = async milliseconds => { waits.push(milliseconds); };
  manager.torrentBridge = {
    async downloadSelected(_metadata, input) {
      return { filePath: path.join(seedRoot, 'r_2412000', input.fileName), torrent: {} };
    },
  };

  assert.deepEqual(await manager.resumeLibgenSeeds(), { seeded: 2, resumed: 0 });
  assert.deepEqual(waits, [1500]);
}));

test('manager shutdown cancels gradual seed resume before it reads or starts later jobs', () => withManager(async ({ manager, store }) => {
  const records = [
    { md5: '3'.repeat(32), libgenId: 2412930 },
    { md5: '4'.repeat(32), libgenId: 2412931 },
  ];
  for (const record of records) {
    store.upsertBook({ id: record.md5, md5: record.md5, title: 'Interrupted', extension: 'epub', sourceNativeId: String(record.libgenId) });
    store.setDownload({ bookId: record.md5, status: 'queued', source: 'torrent' });
  }
  manager.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('d4:test4:datae') });
  let waitForSecond = () => {};
  const secondWait = new Promise(resolve => { waitForSecond = resolve; });
  manager.sleep = (_milliseconds, signal) => new Promise(resolve => {
    const finish = () => { signal.removeEventListener('abort', finish); resolve(); };
    signal.addEventListener('abort', finish, { once: true });
    waitForSecond();
  });
  const started = [];
  manager.torrentBridge = {
    downloadSelected(_metadata, { signal }) {
      started.push('active-transfer');
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new Error('acquisition aborted'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    },
  };

  const resume = manager.resumeLibgenSeeds();
  await secondWait;
  await manager.close();
  await resume;
  assert.deepEqual(started, []);
  assert.equal(manager.libgenAcquisitionJobs.size, 0);
  assert.equal(store.downloads().find(item => item.bookId === records[0].md5).status, 'finding-peers');
  assert.equal(store.downloads().find(item => item.bookId === records[1].md5).status, 'queued');
}));

test('manager default seed delay clears its timer when shutdown aborts resume', () => withManager(async ({ manager, store }) => {
  const records = [
    { md5: '5'.repeat(32), libgenId: 2412930 },
    { md5: '6'.repeat(32), libgenId: 2412931 },
  ];
  for (const record of records) {
    store.upsertBook({ id: record.md5, md5: record.md5, title: 'Interrupted', extension: 'epub', sourceNativeId: String(record.libgenId) });
    store.setDownload({ bookId: record.md5, status: 'queued', source: 'torrent' });
  }
  manager.fetch = async (_url, { signal }) => {
    if (signal.aborted) throw signal.reason;
    return { ok: true, arrayBuffer: async () => Buffer.from('d4:test4:datae') };
  };
  manager.torrentBridge = {
    downloadSelected(_metadata, { signal }) {
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  };

  const resume = manager.resumeLibgenSeeds();
  assert.ok(manager.libgenAcquisitionJobs.has(records[0].md5));
  const startedAt = Date.now();
  await manager.close();
  await resume;
  assert.ok(Date.now() - startedAt < 1000, 'shutdown should not wait for the 1.5 second seed delay');
  assert.equal(manager.libgenAcquisitionJobs.size, 0);
}));

test('manager removes a seed returned after shutdown instead of retaining it', () => withManager(async ({ manager, store, root }) => {
  const md5 = '7'.repeat(32);
  const seedRoot = path.join(root, 'staging', 'libgen-seeds');
  const seedFile = path.join(seedRoot, '2412000', md5);
  await fsp.mkdir(path.dirname(seedFile), { recursive: true });
  await fsp.writeFile(seedFile, 'seed bytes');
  store.upsertBook({ id: md5, md5, title: 'Persistent Seed', extension: 'epub', sourceNativeId: '2412930' });
  store.setDownload({ bookId: md5, status: 'ready', source: 'torrent', bytes: 10, totalBytes: 10 });
  manager.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('d4:test4:datae') });
  let finishSelection;
  const selected = new Promise(resolve => { finishSelection = resolve; });
  let selectionStarted;
  const startSelected = new Promise(resolve => { selectionStarted = resolve; });
  let removed = 0;
  const torrent = {};
  manager.torrentBridge = {
    downloadSelected: async () => { selectionStarted(); return selected; },
    async remove(received) { assert.equal(received, torrent); removed += 1; },
  };

  const resume = manager.resumeLibgenSeeds();
  await startSelected;
  const closing = manager.close();
  finishSelection({ filePath: seedFile, torrent });
  await Promise.all([resume, closing]);
  assert.equal(removed, 1);
  assert.equal(torrent.bookstrSeedingBookIds, undefined);
}));

test('LibGen acquisition removes torrent data when automatic seeding is disabled', () => withManager(async ({ manager, root }) => {
  const md5 = 'd'.repeat(32);
  const body = Buffer.from('epub bytes');
  let removed = 0;
  let stageDir = '';
  manager.fetch = async () => ({ ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from('d4:test4:datae') });
  manager.torrentBridge = {
    async downloadSelected(_metadata, options) {
      stageDir = options.path;
      const filePath = path.join(options.path, 'r_1000', md5);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, body);
      return { filePath, torrent: {} };
    },
    async remove() { removed += 1; },
  };
  await manager.acquireLibgen({ md5, id: 1234, title: 'No seed', extension: 'epub' }, { autoSeed: false });
  assert.equal(removed, 1);
  assert.match(stageDir, /libgen-download-/);
  assert.equal(await fsp.stat(stageDir).catch(() => null), null);
  assert.equal(await fsp.stat(path.join(root, 'staging', 'libgen-seeds')).catch(() => null), null);
}));

test('LibGen torrent metadata uses the containing 1,000-book batch', () => {
  assert.match(libgenTorrentMetadataURL(2412930), /\/r_2412000\.torrent$/);
  assert.throws(() => libgenTorrentMetadataURL(0), /positive integer/);
});

test('acquisition retries the next eligible source after a checksum failure', () => withManager(async ({ manager, store }) => {
  let calls = 0;
  manager.fetch = async url => {
    calls += 1;
    const body = url.endsWith('/good.epub') ? 'book bytes' : 'bad bytes';
    return { ok: true, status: 200, headers: new Headers({ 'content-length': String(body.length) }), body: Readable.toWeb(Readable.from(Buffer.from(body))) };
  };
  const result = await manager.acquire({
    provider: 'gutenberg', recordId: 'g-2', title: 'Book',
    acquisitions: [
      { format: 'epub', url: 'https://example.test/bad.epub', availability: 'open', sha256: 'a'.repeat(64), size: 9 },
      { format: 'epub', url: 'https://example.test/good.epub', availability: 'open', size: 10, sha256: BOOK_SHA256 },
    ],
  });
  assert.equal(calls, 2);
  assert.equal(result.size, 10);
  assert.equal(store.downloads()[0].status, 'ready');
}));

test('torrent acquisition rejects multi-file torrents before import and destroys the torrent', () => withManager(async ({ manager }) => {
  let destroyed = 0;
  manager.torrentBridge = { addPublic: async () => ({ files: [{ path: 'one.epub' }, { path: 'two.epub' }], on() {}, destroy() { destroyed += 1; } }) };
  await assert.rejects(() => manager.acquire({
    provider: 'propagate', recordId: 'p-1', title: 'Book',
    acquisitions: [{ format: 'epub', torrent: 'https://example.test/book.torrent', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
  assert.equal(destroyed, 1);
}));

test('private torrent candidates stay out of the unauthenticated acquisition path', () => withManager(async ({ manager }) => {
  let calls = 0;
  manager.torrentBridge = { addPrivate: async () => { calls += 1; throw new Error('private handoff is not available'); } };
  await assert.rejects(() => manager.acquire({
    provider: 'propagate', recordId: 'private-1', title: 'Book',
    acquisitions: [{ format: 'epub', torrent: 'https://example.test/book.torrent', private: true, availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /no eligible acquisition/);
  assert.equal(calls, 0);
}));

test('acquisition deprioritizes a source in cooldown', () => withManager(async ({ manager, store }) => {
  store.recordSourceHealth({ source: 'gutenberg:slow', success: false, now: Math.floor(Date.now() / 1000) });
  const calls = [];
  manager.fetch = async url => {
    calls.push(url);
    const body = 'book bytes';
    return { ok: true, status: 200, headers: new Headers({ 'content-length': String(body.length) }), body: Readable.toWeb(Readable.from(Buffer.from(body))) };
  };
  const result = await manager.acquire({
    provider: 'gutenberg', recordId: 'g-3', title: 'Book',
    acquisitions: [
      { format: 'epub', url: 'https://slow.example/book.epub', source_id: 'slow', availability: 'open', size: 10, sha256: BOOK_SHA256 },
      { format: 'epub', url: 'https://fast.example/book.epub', source_id: 'fast', availability: 'open', size: 10, sha256: BOOK_SHA256 },
    ],
  });
  assert.equal(calls[0], 'https://fast.example/book.epub');
  assert.equal(result.source, 'gutenberg:fast');
}));

test('acquisition blocks untrusted and private HTTP origins before fetching', () => withManager(async ({ manager }) => {
  let calls = 0;
  manager.fetch = async () => { calls += 1; throw new Error('fetch should not run'); };
  await assert.rejects(() => manager.acquire({
    provider: 'gutenberg', recordId: 'ssrf-1', title: 'Book',
    acquisitions: [{ format: 'epub', url: 'https://127.0.0.1/private.epub', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
  await assert.rejects(() => manager.acquire({
    provider: 'gutenberg', recordId: 'ssrf-2', title: 'Book',
    acquisitions: [{ format: 'epub', url: 'https://evil.example/book.epub', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
  assert.equal(calls, 0);
}));

test('acquisition rejects missing, mismatched, and oversized lengths', () => withManager(async ({ manager }) => {
  manager.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: Readable.toWeb(Readable.from(Buffer.from('book bytes'))),
  });
  await assert.rejects(() => manager.acquire({
    provider: 'gutenberg', recordId: 'size-1', title: 'Book',
    acquisitions: [{ format: 'epub', url: 'https://example.test/missing.epub', availability: 'open', sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);

  manager.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': '11' }),
    body: Readable.toWeb(Readable.from(Buffer.from('book bytes'))),
  });
  await assert.rejects(() => manager.acquire({
    provider: 'gutenberg', recordId: 'size-2', title: 'Book',
    acquisitions: [{ format: 'epub', url: 'https://example.test/mismatch.epub', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);

  manager.maxBytes = 5;
  await assert.rejects(() => manager.acquire({
    provider: 'gutenberg', recordId: 'size-3', title: 'Book',
    acquisitions: [{ format: 'epub', url: 'https://example.test/large.epub', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
}));

test('streaming acquisition enforces the hard limit even when metadata matches', () => withManager(async ({ manager }) => {
  manager.maxBytes = 10;
  manager.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': '10' }),
    body: Readable.toWeb(Readable.from(Buffer.from('book bytes plus extra'))),
  });
  await assert.rejects(() => manager.acquire({
    provider: 'gutenberg', recordId: 'size-4', title: 'Book',
    acquisitions: [{ format: 'epub', url: 'https://example.test/stream.epub', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
}));

test('torrent acquisition rejects a torrent whose declared length exceeds the hard limit', () => withManager(async ({ manager }) => {
  manager.maxBytes = 5;
  let destroyed = 0;
  manager.torrentBridge = {
    addPublic: async () => ({
      length: 10,
      files: [{ path: 'book.epub', length: 10 }],
      on() {},
      destroy() { destroyed += 1; },
    }),
  };
  await assert.rejects(() => manager.acquire({
    provider: 'propagate', recordId: 'size-5', title: 'Book',
    acquisitions: [{ format: 'epub', torrent: 'https://example.test/book.torrent', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
  assert.equal(destroyed, 1);
}));

test('torrent acquisition destroys a torrent that crosses the streaming hard limit', () => withManager(async ({ manager }) => {
  manager.maxBytes = 5;
  let destroyed = 0;
  const torrent = {
    downloaded: 0,
    files: [{ path: 'book.epub' }],
    on(event, callback) {
      if (event === 'download') queueMicrotask(() => {
        torrent.downloaded = 6;
        callback();
      });
    },
    destroy() { destroyed += 1; },
  };
  manager.torrentBridge = { addPublic: async () => torrent };
  await assert.rejects(() => manager.acquire({
    provider: 'propagate', recordId: 'stream-limit-1', title: 'Book',
    acquisitions: [{ format: 'epub', torrent: 'https://example.test/book.torrent', availability: 'open', size: 5, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
  assert.equal(destroyed, 1);
}));

test('torrent acquisition destroys a completed torrent when its staged file fails validation', () => withManager(async ({ manager }) => {
  let destroyed = 0;
  manager.torrentBridge = {
    addPublic: async () => ({
      done: true,
      files: [{ path: 'missing.epub', length: 10 }],
      destroy() { destroyed += 1; },
      on() {},
    }),
  };
  await assert.rejects(() => manager.acquire({
    provider: 'propagate', recordId: 'post-validation-1', title: 'Book',
    acquisitions: [{ format: 'epub', torrent: 'https://example.test/book.torrent', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
  assert.equal(destroyed, 1);
}));


test('LibGen collection routing preserves explicit collections and repairs legacy comic jobs', () => {
  for (const collection of ['nonfiction', 'fiction', 'comics']) assert.equal(libgenCollection({ collection }), collection);
  assert.equal(libgenCollection({ collection: 'nonfiction', extension: 'cbr' }), 'nonfiction');
  assert.equal(libgenCollection({ extension: 'CBR' }), 'comics');
  assert.equal(libgenCollection({ format: 'cbz' }), 'comics');
  assert.equal(libgenCollection({ source_url: 'https://example.test/f_1000.torrent' }), 'fiction');
  assert.equal(libgenCollection({ sourceUrl: 'https://example.test/c_1000.torrent' }), 'comics');
  assert.equal(libgenCollection({ extension: 'pdf' }), 'nonfiction');
  assert.equal(libgenCollection(), 'nonfiction');
  assert.match(libgenTorrentMetadataURL(2521871, '', 'comics'), /libgen_li_comics\/c_2521000.torrent$/);
  assert.match(libgenTorrentMetadataURL(2521871, '', 'fiction'), /libgen_rs_fic\/f_2521000.torrent$/);
  assert.match(libgenTorrentMetadataURL(1), /r_000.torrent$/);
  assert.equal(libgenTorrentMetadataURL(1, 'https://example.test/', 'unknown'), 'https://example.test/r_000.torrent');
});

test('a failed comic acquisition uses the comics repository and preserves shared partial downloads', () => withManager(async ({ manager, root }) => {
  const partial = path.join(root, 'staging', 'libgen-seeds', 'other-batch', 'partial');
  await fsp.mkdir(path.dirname(partial), { recursive: true });
  await fsp.writeFile(partial, 'keep these bytes');
  let requested;
  manager.fetch = async url => {
    requested = url;
    return { ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from('d4:test4:datae') };
  };
  manager.torrentBridge = { async downloadSelected() { throw new Error('no peers yet'); } };
  await assert.rejects(() => manager.acquireLibgen({ md5: 'a'.repeat(32), libgenId: 2521871, extension: 'cbr' }), /no peers yet/);
  assert.match(requested, /libgen_li_comics\/c_2521000.torrent$/);
  assert.equal(await fsp.readFile(partial, 'utf8'), 'keep these bytes');
}));
