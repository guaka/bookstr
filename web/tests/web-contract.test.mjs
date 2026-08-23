import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('served web app remains React- and bundle-free', () => {
  assert.doesNotMatch(html, /react(?:-dom)?(?:\.production)?/i);
  assert.doesNotMatch(html, /node_modules|bookstr-dist/i);
});

test('footer links to the latest released Android APK', () => {
  assert.match(html, /github\.com\/guaka\/bookstr\/releases\/latest/);
  assert.match(html, /Download the latest Bookstr Android APK/);
});

test('browser traffic uses the Cloudflare books API', () => {
  assert.match(html, /const BOOKS_API_BASE = 'https:\/\/books-api\.guaka\.org\/api'/);
  assert.doesNotMatch(html, /localhost:11111\/api|books\.guaka\.org\/api\/search/);
});

test('book opening canonicalizes stable Gutenberg IDs', () => {
  assert.match(html, /const readPath = BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\)/);
});

test('reading mode forwards global Left and Right keys to the EPUB reader', () => {
  assert.match(html, /event\.key === 'ArrowLeft' \? 'prevPage' : 'nextPage'/);
  assert.match(html, /readerFrame\.contentWindow\?\.\[command\]\?\.\(\)/);
});

test('EPUBs use persistent IndexedDB caching', () => {
  assert.match(html, /indexedDB\.open\(BOOK_CACHE_DB_NAME/);
  assert.match(html, /cachedBookBlob\(book, readPath\)/);
  assert.match(html, /cacheBookBlob\(book, readPath, blob\)/);
});

test('favorites are not truncated to fifty items', () => {
  assert.doesNotMatch(html, /state\.favorites[^;]*slice\(0,\s*50\)/s);
});

test('Home title links invoke the library book resolver', () => {
  assert.match(html, /titleLink\.addEventListener\('click',[\s\S]*?openLibraryBook\(book\)/);
});

test('Home shows accessible APK-style reading progress', () => {
  assert.match(html, /home-reading-progress-track/);
  assert.match(html, /setAttribute\('role', 'progressbar'\)/);
  assert.match(html, /BookMetadata\.readingProgressForBook\(book\)/);
  assert.match(html, /% read/);
});

test('web chrome uses the shared Bookstr identity', () => {
  assert.match(html, /public\/favicon\.svg/);
  assert.doesNotMatch(html, /class="app-title"/);
  assert.match(html, /\.brand-mark\s*\{[\s\S]*?height:\s*2\.4rem/);
  assert.match(html, /public\/apple-touch-icon\.png/);
  assert.match(html, /--reading-progress:\s*#2f5d50/);
  assert.match(html, /background:\s*#e7c766/);
});

test('vocabulary deletion publishes a NIP-09 event', () => {
  assert.match(html, /kind:\s*5,[\s\S]*?Delete vocabulary word/);
});
