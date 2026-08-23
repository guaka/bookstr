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

test('compact favorites retain cached metadata and resolve LibVault IDs', () => {
  assert.match(html, /function preserveFavoriteMetadata\(remote\)/);
  assert.match(html, /\.map\(preserveFavoriteMetadata\)/);
  assert.match(html, /https:\/\/lib\.b\.bfr\.ee\/api\/books\/\$\{libvaultMd5\}/);
  assert.match(html, /api\/read\/\$\{libvaultMd5\}/);
});

test('an incomplete new favorites generation falls back to an older root', () => {
  assert.match(html, /for \(const rootEvent of rootEvents\)/);
  assert.match(html, /A partial new generation must not hide an older complete snapshot/);
});

test('legacy LibVault URL tags restore their embedded favorite ID', () => {
  assert.match(html, /new URLSearchParams\(url\.hash\.split\('\?'\)\[1\] \|\| ''\)\.get\('md5'\)/);
});

test('Home title links invoke the library book resolver', () => {
  assert.match(html, /titleLink\.addEventListener\('click',[\s\S]*?openLibraryBook\(book\)/);
});

test('Home shows the deduplicated library book count below its heading', () => {
  assert.match(html, /homeLibraryHeading\?\.after\(homeLibraryCount\)/);
  assert.match(html, /homeLibraryCount\.textContent = `\$\{library\.length\} \$\{library\.length === 1 \? 'book' : 'books'\}`/);
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

test('settings groups Nostr controls and connection status together', () => {
  assert.match(html, /settings-section settings-nostr[\s\S]*?<h3>Nostr<\/h3>[\s\S]*?id="nip7-enabled"[\s\S]*?id="nip7-status"/);
});

test('vocabulary deletion publishes a durable encrypted tombstone before best-effort NIP-09 cleanup', () => {
  assert.match(html, /deleted:\s*true,[\s\S]*?nip44\.encrypt\(pubkey, JSON\.stringify/);
  assert.match(html, /kind:\s*NOSTR_PROGRESS_KIND,[\s\S]*?tags:\s*\[\['d', dTag\]\]/);
  assert.match(html, /kind:\s*5,[\s\S]*?content:\s*''/);
  assert.doesNotMatch(html, /Delete vocabulary word:/);
  assert.match(html, /state\.words\.push\(tombstone\)/);
  assert.match(html, /saveNostrSyncCache\(pubkey/);
});

test('deleting the word used as the exact Words filter clears that filter', () => {
  assert.match(html, /wordsFilter\.value\.trim\(\)\.toLowerCase\(\) === entry\.word\.trim\(\)\.toLowerCase\(\)/);
  assert.match(html, /wordsFilter\.value = ''/);
});

test('deleted vocabulary remains cached but is not rendered', () => {
  assert.match(html, /return sortByUpdatedAt\(Array\.from\(latestByWord\.values\(\)\)\);/);
  assert.match(html, /filter\(entry => entry && !entry\.deleted\)/);
});
