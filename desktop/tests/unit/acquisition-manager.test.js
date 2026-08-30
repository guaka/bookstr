'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { AcquisitionManager } = require('../../acquisition-manager');
const { LibraryImporter } = require('../../library-import');
const { LibraryStore } = require('../../library-store');

async function withManager(fn) {
  const root = await fsp.mkdtemp(path.join(__dirname, '.bookstr-acquisition-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: path.join(root, 'library') });
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  const manager = new AcquisitionManager({
    store,
    importer,
    stagingRoot: path.join(root, 'staging'),
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
    acquisitions: [{ format: 'epub', url: 'https://example.test/book.epub', availability: 'open', size: 10 }],
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
      { format: 'epub', url: 'https://example.test/good.epub', availability: 'open', size: 10 },
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
    acquisitions: [{ format: 'epub', torrent: 'https://example.test/book.torrent', availability: 'open' }],
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
      { format: 'epub', url: 'https://slow.example/book.epub', source_id: 'slow', availability: 'open', size: 10 },
      { format: 'epub', url: 'https://fast.example/book.epub', source_id: 'fast', availability: 'open', size: 10 },
    ],
  });
  assert.equal(calls[0], 'https://fast.example/book.epub');
  assert.equal(result.source, 'gutenberg:fast');
}));
