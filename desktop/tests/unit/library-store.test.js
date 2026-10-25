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
  store.upsertBook({ id: 'book-1', md5: 'a'.repeat(32), sha256: 'b'.repeat(64), title: 'Book' });
  store.setDownload({ bookId: 'book-1', status: 'ready', relativePath: 'books/book.epub', bytes: 3, totalBytes: 3, source: 'webtorrent' });
  store.registerLibraryFile({ bookId: 'book-1', relativePath: 'books/book.epub', size: 3 });
  store.linkFolder({ relativePath: 'linked', label: 'Linked' });
  assert.equal(Object.hasOwn(store.downloads()[0], 'relativePath'), false);
  assert.equal(store.downloads()[0].md5, 'a'.repeat(32));
  assert.equal(store.downloads()[0].sha256, 'b'.repeat(64));
  assert.equal(store.downloads()[0].title, 'Book');
  assert.equal(store.downloads()[0].sourceNativeId, '');
  assert.deepEqual(store.linkedFolders(), [{ id: store.linkedFolders()[0].id, label: 'Linked', enabled: true }]);
  const reader = store.openReader('book-1');
  assert.match(reader.token, /^[A-Za-z0-9_-]+$/);
  assert.equal(store.resolveReaderToken(reader.token).path.endsWith(path.join('files', 'books', 'book.epub')), true);
  assert.deepEqual(store.libraryFile('book-1'), {
    bookId: 'book-1',
    relativePath: 'books/book.epub',
    sizeBytes: 3,
    modTimeUnix: 0,
    sha256: '',
  });
}));

test('download completion timestamp stays fixed through seeding progress and resets on retry', () => withStore(store => {
  store.upsertBook({ id: 'book-completion', title: 'Completed' });
  const completed = store.setDownload({ bookId: 'book-completion', status: 'ready' }).completedAt;
  assert.ok(completed > 0);
  store.setDownload({ bookId: 'book-completion', status: 'seeding', bytes: 10, totalBytes: 10 });
  assert.equal(store.downloads()[0].completedAt, completed);
  store.setDownload({ bookId: 'book-completion', status: 'downloading', bytes: 1, totalBytes: 20 });
  assert.equal(store.downloads()[0].completedAt, null);
}));

test('legacy completed downloads receive their prior update timestamp during migration', () => {
  const root = fs.mkdtempSync(path.join(__dirname, '.bookstr-library-migration-'));
  const dbPath = path.join(root, 'library.sqlite');
  const libraryRoot = path.join(root, 'files');
  let store = new LibraryStore({ dbPath, libraryRoot });
  store.upsertBook({ id: 'legacy-ready', title: 'Legacy' });
  store.setDownload({ bookId: 'legacy-ready', status: 'ready' });
  store.db.prepare('UPDATE downloads SET completed_at = NULL, updated_at = 123 WHERE book_id = ?').run('legacy-ready');
  store.close();
  store = new LibraryStore({ dbPath, libraryRoot });
  try { assert.equal(store.downloads()[0].completedAt, 123); }
  finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('path traversal is rejected at the storage boundary', () => withStore(store => {
  store.upsertBook({ id: 'book-1', title: 'Book' });
  assert.throws(() => store.registerLibraryFile({ bookId: 'book-1', relativePath: '../secret.epub' }), /relative path/);
  assert.throws(() => store.linkFolder({ relativePath: '/outside' }), /relative path/);
}));

test('source health records cooldowns and clears them after success', () => withStore(store => {
  const failed = store.recordSourceHealth({ source: 'gutenberg:mirror-a', success: false, latencyMs: 250, now: 1000 });
  assert.equal(failed.failures, 1);
  assert.equal(failed.consecutiveFailures, 1);
  assert.equal(failed.cooldownUntil, 1010);
  const recovered = store.recordSourceHealth({ source: 'gutenberg:mirror-a', success: true, latencyMs: 40, now: 1020 });
  assert.equal(recovered.successes, 1);
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.cooldownUntil, 0);
  assert.deepEqual(store.sourceHealthAll().map(item => item.sourceId), ['gutenberg:mirror-a']);
}));

test('deleting stopped downloads persists and preserves local books and files', () => withStore((store, root) => {
  for (const status of ['failed', 'stopped', 'downloading', 'queued', 'ready', 'seeding']) {
    store.upsertBook({ id: status, title: status });
    store.setDownload({ bookId: status, status });
    store.saveDownloadRequest(status, { kind: 'libgen', record: { md5: 'a'.repeat(32) } });
  }
  store.registerLibraryFile({ bookId: 'failed', relativePath: 'kept.pdf', size: 4 });
  const file = path.join(root, 'files', 'kept.pdf');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'keep');
  assert.equal(store.removeDownload('failed'), true);
  assert.equal(store.removeDownload('stopped'), true);
  assert.equal(store.removeDownload('missing'), false);
  assert.equal(store.downloadRequest('failed'), null);
  assert.equal(store.getBook('failed').title, 'failed');
  assert.equal(store.libraryFile('failed').relativePath, 'kept.pdf');
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
  for (const status of ['downloading', 'queued', 'ready', 'seeding']) assert.throws(() => store.removeDownload(status), /Only failed or stopped/);
  const reopened = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot: path.join(root, 'files') });
  try { assert.equal(reopened.downloads().some(job => ['failed', 'stopped'].includes(job.bookId)), false); }
  finally { reopened.close(); }
}));
