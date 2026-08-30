'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { LibraryStore } = require('../../library-store');

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(__dirname, '.bookstr-library-'));
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: path.join(root, 'files') });
  try { return fn(store, root); } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

test('local catalog upserts and Unicode search are available in Electron', () => withStore(store => {
  store.upsertBook({ id: 'ru-1', title: 'Война и мир', authors: 'Лев Толстой', language: 'ru', extension: 'fb2', rights_status: 'public_domain' });
  store.upsertBook({ id: 'zh-1', title: '红楼梦', authors: '曹雪芹', language: 'zh', extension: 'epub', rights_status: 'public_domain' });
  store.upsertBook({ id: 'nc-1', title: 'Restricted', license: 'CC BY-NC 4.0', rights_status: 'open_license' });
  assert.equal(store.search({ query: 'Толстой' }).total, 1);
  assert.equal(store.search({ query: '红楼', language: 'zh' }).books[0].id, 'zh-1');
  assert.equal(store.getBook('ru-1').title, 'Война и мир');
  assert.equal(store.getBook('ru-1').public_seed_allowed, true);
  assert.equal(store.getBook('nc-1').public_seed_allowed, false);
}));

test('download and linked-folder APIs never return filesystem paths', () => withStore(store => {
  store.upsertBook({ id: 'book-1', title: 'Book' });
  store.setDownload({ bookId: 'book-1', status: 'ready', relativePath: 'books/book.epub', bytes: 3, totalBytes: 3, source: 'webtorrent' });
  store.registerLibraryFile({ bookId: 'book-1', relativePath: 'books/book.epub', size: 3 });
  store.linkFolder({ relativePath: 'linked', label: 'Linked' });
  assert.equal(Object.hasOwn(store.downloads()[0], 'relativePath'), false);
  assert.deepEqual(store.linkedFolders(), [{ id: store.linkedFolders()[0].id, label: 'Linked', enabled: true }]);
  const reader = store.openReader('book-1');
  assert.match(reader.token, /^[A-Za-z0-9_-]+$/);
  assert.equal(store.resolveReaderToken(reader.token).path.endsWith(path.join('files', 'books', 'book.epub')), true);
}));

test('path traversal is rejected at the storage boundary', () => withStore(store => {
  store.upsertBook({ id: 'book-1', title: 'Book' });
  assert.throws(() => store.registerLibraryFile({ bookId: 'book-1', relativePath: '../secret.epub' }), /relative path/);
  assert.throws(() => store.linkFolder({ relativePath: '/outside' }), /relative path/);
}));
