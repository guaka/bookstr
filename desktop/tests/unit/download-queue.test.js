'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LibraryStore } = require('../../library-store');
const { DownloadQueue } = require('../../download-queue');

const book = { md5: 'a'.repeat(32), libgenId: 2412930, title: 'Queued PDF', extension: 'pdf', collection: 'fiction' };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('Timed out waiting for queued acquisitions to start.');
}

test('queued desktop download is durable, deduplicated, and resumes after restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-queue-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: root });
  try {
    let release;
    const firstManager = { acquireLibgen: () => new Promise(resolve => { release = resolve; }) };
    const first = new DownloadQueue({ store, acquisitionManager: firstManager });
    const initial = await first.enqueue({ kind: 'libgen', record: book });
    assert.equal(initial.bookId, book.md5);
    assert.equal(initial.queuedFromSearch, 1);
    assert.equal(store.downloadRequest(book.md5).record.title, book.title);
    assert.equal(store.downloadRequest(book.md5).record.collection, 'fiction');
    const duplicate = await first.enqueue({ kind: 'libgen', record: book });
    assert.equal(duplicate.bookId, book.md5);
    assert.equal(store.resumableDownloads().length, 1);
    release();
    await tick();
    // A real acquisition marks ready. Simulate a process terminated while an
    // earlier saved transfer was still active.
    store.setDownload({ bookId: book.md5, status: 'downloading', bytes: 4, totalBytes: 100 });
    const calls = [];
    const next = new DownloadQueue({ store, acquisitionManager: { async acquireLibgen(record) {
      calls.push(record.md5);
      store.setDownload({ bookId: record.md5, status: 'ready', bytes: 100, totalBytes: 100 });
    } } });
    await next.resume();
    await tick();
    assert.deepEqual(calls, [book.md5]);
    assert.equal(store.downloads()[0].status, 'ready');
    await next.enqueue({ kind: 'libgen', record: book });
    assert.deepEqual(calls, [book.md5]);
  } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('queue starts up to 100 acquisitions promptly and refills a slot when one finishes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-queue-parallel-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: root });
  const books = Array.from({ length: 101 }, (_, index) => ({
    ...book,
    md5: index.toString(16).padStart(32, '0'),
    libgenId: 2412930 + index,
  }));
  const started = [];
  const releases = new Map();
  try {
    const queue = new DownloadQueue({ store, acquisitionManager: { acquireLibgen(record) {
      started.push(record.md5);
      return new Promise(resolve => releases.set(record.md5, resolve));
    } } });
    await Promise.all(books.map(record => queue.enqueue({ kind: 'libgen', record })));
    await waitFor(() => started.length === 100);
    assert.deepEqual(started, books.slice(0, 100).map(record => record.md5));

    const drained = queue.drain();
    releases.get(books[0].md5)();
    await waitFor(() => started.length === 101);
    assert.equal(started[100], books[100].md5);

    for (const release of releases.values()) release();
    await drained;
    assert.equal(queue.activeJobs.size, 0);
    assert.equal(queue.pending.length, 0);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('active and pending requests deduplicate; failures do not block later acquisitions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-queue-dedupe-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: root });
  const records = [0, 1, 2].map(index => ({
    ...book,
    md5: (index + 1).toString(16).padStart(32, '0'),
    libgenId: 2412940 + index,
  }));
  const started = [];
  let releaseFirst;
  try {
    const queue = new DownloadQueue({ store, maxConcurrent: 1, acquisitionManager: {
      async acquireLibgen(record) {
        started.push(record.md5);
        if (record.md5 === records[0].md5) {
          await new Promise(resolve => { releaseFirst = resolve; });
          store.setDownload({ bookId: record.md5, status: 'ready' });
        } else if (record.md5 === records[1].md5) {
          throw new Error('source unavailable');
        } else {
          store.setDownload({ bookId: record.md5, status: 'ready' });
        }
      },
    } });
    await queue.enqueue({ kind: 'libgen', record: records[0] });
    await waitFor(() => started.length === 1);
    await queue.enqueue({ kind: 'libgen', record: records[1] });
    queue.schedule(records[1].md5, { kind: 'libgen', record: records[1] });
    await queue.enqueue({ kind: 'libgen', record: records[2] });
    assert.equal(queue.pending.length, 2);

    const drained = queue.drain();
    releaseFirst();
    await drained;
    assert.deepEqual(started, records.map(record => record.md5));
    assert.equal(store.downloads().find(item => item.bookId === records[1].md5).status, 'failed');
    assert.equal(store.downloads().find(item => item.bookId === records[2].md5).status, 'ready');
    assert.equal(queue.activeJobs.size, 0);
    assert.equal(queue.pending.length, 0);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('failed desktop download keeps its request and can retry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-queue-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: root });
  try {
    let attempts = 0;
    const queue = new DownloadQueue({ store, acquisitionManager: { async acquireLibgen(record) {
      attempts += 1;
      if (attempts === 1) throw new Error('peers unavailable');
      store.setDownload({ bookId: record.md5, status: 'ready' });
    } } });
    await queue.enqueue({ kind: 'libgen', record: book });
    await tick();
    assert.equal(store.downloads()[0].status, 'failed');
    assert.match(store.downloads()[0].error, /peers unavailable/);
    await queue.retry(book.md5);
    await tick();
    assert.equal(attempts, 2);
    assert.equal(store.downloads()[0].status, 'ready');
  } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('progress updates do not flood the renderer with queue notifications', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-queue-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: root });
  try {
    let notifications = 0;
    const queue = new DownloadQueue({ store, onUpdate: () => { notifications += 1; }, acquisitionManager: {
      async acquireLibgen(_record, { onProgress }) {
        for (let index = 0; index < 100; index += 1) onProgress();
      },
    } });
    await queue.enqueue({ kind: 'libgen', record: book });
    await tick();
    assert.equal(notifications, 3);
  } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('the first progress update is delivered when the system clock starts at zero', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-queue-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: root });
  const originalNow = Date.now;
  t.after(() => { Date.now = originalNow; });
  try {
    let notifications = 0;
    let reportProgress;
    let finishAcquisition;
    Date.now = () => 0;
    const queue = new DownloadQueue({ store, onUpdate: () => { notifications += 1; }, acquisitionManager: {
      async acquireLibgen(_record, { onProgress }) {
        reportProgress = onProgress;
        await new Promise(resolve => { finishAcquisition = resolve; });
      },
    } });
    await queue.enqueue({ kind: 'libgen', record: book });
    reportProgress();
    assert.equal(notifications, 2);
    finishAcquisition();
    await tick();
  } finally {
    Date.now = originalNow;
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('queue rejects records without a supported edition or downloadable file', async () => {
  const queue = new DownloadQueue({ store: {}, acquisitionManager: {} });
  await assert.rejects(() => queue.prepare({ kind: 'libgen', record: { ...book, libgenId: 0 } }), /edition number/);
  await assert.rejects(() => queue.prepare({ kind: 'provider', record: {
    provider: 'gutenberg', recordId: 'x', acquisitions: [{ format: 'epub', url: 'file:///x.epub', availability: 'open' }],
  } }), /downloadable file/);
});

test('LibGen comic acquisitions accept CBZ and CBR formats', async () => {
  const queue = new DownloadQueue({ store: {}, acquisitionManager: {} });
  for (const extension of ['cbz', 'cbr']) {
    assert.equal((await queue.prepare({ kind: 'libgen', record: { ...book, extension } })).fields.extension, extension);
  }
});

test('provider downloads preserve their source and allow trusted open files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-provider-queue-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: root });
  try {
    const calls = [];
    const record = { provider: 'gutenberg', recordId: '42', title: 'Open edition',
      acquisitions: [{ format: 'epub', url: 'https://example.test/book.epub', availability: 'open' }] };
    const queue = new DownloadQueue({ store, acquisitionManager: { async acquire(received, options) {
      calls.push({ received, options });
      options.onProgress();
      store.setDownload({ bookId: 'gutenberg:42', status: 'ready' });
    } } });
    await queue.enqueue({ kind: 'provider', record });
    await tick();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].received, record);
    assert.equal(calls[0].options.allowUnverifiedOpen, true);
    assert.equal(store.downloads()[0].status, 'ready');
    assert.equal(store.downloadRequest('gutenberg:42').record.title, 'Open edition');
    await assert.rejects(() => queue.retry('missing'), /without its source record/);
  } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('relaunch marks invalid saved jobs failed without starting an acquisition', async () => {
  const states = [];
  const queue = new DownloadQueue({ store: {
    resumableDownloads: () => [
      { bookId: 'b'.repeat(32), request: { kind: 'libgen', record: book } },
      { bookId: 'broken', request: null },
    ],
    setDownload: update => states.push(update),
  }, acquisitionManager: {} });
  await queue.resume();
  assert.equal(states.length, 2);
  assert.ok(states.every(job => job.status === 'failed'));
  assert.match(states[0].error, /identity changed/);
  assert.match(states[1].error, /Invalid download request/);
  assert.equal(queue.pending.length, 0);
});

test('queue validates construction, concurrency bounds, and request admission', async () => {
  assert.throws(() => new DownloadQueue(), /required/);
  assert.throws(() => new DownloadQueue({ store: {} }), /required/);
  const queue = new DownloadQueue({ store: {}, acquisitionManager: {} });
  assert.equal(queue.maxConcurrent, 100);
  for (const maxConcurrent of [0, -1, 1.5, 101, Infinity]) {
    assert.throws(() => new DownloadQueue({ store: {}, acquisitionManager: {}, maxConcurrent }), /maxConcurrent/);
  }
  for (const request of [null, [], 'book']) await assert.rejects(() => queue.prepare(request), /Invalid download request/);
  await assert.rejects(() => queue.prepare({ kind: 'unknown' }), /Unsupported download request/);
});


test('retry rebuilds a legacy catalog request from saved metadata and rejects missing sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-legacy-retry-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: root });
  try {
    store.upsertBook({ ...book, id: book.md5, source: 'libvault', sourceNativeId: '2521871', extension: 'cbr' });
    store.setDownload({ bookId: book.md5, status: 'failed', source: 'torrent' });
    const called = [];
    const queue = new DownloadQueue({ store, acquisitionManager: { async acquireLibgen(record) { called.push(record); } } });
    await queue.retry(book.md5);
    await queue.drain();
    assert.equal(called[0].libgenId, 2521871);
    assert.equal(called[0].extension, 'cbr');
    assert.equal(store.downloadRequest(book.md5).kind, 'libgen');
    await assert.rejects(() => queue.retry('missing'), /without its source record/);
  } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
});
