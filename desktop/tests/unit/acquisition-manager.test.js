'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { AcquisitionManager, libgenTorrentMetadataURL } = require('../../acquisition-manager');
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
  let destroyed = 0;
  manager.torrentBridge = {
    async downloadSelected(_metadata, options) {
      requestedFile = options.fileName;
      const filePath = path.join(options.path, 'r_2412000', md5);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(filePath, body);
      options.onProgress({ bytes: body.length, totalBytes: body.length });
      return { filePath, torrent: { destroy() { destroyed += 1; } } };
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
  assert.equal(result.source, 'torrent');
  assert.equal(store.getBook(md5).sha256, result.sha256);
  assert.equal(store.downloads()[0].status, 'ready');
  assert.equal(destroyed, 1);
  assert.equal((await fsp.readdir(path.join(root, 'staging'))).length, 0);
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
