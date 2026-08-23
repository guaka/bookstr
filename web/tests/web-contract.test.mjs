import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('served web app remains React- and bundle-free', () => {
  assert.doesNotMatch(html, /react(?:-dom)?(?:\.production)?/i);
  assert.doesNotMatch(html, /node_modules|bookstr-dist/i);
});

test('browser traffic uses the Cloudflare books API', () => {
  assert.match(html, /const BOOKS_API_BASE = 'https:\/\/books-api\.guaka\.org\/api'/);
  assert.doesNotMatch(html, /localhost:11111\/api|books\.guaka\.org\/api\/search/);
});

test('book opening canonicalizes stable Gutenberg IDs', () => {
  assert.match(html, /const readPath = BookMetadata\.canonicalReadUrl\(book, BOOKS_API_BASE\)/);
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

test('vocabulary deletion publishes a NIP-09 event', () => {
  assert.match(html, /kind:\s*5,[\s\S]*?Delete vocabulary word/);
});
