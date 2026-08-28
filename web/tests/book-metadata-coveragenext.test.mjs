import test from 'node:test';
import assert from 'node:assert/strict';

await import('../book-metadata.js');
const {
  metadataObject,
  canonicalReadUrl,
  canonicalCatalogUrl,
  authorSearchName,
  normalizeFavoriteAddedAt,
  isbnForBook,
  isPlaceholderTitle,
  sortBooks,
  resolveTitle,
  normalizeReadUrl,
  metadataEndpointForReadUrl,
  languageForBook,
  matchesBookFilter,
  yearForBook,
  availabilityForBook,
  availabilitySourcesForBook,
  sameLibraryBook,
  bookIdentity,
  findBookByReadUrl,
  readingProgressForBook,
  mergeLibraryState,
  enrichBookMetadata,
  dedupeLibraryBooks,
  mergeFavoriteEntry,
  earliestFavoriteAddedAt,
  favoriteAddedTag,
} = globalThis.BookMetadata;

test('authorSearchName strips lifespan annotations from bibliographic names', () => {
  assert.equal(authorSearchName('Doyle, Arthur Conan, 1859-1930'), 'Doyle, Arthur Conan');
  assert.equal(authorSearchName('Ursula K. Le Guin (1929–2018)'), 'Ursula K. Le Guin');
});

test('normalizeFavoriteAddedAt converts millisecond timestamps to seconds', () => {
  assert.equal(normalizeFavoriteAddedAt(1_700_000_123_456), 1_700_000_123);
  assert.equal(normalizeFavoriteAddedAt('1700000123'), 1700000123);
});

test('canonicalReadUrl keeps malformed legacy api/read URLs unchanged', () => {
  assert.equal(
    canonicalReadUrl({
      readUrl: 'https://books-api.guaka.org/api/read/' + 'z'.repeat(10),
    }),
    'https://books-api.guaka.org/api/read/' + 'z'.repeat(10),
  );
});

test('canonicalReadUrl preserves a malformed direct Blossom hint', () => {
  assert.equal(
    canonicalReadUrl({
      blossomUrl: 'not-a-valid-url',
      readUrl: 'https://example.test/guide.epub#chapter=2',
    }),
    'not-a-valid-url',
  );
});

test('canonicalCatalogUrl rejects unsupported openlibrary IDs', () => {
  assert.equal(canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: 'not-an-id' }), '');
  assert.equal(canonicalCatalogUrl({ source: 'openlibrary', source_native_id: '  OL321M  ' }), 'https://openlibrary.org/books/OL321M');
});

test('sameLibraryBook requires stable IDs overlap before URL fallback when IDs exist', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), blossomSha256: '1'.repeat(64), readUrl: 'https://example.test/book-a.epub' },
      { md5: 'b'.repeat(32), blossomSha256: '2'.repeat(64), readUrl: 'https://example.test/book-a.epub' },
    ),
    false,
  );
});

test('findBookByReadUrl matches by blossom URL and normalizes query', () => {
  const hit = findBookByReadUrl(
    'https://blossom.example.com/guide.epub?download=1',
    [{ blossomUrl: 'https://blossom.example.com/guide.epub#reader', title: 'Guide' }],
  );

  assert.equal(hit?.title, 'Guide');
});

test('bookIdentity prefers md5 over URL fallback and normalizes URL fallback', () => {
  assert.equal(
    bookIdentity({ md5: 'A'.repeat(32), readUrl: 'https://example.test/fallback.epub#v=1' }),
    `id:${'a'.repeat(32)}`,
  );
  assert.equal(
    bookIdentity({ readUrl: 'https://example.test/fallback.epub?download=1' }),
    'url:https://example.test/fallback.epub?download=1',
  );
});

test('metadataEndpointForReadUrl strips query and accepts API download endpoint', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/download?download=1#reader'),
    'https://books-api.guaka.org/api/books/48320',
  );
});

test('languageForBook normalizes values from metadata object and aliases', () => {
  assert.equal(languageForBook({ language: 'PT' }), 'pt');
  assert.equal(languageForBook({ sourceLanguage: { code: 'ES' } }), 'es');
  assert.equal(languageForBook({ metadata: { language: { id: 'FR' } } }), 'fr');
});

test('yearForBook reads publication year and direct year fields', () => {
  assert.equal(yearForBook({ publicationYear: 2020 }), '2020');
  assert.equal(yearForBook({ year: 1999 }), '1999');
  assert.equal(yearForBook({ metadata: { published: '2019-11-20' } }), '2019');
});

test('sortBooks orders by author and falls back to title for ties', () => {
  const sorted = sortBooks(
    [
      { title: 'A', authors: 'Zed' },
      { title: 'B', author: 'Alpha' },
      { title: 'C' },
    ],
    'author',
  );

  assert.equal(sorted[0].title, 'C');
  assert.equal(sorted[1].title, 'B');
  assert.equal(sorted[2].title, 'A');
});

test('normalizeReadUrl resolves path with base and strips fragment', () => {
  assert.equal(
    normalizeReadUrl('/library/guide.epub#toc', 'https://example.test/shelf/index.html'),
    'https://example.test/library/guide.epub',
  );
});

test('matchesBookFilter matches normalized status tokens', () => {
  const book = {
    title: 'Reader Notes',
    year: '2025',
    readUrl: 'https://example.test/reader-notes.epub',
    favoriteAddedAt: 1_700_000_111,
    isFavorite: true,
  };

  assert.equal(matchesBookFilter(book, 'favorite'), true);
  assert.equal(matchesBookFilter(book, 'cached no'), true);
  assert.equal(matchesBookFilter(book, 'reader notes'), true);
});

test('mergeLibraryState keeps latest reading timestamp and status flags', () => {
  const merged = mergeLibraryState(
    [
      { readUrl: 'https://example.test/book.epub', title: 'Book', updatedAt: 100 },
      { readUrl: 'https://example.test/book.epub', title: 'Latest read', updatedAt: 250 },
    ],
    [{ readUrl: 'https://example.test/book.epub', title: 'Favorite title', favoriteAddedAt: 180 }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Favorite title');
  assert.equal(merged[0].isReading, true);
  assert.equal(merged[0].isFavorite, true);
  assert.equal(merged[0].readingUpdatedAt, 250);
  assert.equal(merged[0].favoriteAddedAt, 180);
});

test('enrichBookMetadata applies replacements without provenance when provenance is blank', () => {
  const merged = enrichBookMetadata(
    { title: 'Untitled book', authors: 'Starter' },
    { title: 'Remote Title', authors: 'Remote Author', extension: 'pdf', source: 'archive' },
    '',
  );

  assert.equal(merged.title, 'Remote Title');
  assert.equal(merged.authors, 'Remote Author');
  assert.equal(merged.extension, 'pdf');
  assert.equal(merged.source, 'archive');
  assert.equal(merged.metadataLookupComplete, true);
  assert.deepEqual(merged.metadataProvenance, {});
});

test('enrichBookMetadata tracks provenance only for filled fields', () => {
  const merged = enrichBookMetadata(
    { title: 'Existing Title', authors: 'Existing Author' },
    { title: 'Untitled book', authors: 'Remote Author', language: 'en', year: 2024 },
    'search-service',
  );

  assert.equal(merged.title, 'Existing Title');
  assert.equal(merged.authors, 'Existing Author');
  assert.equal(merged.year, '2024');
  assert.equal(merged.language, 'en');
  assert.equal(merged.metadataProvenance.title, undefined);
  assert.equal(merged.metadataProvenance.authors, undefined);
  assert.equal(merged.metadataProvenance.year, 'search-service');
  assert.equal(merged.metadataProvenance.language, 'search-service');
});

test('metadataObject handles null and primitive values consistently', () => {
  assert.deepEqual(metadataObject(null), {});
  assert.deepEqual(metadataObject('123'), {});
  assert.deepEqual(metadataObject('{"book":true}'), { book: true });
});

test('metadataObject parses valid object JSON and ignores non-object primitives', () => {
  assert.deepEqual(metadataObject('{\"title\":\"Example\",\"year\":2026}'), { title: 'Example', year: 2026 });
  assert.deepEqual(metadataObject('123'), {});
  assert.deepEqual(metadataObject('\"hello\"'), {});
});

test('readingProgressForBook clamps out-of-range values into 0..1', () => {
  assert.equal(readingProgressForBook({ progress: 1.7 }), 1);
  assert.equal(readingProgressForBook({ progression: -0.5 }), 0);
  assert.equal(readingProgressForBook({ locator: { progression: 0.42 } }), 0.42);
  assert.equal(readingProgressForBook({ progress: NaN }), null);
});

test('normalizeFavoriteAddedAt handles invalid strings and timestamp-like date formats', () => {
  assert.equal(normalizeFavoriteAddedAt('not-a-date'), 0);
  assert.equal(normalizeFavoriteAddedAt('2026-01-01T00:00:00Z'), Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000));
});

test('earliestFavoriteAddedAt returns the minimum valid timestamp', () => {
  assert.equal(earliestFavoriteAddedAt(null, '1700000000', '1700001000'), 1700000000);
  assert.equal(earliestFavoriteAddedAt('invalid', '', NaN), 0);
});

test('favoriteAddedTag includes only normalized md5 with positive timestamp', () => {
  assert.deepEqual(favoriteAddedTag('A'.repeat(32), 1700000000), ['libvault-added', 'a'.repeat(32), '1700000000']);
  assert.equal(favoriteAddedTag('bad', 1700000000), null);
  assert.equal(favoriteAddedTag('a'.repeat(32), 'not-a-timestamp'), null);
});

test('availabilitySourcesForBook recognizes gutenberg sources and cached flag', () => {
  assert.deepEqual(availabilitySourcesForBook({ md5: 'gutenberg:123', readUrl: 'https://books-api.guaka.org/api/books/123/download' }, false), ['Gutenberg']);
  assert.deepEqual(availabilitySourcesForBook({ readUrl: 'https://example.test/reader.epub' }, true), ['Metadata only', 'Cached']);
});

test('availabilityForBook prefers "Cached" when both cached and metadata-only exist', () => {
  assert.equal(availabilityForBook({ source: 'manual', readUrl: 'https://example.test' }, true), 'Cached');
});

test('sameLibraryBook falls back to ISBN match when no stable identifiers or URLs exist', () => {
  assert.equal(
    sameLibraryBook(
      { isbn: '978-1-4028-9462-6' },
      { identifiers: [{ type: 'isbn13', value: '9781402894626' }] },
    ),
    true,
  );
  assert.equal(sameLibraryBook({ isbn: '978-111' }, { source: 'openlibrary' }), false);
});

test('dedupeLibraryBooks keeps newest titles and merges reading flags', () => {
  const merged = dedupeLibraryBooks([
    { md5: 'd1'.padEnd(32, '0'), title: 'First', authors: 'Old', isReading: true, readUrl: 'https://example.test/one.epub', updatedAt: 100 },
    { md5: 'd1'.padEnd(32, '0'), title: 'Untitled book', authors: 'New', isFavorite: true, updatedAt: 200 },
    { md5: 'd2'.padEnd(32, '0'), title: 'Second', readUrl: 'https://example.test/two.epub' },
  ]);

  assert.equal(merged.length, 2);
  const first = merged.find(book => book.md5 === 'd1000000000000000000000000000000');
  const second = merged.find(book => book.md5 === 'd2'.padEnd(32, '0'));
  assert.equal(first?.title, 'First');
  assert.equal(first?.isReading, true);
  assert.equal(first?.isFavorite, true);
  assert.equal(second?.title, 'Second');
});

test('mergeFavoriteEntry keeps earliest favorite timestamp and replaces placeholder title', () => {
  const entries = [];
  const first = mergeFavoriteEntry(entries, {
    md5: 'f'.repeat(32),
    title: 'Untitled book',
    author: 'Known Author',
    favoriteAddedAt: 100,
  });
  const merged = mergeFavoriteEntry(entries, {
    md5: 'f'.repeat(32),
    title: 'Remote Title',
    authors: 'Remote Author',
    favoriteAddedAt: 200,
  });

  assert.equal(entries.length, 1);
  assert.equal(first.title, 'Remote Title');
  assert.equal(merged.title, 'Remote Title');
  assert.equal(merged.author, 'Known Author');
  assert.equal(merged.authors, 'Remote Author');
  assert.equal(merged.favoriteAddedAt, 100);
});
