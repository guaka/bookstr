'use strict';

const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fsp: typeof import('node:fs/promises') = require('node:fs/promises');
const path: typeof import('node:path') = require('node:path');
const test: typeof import('node:test') = require('node:test');
const { LibraryImporter, hashFile } = require('../../library-import') as typeof import('../../src/library-import');

async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fsp.mkdtemp(path.join(__dirname, '.bookstr-import-'));
  try { return await fn(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

test('imports a file by content hash and atomically stores a canonical name', () => withRoot(async root => {
  const source = path.join(root, 'source.epub');
  await fsp.writeFile(source, 'book bytes');
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  const result = await importer.importFile(source);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.relativePath, `books/${result.sha256}.epub`);
  assert.equal(await fsp.readFile(path.join(root, 'library', result.relativePath), 'utf8'), 'book bytes');
  assert.equal((await hashFile(path.join(root, 'library', result.relativePath))).sha256, result.sha256);
}));

test('checksum mismatch leaves no partial import', () => withRoot(async root => {
  const source = path.join(root, 'source.pdf');
  await fsp.writeFile(source, 'not expected');
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  await assert.rejects(() => importer.importFile(source, { expectedSha256: 'a'.repeat(64) }), /checksum/);
  assert.deepEqual((await fsp.readdir(path.join(root, 'library', 'books'))).filter(name => name.endsWith('.part')), []);
}));

test('relative paths cannot escape the library root', () => withRoot(async root => {
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  assert.throws(() => importer.resolveRelativePath('../outside.epub'), /relative path/);
}));

test('deduplicated imports discard staging files and resolve their registered paths', () => withRoot(async root => {
  const source = path.join(root, 'source');
  await fsp.writeFile(source, 'duplicate');
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  const first = await importer.importFile(source);
  const second = await importer.importFile(source, { expectedSha256: first.sha256.toUpperCase() });
  assert.deepEqual(second, first);
  assert.equal(first.extension, 'bin');
  assert.equal(importer.resolveRelativePath(first.relativePath.replaceAll('/', '\\')), path.join(importer.libraryRoot, first.relativePath));
  assert.deepEqual(await fsp.readdir(importer.booksRoot), [`${first.sha256}.bin`]);
}));

test('import boundaries reject missing roots, invalid paths, directories and unsafe extensions', () => withRoot(async root => {
  const { safeExtension } = require('../../library-import') as typeof import('../../src/library-import');
  assert.throws(() => new LibraryImporter(), /libraryRoot/);
  assert.throws(() => safeExtension('../pdf'), /extension/);
  assert.equal(safeExtension(' .PDF '), 'pdf');
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  for (const source of [null, '', ' ', '\0']) await assert.rejects(importer.importFile(source), /sourcePath/);
  await assert.rejects(importer.importFile(root), /regular file/);
  await assert.rejects(hashFile(path.join(root, 'absent')), { code: 'ENOENT' });
  for (const relative of ['', '/outside', 'book\0.pdf', '.']) assert.throws(() => importer.resolveRelativePath(relative), /relative path/);
}));

test('FB2 import is disabled without altering an existing source file', () => withRoot(async root => {
  const source = path.join(root, 'book.fb2');
  const contents = '<FictionBook><body/></FictionBook>';
  await fsp.writeFile(source, contents);
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  await assert.rejects(importer.importFile(source), /unsupported import format/);
  assert.equal(await fsp.readFile(source, 'utf8'), contents);
  await assert.rejects(fsp.stat(importer.booksRoot), { code: 'ENOENT' });
}));

test('import storage errors preserve the failure and clean partial files', t => withRoot(async root => {
  const source = path.join(root, 'source.pdf');
  await fsp.writeFile(source, 'book');
  const importer = new LibraryImporter({ libraryRoot: path.join(root, 'library') });
  const failure = Object.assign(new Error('access denied'), { code: 'EACCES' });
  t.mock.method(fsp, 'access', async () => { throw failure; });
  await assert.rejects(importer.importFile(source), failure);
  assert.deepEqual(await fsp.readdir(importer.booksRoot), []);
}));
