'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { LibraryImporter, hashFile } = require('../../library-import');

async function withRoot(fn) {
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
