import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public-lists.js');

const { parseEvent, parseEvents } = globalThis.BookstrPublicLists;

function listEvent({ d = 'hitchwiki-books', title = 'Hitchwiki Books', createdAt = 10 } = {}) {
  return {
    kind: 30003,
    pubkey: 'a'.repeat(64),
    created_at: createdAt,
    tags: [
      ['d', d],
      ['title', title],
      ['description', 'A public reading list'],
      ['book', 'bookstr', 'books.hitchwiki.org:geldloos', '10', 'https://books.hitchwiki.org/downloads/geldloos-0.1.epub'],
      ['bookstr-book', 'books.hitchwiki.org:geldloos', 'Geldloos', 'Hitchwiki contributors', 'epub', '0', '', '', 'nl', 'books.hitchwiki.org'],
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

test('keeps the newest event for each public list and excludes private collections', () => {
  const lists = parseEvents([
    listEvent({ title: 'Old title', createdAt: 1 }),
    listEvent({ title: 'Hitchwiki Books', createdAt: 2 }),
    listEvent({ d: 'libvault-favorites', title: 'Favorites', createdAt: 3 }),
    listEvent({ d: 'bookstr-collection-secret', title: 'Private', createdAt: 4 }),
  ]);
  assert.deepEqual(lists.map(list => list.title), ['Hitchwiki Books']);
});
