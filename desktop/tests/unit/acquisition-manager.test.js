'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { AcquisitionManager } = require('../../acquisition-manager');
const { LibraryImporter } = require('../../library-import');
const { LibraryStore } = require('../../library-store');

const BOOK_SHA256 = crypto.createHash('sha256').update('book bytes').digest('hex');

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

test('torrent acquisition rejects multi-file torrents before import', () => withManager(async ({ manager }) => {
  manager.torrentBridge = { addPublic: async () => ({ files: [{ path: 'one.epub' }, { path: 'two.epub' }], on() {} }) };
  await assert.rejects(() => manager.acquire({
    provider: 'propagate', recordId: 'p-1', title: 'Book',
    acquisitions: [{ format: 'epub', torrent: 'https://example.test/book.torrent', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
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
  manager.torrentBridge = {
    addPublic: async () => ({
      length: 10,
      files: [{ path: 'book.epub', length: 10 }],
      on() {},
    }),
  };
  await assert.rejects(() => manager.acquire({
    provider: 'propagate', recordId: 'size-5', title: 'Book',
    acquisitions: [{ format: 'epub', torrent: 'https://example.test/book.torrent', availability: 'open', size: 10, sha256: BOOK_SHA256 }],
  }), /all eligible acquisitions failed/);
}));
