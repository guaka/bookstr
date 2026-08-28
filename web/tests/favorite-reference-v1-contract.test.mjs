import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('../favorite-references.js');
const { appendWebReference, parseTag, parseTags } = globalThis.BookstrFavoriteReferences;
const fixture = JSON.parse(await readFile(new URL('../../shared/fixtures/favorite-reference-v1.json', import.meta.url)));
const schema = JSON.parse(await readFile(new URL('../../shared/contracts/favorite-reference-v1.schema.json', import.meta.url)));

test('web compact favorite adapter conforms to every shared v1 case', () => {
  assert.equal(fixture.version, schema.properties.version.const);
  for (const entry of fixture.cases) {
    assert.deepEqual(parseTags(entry.tags), entry.expected, entry.name);
  }
});

test('compact favorite parser rejects malformed tags and timestamps', () => {
  assert.equal(parseTag(null), null);
  assert.equal(parseTag(['book']), null);
  assert.equal(parseTag(['other', 'url', 'https://example.com', '1']), null);
  assert.equal(parseTag(['book', 'unknown', 'id', '1']), null);
  assert.equal(parseTag(['book', 'url', 'not a url', '1']), null);
  assert.equal(parseTag(['book', 'url', 'http://example.com/book', '1']).identifier, 'http://example.com/book');
  assert.equal(parseTag(['book', 'isbn', '0-306-40615-2', '1']).identifier, '0306406152');
  assert.equal(parseTag(['book', 'libvault', 'a'.repeat(32), '1.5']).addedAt, 0);
  assert.equal(parseTag(['book', 'libvault', 'a'.repeat(32), String(Number.MAX_SAFE_INTEGER + 1)]).addedAt, 0);
  assert.deepEqual(parseTags(null), []);
  assert.equal(parseTags([
    ['book', 'bookstr', 'late-time', '0'],
    ['book', 'bookstr', 'late-time', '2'],
  ])[0].addedAt, 2);
});

test('web adapter maps and merges every canonical reference type', () => {
  const entries = [];
  const pseudoId = value => `pseudo:${value}`;
  for (const ref of fixture.cases[0].expected) appendWebReference(entries, ref, pseudoId);
  appendWebReference(entries, {
    type: 'libvault', identifier: 'abcdef0123456789abcdef0123456789', locator: '', addedAt: 10,
  }, pseudoId);
  appendWebReference(entries, {
    type: 'bookstr', identifier: 'provider:record-1', locator: '', addedAt: 0,
  }, pseudoId);
  appendWebReference(entries, {
    type: 'isbn', identifier: '9780123456789', locator: '', addedAt: 0,
  }, pseudoId);
  appendWebReference(entries, {
    type: 'url', identifier: 'https://books.example/direct.epub', locator: '', addedAt: 0,
  }, pseudoId);
  appendWebReference(entries, {
    type: 'blossom', identifier: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    locator: '', addedAt: 0,
  }, pseudoId);

  assert.equal(entries.length, 5);
  assert.equal(entries[0].favoriteAddedAt, 10);
  assert.equal(entries[0].url, 'https://books.example/libvault.epub');
  assert.equal(entries[1].readUrl, 'https://books.example/record-1');
  assert.equal(entries[2].isbn, '9780123456789');
  assert.equal(entries[3].md5, 'pseudo:https://books.example/direct.epub');
  assert.equal(entries[4].blossomUrl, 'https://cdn.example/book.epub');
});

test('web shell delegates compact favorite tags to the shared adapter', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="favorite-references\.js"><\/script>/);
  assert.match(html, /BookstrFavoriteReferences\.parseTag\(tag\)/);
  assert.match(html, /BookstrFavoriteReferences\.appendWebReference\(entries, reference, pseudoIdForSeed\)/);
});
