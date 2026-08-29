import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The app loads fb2.js as a browser ES module, while the repository does not
// mark the web directory as type=module. Import the exact source through a
// data URL so these tests stay dependency-free and do not require a package
// metadata change just for the test runner.
const fb2Source = await readFile(new URL('../fb2.js', import.meta.url), 'utf8');
const { isFB2Name, isFB2ProgressLocator, isFB2Type } = await import(
  `data:text/javascript;base64,${Buffer.from(fb2Source).toString('base64')}`,
);
const reader = await readFile(new URL('../fb2-reader.html', import.meta.url), 'utf8');
const validation = await readFile(new URL('../fb2-validation.js', import.meta.url), 'utf8');

test('recognizes supported FictionBook downloads and MIME types', () => {
  assert.equal(isFB2Type('application/x-fictionbook+xml; charset=utf-8'), true);
  assert.equal(isFB2Type('APPLICATION/FB2+XML'), true);
  assert.equal(isFB2Type(' application/fb2+xml ; charset=utf-8 '), true);
  assert.equal(isFB2Type('application/zip'), false);
  assert.equal(isFB2Type('application/epub+zip'), false);
  assert.equal(isFB2Name('https://books.example/a.fb2.zip?download=1'), true);
  assert.equal(isFB2Name('https://books.example/A.FB2#download'), true);
  assert.equal(isFB2Name('https://books.example/a.fb2.exe'), false);
  assert.equal(isFB2Name('https://books.example/a.fb2.zip.tmp'), false);
  assert.equal(isFB2Name('a.epub'), false);
});

test('validates portable FB2 reading locations', () => {
  assert.equal(isFB2ProgressLocator('fb2:chapter-1:12:4'), true);
  assert.equal(isFB2ProgressLocator('fb2:1:0:0'), true);
  assert.equal(isFB2ProgressLocator('fb2:chapter_1.2:001:004'), true);
  assert.equal(isFB2ProgressLocator('epubcfi(/6/2)'), false);
  assert.equal(isFB2ProgressLocator('fb2:bad:1'), false);
  assert.equal(isFB2ProgressLocator('fb2:chapter 1:1:0'), false);
  assert.equal(isFB2ProgressLocator('fb2:chapter:one:0'), false);
  assert.equal(isFB2ProgressLocator('fb2::1:0'), false);
});

test('FB2 reader asset is wired to structural parsing and safe progress reporting', () => {
  assert.match(reader, /import\s*\{\s*parseFB2\s*\}\s*from ['"]\.\/fb2\.js['"]/);
  assert.match(reader, /window\.loadFB2\s*=\s*async/);
  assert.match(reader, /parseFB2\(decode\(base64\),document\)/);
  assert.match(reader, /type:'bookstr-reader-progress'/);
  assert.match(reader, /furthestProgression:furthest/);
  assert.match(reader, /cfi:locator\(\)/);
  assert.match(reader, /window\.nextPage/);
  assert.match(reader, /window\.prevPage/);
});

test('FB2 parser asset rejects active XML content and external navigation', () => {
  assert.match(fb2Source, /<!DOCTYPE\|<!ENTITY/);
  assert.match(fb2Source, /application\/x-fictionbook\+xml/);
  assert.match(fb2Source, /application\/fb2\+xml/);
  assert.match(fb2Source, /getAttribute\('l:href'\)\s*\|\|\s*child\.getAttribute\('href'\)/);
  assert.match(fb2Source, /\^#\[-A-Za-z0-9_\.:\]\+\$/);
  assert.match(fb2Source, /createTextNode/);
  assert.doesNotMatch(fb2Source, /innerHTML\s*=/);
});

test('FB2 download validation keeps native bytes and restricts ZIPs to one safe book', () => {
  assert.match(validation, /MAX_BYTES = 50 \* 1024 \* 1024/);
  assert.match(validation, /<!DOCTYPE\|<!ENTITY/);
  assert.match(validation, /entries\.length !== 1/);
  assert.match(validation, /safeName\(files\[0\]\.name\)/);
  assert.match(validation, /uncompressedSize/);
  assert.match(validation, /checkCRC32: true/);
  assert.match(validation, /new Blob\(\[bytes\], \{ type: 'application\/fb2\+xml' \}\)/);
  assert.match(validation, /Invalid or unsafe FB2 file/);
});
