const { test } = require('node:test') as typeof import('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { EventEmitter } = require('node:events') as typeof import('node:events');
const path = require('node:path') as typeof import('node:path');
import type { App } from 'electron';
const { OpenBooks, importAndOpenBook } = require('../../open-books') as typeof import('../../src/open-books');
const fs = require('node:fs') as typeof import('node:fs');
const { LibraryStore } = require('../../library-store') as typeof import('../../src/library-store');
const { LibraryImporter } = require('../../library-import') as typeof import('../../src/library-import');

test('external books are persisted, deduplicated and opened without overwriting remembered metadata', async () => {
  const root = fs.mkdtempSync(path.join(__dirname, '.open-book-'));
  const libraryRoot = path.join(root, 'library');
  const store = new LibraryStore({ dbPath: path.join(root, 'library.sqlite'), libraryRoot });
  const importer = new LibraryImporter({ libraryRoot });
  try {
    for (const extension of ['epub', 'pdf']) {
      const source = path.join(root, `External Book.${extension.toUpperCase()}`);
      fs.writeFileSync(source, `external ${extension} bytes`);
      let payload: unknown;
      await importAndOpenBook(source, importer, store, value => { payload = value; });
      const result = payload as { kind: string; base64: string; book: { id: string; title: string } };
      assert.equal(result.kind, extension);
      assert.equal(Buffer.from(result.base64, 'base64').toString(), `external ${extension} bytes`);
      assert.equal(result.book.title, 'External Book');
      assert.equal(store.downloads().find(row => row.bookId === result.book.id)?.status, 'ready');
      assert.ok(store.openReader(result.book.id)?.token);
      store.upsertBook({ ...store.getBook(result.book.id), title: 'Remembered title' });
      await importAndOpenBook(source, importer, store, value => { payload = value; });
      assert.equal((payload as typeof result).book.title, 'Remembered title');
    }
    await assert.rejects(importAndOpenBook(path.join(root, 'missing.pdf'), importer, store, () => assert.fail()), /ENOENT/);
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('queues macOS files before ready and accepts cold and warm argv with the sender cwd', async () => {
  const app = new EventEmitter();
  const opened: string[] = [];
  const controller = new OpenBooks(app as App, async file => { opened.push(file); }, error => assert.fail(String(error)));
  let prevented = false;
  app.emit('open-file', { preventDefault() { prevented = true; } }, '/books/One.EPUB');
  assert.equal(prevented, true);
  assert.deepEqual(opened, []);
  await controller.start(['bookstr', '/books/Two.pdf', '--fake.pdf', '/books/no.txt']);
  app.emit('second-instance', null, ['bookstr', 'Three.epub'], '/sender');
  await controller.receive('/books/Four.pdf');
  assert.deepEqual(opened, ['/books/One.EPUB', '/books/Two.pdf', '/sender/Three.epub', '/books/Four.pdf']);
  await controller.receive('relative.pdf');
  assert.equal(opened.at(-1), path.resolve('relative.pdf'));
  await controller.receive('file:///books/With%20Spaces.pdf');
  assert.equal(opened.at(-1), '/books/With Spaces.pdf');
  const count = opened.length;
  await controller.receive('file://remote-server/book.pdf');
  await controller.receive('https://example.org/book.epub');
  assert.equal(opened.length, count);
});

test('serializes overlapping opens and continues after import failure', async () => {
  const app = new EventEmitter();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const opened: string[] = [], errors: unknown[] = [];
  const controller = new OpenBooks(app as App, async file => {
    opened.push(file);
    if (file.endsWith('first.pdf')) { await gate; throw new Error('Unreadable'); }
  }, error => errors.push(error));
  await controller.start([]);
  const first = controller.receive('/first.pdf');
  await controller.receive('/second.epub');
  assert.deepEqual(opened, ['/first.pdf']);
  release(); await first;
  assert.deepEqual(opened, ['/first.pdf', '/second.epub']);
  assert.equal(String(errors[0]), 'Error: Unreadable');
});

test('packaging registers both document types on all desktop targets and includes the handler', () => {
  const config = require('../../package.json') as { build: { fileAssociations: { ext: string; mimeType: string; role: string; rank: string }[]; files: (string | { filter: string[] })[] } };
  assert.deepEqual(config.build.fileAssociations.map(item => [item.ext, item.mimeType, item.role]), [
    ['epub', 'application/epub+zip', 'Viewer'], ['pdf', 'application/pdf', 'Viewer'],
  ]);
  assert.ok(config.build.files.some(item => typeof item !== 'string' && item.filter.includes('open-books.js')));
  assert.ok(config.build.fileAssociations.every(item => item.rank === 'Alternate'));
});
