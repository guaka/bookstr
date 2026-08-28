import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public-lists.js');

const { parseEvent, parseEvents } = globalThis.BookstrPublicLists;

function listEvent({ d = 'hitchwiki-books', title = 'Hitchwiki Books', createdAt = 10, includeTitle = true, compact = true, bookId } = {}) {
  return {
    kind: 30003,
    pubkey: 'a'.repeat(64),
    created_at: createdAt,
    tags: [
      ['d', d],
      ...(includeTitle ? [['title', title]] : []),
      ['description', 'A public reading list'],
      ...(compact ? [['book', 'bookstr', bookId || 'books.hitchwiki.org:geldloos', '10', 'https://books.hitchwiki.org/downloads/geldloos-0.1.epub']] : []),
      ...(includeTitle ? [['bookstr-book', bookId || 'books.hitchwiki.org:geldloos', 'Geldloos', 'Hitchwiki contributors', 'epub', '0', '', '', 'nl', 'books.hitchwiki.org']] : []),
    ],
  };
}

test('parses public Bookstr-compatible NIP-51 lists', () => {
  const list = parseEvent(listEvent());
  assert.equal(list.title, 'Hitchwiki Books');
  assert.equal(list.books.length, 1);
  assert.deepEqual(list.books[0], {
    id: 'books.hitchwiki.org:geldloos',
    title: 'Geldloos',
    authors: 'Hitchwiki contributors',
    extension: 'epub',
    filesize: 0,
    coverUrl: '',
    readUrl: 'https://books.hitchwiki.org/downloads/geldloos-0.1.epub',
    language: 'nl',
    source: 'books.hitchwiki.org',
  });
});

test('returns null for events that are not public reading lists', () => {
  assert.equal(parseEvent({ kind: 30000, tags: [['d', 'not-a-list'], ['title', 'No']] }), null);
  assert.equal(parseEvent({ kind: 30003, tags: { a: 1 } }), null);
});

test('ignores missing titles, missing ids, and private list d-tags', () => {
  assert.equal(parseEvent(listEvent({ includeTitle: false })), null);
  assert.equal(parseEvent({ kind: 30003, tags: [['d', 'public'], ['title', 'No book rows'], ['bookstr-book', '', 'No row']] }), null);
  assert.equal(parseEvent({ kind: 30003, tags: [['d', 'libvault-favorites'], ['title', 'Ignored'], ['bookstr-book', 'id', 'No row']] }), null);
});

test('deduplicates books and ignores malformed book tags', () => {
  const list = parseEvent({
    kind: 30003,
    pubkey: 'a'.repeat(64),
    created_at: 5,
    tags: [
      ['d', 'dedup'],
      ['title', 'Deduplicated'],
      ['bookstr-book', 'duplicate'],
      ['bookstr-book', 'duplicate', 'Should stay one'],
      ['bookstr-book'],
      ['bookstr-book', 'second', 'Second', 'Author', 'pdf'],
      ['book', 'bookstr', 'second', '0', 'https://books.hitchwiki.org/downloads/second.epub'],
      ['invalid'],
      'not-an-array',
    ],
  });
  assert.deepEqual(list.books.map(book => book.id), ['duplicate', 'second']);
  assert.equal(list.books[1].readUrl, 'https://books.hitchwiki.org/downloads/second.epub');
});

test('keeps the newest event for each public list and excludes private collections', () => {
  const lists = parseEvents([
    listEvent({ title: 'Old title', createdAt: 1 }),
    listEvent({ title: 'Hitchwiki Books', createdAt: 2 }),
    listEvent({ d: 'libvault-favorites', title: 'Favorites', createdAt: 3 }),
    listEvent({ d: 'bookstr-collection-secret', title: 'Private', createdAt: 4 }),
  ]);
  assert.deepEqual(lists.map(list => list.title), ['Hitchwiki Books']);
});

test('keeps newest list per d-tag and sorts by title', () => {
  const lists = parseEvents([
    { kind: 30003, pubkey: 'a'.repeat(64), created_at: 1, tags: [['d', 'x'], ['title', 'Zulu'], ['bookstr-book', 'zulu', 'Zulu Book']] },
    { kind: 30003, pubkey: 'a'.repeat(64), created_at: 4, tags: [['d', 'x'], ['title', 'Alpha'], ['bookstr-book', 'alpha', 'Alpha Book']] },
    { kind: 30003, pubkey: 'a'.repeat(64), created_at: 2, tags: [['d', 'y'], ['title', 'Beta'], ['bookstr-book', 'beta', 'Beta Book']] },
    { kind: 30003, pubkey: 'a'.repeat(64), created_at: 3, tags: [['d', 'y'], ['title', 'Beta'], ['bookstr-book', 'beta-old', 'Should replace Beta']] },
  ]);
  assert.deepEqual(lists.map(list => list.title), ['Alpha', 'Beta']);
});

test('accepts non-array event sources as an empty list', () => {
  assert.deepEqual(parseEvents('not-an-array'), []);
});
