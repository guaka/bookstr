import test from 'node:test';
import assert from 'node:assert/strict';

await import('../book-metadata.js');
const { dedupeLibraryBooks } = globalThis.BookMetadata;

test('dedupeLibraryBooks prefers real titles and preserves existing author metadata', () => {
  const md5 = 'a'.repeat(32);
  const [book] = dedupeLibraryBooks([
    {
      md5,
      title: 'Known Title',
      author: 'Known author',
      readUrl: 'https://example.test/book.epub',
      favoriteAddedAt: 10,
    },
    {
      md5,
      title: 'Untitled book',
      author: 'Placeholder author',
      readUrl: 'https://example.test/book.epub',
    },
  ]);

  assert.equal(book.md5, md5);
  assert.equal(book.title, 'Known Title');
  assert.equal(book.author, 'Known author');
});

test('dedupeLibraryBooks keeps the latest favoriteAddedAt across matching entries', () => {
  const md5 = 'b'.repeat(32);
  const books = dedupeLibraryBooks([
    {
      md5,
      title: 'First pass',
      readUrl: 'https://example.test/book.epub',
      favoriteAddedAt: 10,
    },
    {
      md5,
      title: 'Second pass',
      readUrl: 'https://example.test/book.epub',
      favoriteAddedAt: 100,
    },
  ]);

  assert.equal(books.length, 1);
  assert.equal(books[0].favoriteAddedAt, 100);
});
