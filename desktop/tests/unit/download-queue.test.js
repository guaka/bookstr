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

test('queue rejects records without a supported edition or downloadable file', async () => {
  const queue = new DownloadQueue({ store: {}, acquisitionManager: {} });
  await assert.rejects(() => queue.prepare({ kind: 'libgen', record: { ...book, libgenId: 0 } }), /edition number/);
  await assert.rejects(() => queue.prepare({ kind: 'provider', record: {
    provider: 'gutenberg', recordId: 'x', acquisitions: [{ format: 'epub', url: 'file:///x.epub', availability: 'open' }],
  } }), /downloadable file/);
});
