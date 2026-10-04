'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LibraryStore } = require('../../library-store');
const { DownloadQueue } = require('../../download-queue');

const book = { md5: 'a'.repeat(32), libgenId: 2412930, title: 'Queued PDF', extension: 'pdf' };
const tick = () => new Promise(resolve => setImmediate(resolve));

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

test('queue validates construction and admission and deduplicates waiting jobs', async () => {
  assert.throws(() => new DownloadQueue(), /required/);
  assert.throws(() => new DownloadQueue({ store: {} }), /required/);
  const queue = new DownloadQueue({ store: {}, acquisitionManager: {} });
  for (const request of [null, [], 'book']) await assert.rejects(() => queue.prepare(request), /Invalid download request/);
  await assert.rejects(() => queue.prepare({ kind: 'unknown' }), /Unsupported download request/);
  queue.running = true;
  queue.schedule(book.md5, { kind: 'libgen', record: book });
  queue.schedule(book.md5, { kind: 'libgen', record: book });
  assert.equal(queue.pending.length, 1);
});
