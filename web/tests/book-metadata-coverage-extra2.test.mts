import { present } from './test-values.mts';
import test from 'node:test';
import assert from 'node:assert/strict';

import { bookMetadata } from './book-metadata-api.mts';
const { dedupeLibraryBooks } = bookMetadata;

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

  assert.equal(present(book).md5, md5);
  assert.equal(present(book).title, 'Known Title');
  assert.equal(present(book).author, 'Known author');
});

test('dedupeLibraryBooks keeps the earliest favoriteAddedAt across matching entries', () => {
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
  assert.equal(present(books[0]).favoriteAddedAt, 10);
});
