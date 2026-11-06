import { present } from './test-values.mts';
import test from 'node:test';
import assert from 'node:assert/strict';

import { bookMetadata } from './book-metadata-api.mts';
const { sameLibraryBook, dedupeLibraryBooks, availabilityForBook, mergeLibraryState } = bookMetadata;

test('sameLibraryBook preserves query distinctions when no stable IDs exist', () => {
  assert.equal(
    sameLibraryBook(
      { readUrl: 'https://example.test/library/book.epub?download=1#top' },
      { url: 'https://example.test/library/book.epub' },
    ),
    false,
  );
});

test('dedupeLibraryBooks preserves real author when incoming title is placeholder', () => {
  const books = dedupeLibraryBooks([
    {
      md5: 'a'.repeat(32),
      title: 'Primary title',
      author: 'Real author',
      readUrl: 'https://example.test/book.epub',
    },
    {
      md5: 'a'.repeat(32),
      title: 'Untitled book',
      author: 'Ignored author',
      readUrl: 'https://example.test/book.epub?download=1#reader',
    },
  ]);

  assert.equal(books.length, 1);
  assert.equal(present(books[0]).title, 'Primary title');
  assert.equal(present(books[0]).author, 'Real author');
});

test('availabilityForBook keeps cached metadata precedence while ignoring retired Blossom tags', () => {
  assert.equal(
    availabilityForBook(
      {
        md5: 'a'.repeat(32),
        blossomUrl: 'https://blossom.example/book.epub',
        readUrl: 'https://example.test/book.epub',
      },
      true,
    ),
    'Cached',
  );
});

test('mergeLibraryState preserves real title and author while merging placeholder favorite payload', () => {
  const md5 = 'c'.repeat(32);
  const merged = mergeLibraryState(
    [
      {
        md5,
        readUrl: 'https://example.test/guide.epub',
        title: 'First read',
        author: 'Author Name',
        updatedAt: 150,
      },
    ],
    [
      {
        md5,
        title: 'Untitled book',
        author: 'Ignored author',
        favoriteAddedAt: 99,
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(present(merged[0]).title, 'First read');
  assert.equal(present(merged[0]).author, 'Author Name');
  assert.equal(present(merged[0]).isReading, true);
  assert.equal(present(merged[0]).isFavorite, true);
});

test('mergeLibraryState keeps freshest favoriteAddedAt while deduplicating same md5 favorite entries', () => {
  const merged = mergeLibraryState(
    [],
    [
      { md5: 'f'.repeat(32), title: 'Favorite', favoriteAddedAt: 10 },
      { md5: 'f'.repeat(32), title: 'Favorite', favoriteAddedAt: 200 },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(present(merged[0]).favoriteAddedAt, 200);
  assert.equal(present(merged[0]).isFavorite, true);
});
