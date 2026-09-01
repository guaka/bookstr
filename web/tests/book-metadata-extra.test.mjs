import test from 'node:test';
import assert from 'node:assert/strict';

await import('../book-metadata.js');
const {
  metadataObject,
  canonicalReadUrl,
  canonicalCatalogUrl,
  metadataEndpointForReadUrl,
  enrichBookMetadata,
  normalizeFavoriteAddedAt,
  normalizeReadUrl,
  mergeFavoriteEntry,
  languageForBook,
  dedupeLibraryBooks,
  findBookByReadUrl,
  availabilitySourcesForBook,
  availabilityForBook,
  isbnForBook,
  isPlaceholderTitle,
  bookIdentity,
  sameLibraryBook,
  favoriteAddedTag,
  readingProgressForBook,
  authorSearchName,
  sortBooks,
} = globalThis.BookMetadata;

test('metadataObject parses valid JSON objects and ignores primitive JSON payloads', () => {
  assert.deepEqual(metadataObject('{"source":"openlibrary"}'), { source: 'openlibrary' });
  assert.deepEqual(metadataObject('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(metadataObject('123'), {});
  assert.deepEqual(metadataObject('true'), {});
  assert.deepEqual(metadataObject({ source: 'cache' }), { source: 'cache' });
  assert.deepEqual(metadataObject(undefined), {});
});

test('authorSearchName removes publication year annotations in different formats', () => {
  assert.equal(authorSearchName('Doyle, Arthur Conan, 1859-1930'), 'Doyle, Arthur Conan');
  assert.equal(authorSearchName('Ursula K. Le Guin (1929–2018)'), 'Ursula K. Le Guin');
  assert.equal(authorSearchName('Taleb, Nassim Nicholas, born 1970-'), 'Taleb, Nassim Nicholas');
});

test('languageForBook normalizes nested language object values', () => {
  assert.equal(
    languageForBook({ language: { code: 'PT' }, metadata: {} }),
    'pt',
  );
  assert.equal(
    languageForBook({ languages: [{ code: 'ES' }, { code: 'EN' }] }),
    'es',
  );
});

test('isbnForBook supports ISBN-10 values with X checksum and identifiers', () => {
  assert.equal(isbnForBook({ isbn10: '0-7475-3269-X' }), '074753269X');
  assert.equal(isbnForBook({ identifiers: [{ type: 'isbn', value: '978-0-00-000000-1' }] }), '9780000000001');
});

test('mergeFavoriteEntry keeps existing title when incoming title is placeholder only', () => {
  const entries = [];
  mergeFavoriteEntry(entries, { md5: 'A'.repeat(32), title: 'Real title', format: 'epub' });
  mergeFavoriteEntry(entries, {
    md5: 'a'.repeat(32),
    title: 'Untitled book',
    format: 'pdf',
    favoriteAddedAt: 200,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'Real title');
  assert.equal(entries[0].format, 'pdf');
  assert.equal(entries[0].favoriteAddedAt, 200);
});

test('bookIdentity uses source_native_id alias when source id is provided', () => {
  const id = bookIdentity({
    source: 'gutenberg',
    source_native_id: '30142',
  });

  assert.equal(id, 'source:gutenberg:30142');
});

test('sameLibraryBook ignores URL collision when stable IDs disagree', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), readUrl: 'https://example.test/shared.epub' },
      { md5: 'b'.repeat(32), url: 'https://example.test/shared.epub' },
    ),
    false,
  );
});

test('availabilitySourcesForBook recognizes Gutenberg by md5 pattern without explicit source', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ md5: 'gutenberg:30142' }),
    ['Gutenberg'],
  );
});

test('availabilitySourcesForBook keeps cached in addition to metadata-only source', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ title: 'Offline fallback', source: 'libvault', readUrl: 'https://example.test/book.epub' }, true),
    ['Metadata only', 'Cached'],
  );
});

test('canonicalReadUrl uses source-native Gutenberg id even when another URL is present', () => {
  assert.equal(
    canonicalReadUrl({
      source: 'gutenberg',
      sourceNativeId: '30142',
      readUrl: 'https://example.test/legacy.epub',
    }, 'https://proxy.example/api'),
    'https://proxy.example/api/books/30142/download',
  );
});

test('normalizeFavoriteAddedAt returns 0 for empty strings before date parse', () => {
  assert.equal(normalizeFavoriteAddedAt(''), 0);
  assert.equal(normalizeFavoriteAddedAt('not-a-date'), 0);
});

test('normalizeReadUrl returns non-http URLs unchanged without base resolution', () => {
  assert.equal(normalizeReadUrl('ftp://example.test/file.epub'), 'ftp://example.test/file.epub');
});

test('mergeFavoriteEntry picks the earliest addedAt across mixed timestamp formats', () => {
  const entries = [];
  mergeFavoriteEntry(entries, { md5: 'A'.repeat(32), title: 'First', favoriteAddedAt: 1_700_000_020 });
  mergeFavoriteEntry(entries, { md5: 'a'.repeat(32), favoriteAddedAt: '2022-01-01T00:00:00Z', title: 'Second' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].favoriteAddedAt, 1_640_995_200);
});

test('enrichBookMetadata keeps an existing read URL when incoming metadata has no usable read URL', () => {
  const merged = enrichBookMetadata(
    { readUrl: 'https://existing.example/book.epub', title: 'Base title' },
    { source: 'gutenberg', sourceNativeId: '30142', readUrl: 'not-a-url', title: 'Remote title' },
    'source-search',
  );

  assert.equal(merged.readUrl, 'https://existing.example/book.epub');
  assert.equal(merged.title, 'Base title');
});

test('availabilitySourcesForBook deduplicates supported source hints and ignores retired Blossom metadata', () => {
  assert.deepEqual(
    availabilitySourcesForBook({
      readUrl: 'https://books-api.guaka.org/api/books/48320/download?download=1',
      source: 'gutenberg',
      blossomSha256: 'abc',
      blossomUrl: 'https://blossom.example/file.epub',
    }),
    ['Gutenberg'],
  );
});

test('availabilitySourcesForBook recognizes gutenberg from source hint alone', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'gutenberg' }),
    ['Gutenberg'],
  );
});

test('findBookByReadUrl prefers the url field only when readUrl is unavailable', () => {
  const hit = findBookByReadUrl(
    'https://example.test/shared.epub',
    [{ title: 'Fallback', url: 'https://example.test/shared.epub?download=1#reader' }],
  );

  assert.equal(hit?.title, 'Fallback');
});

test('favoriteAddedTag converts ISO timestamps to libvault-added arrays', () => {
  assert.deepEqual(
    favoriteAddedTag('A'.repeat(32), '2023-11-14T22:13:20Z'),
    ['libvault-added', 'a'.repeat(32), '1700000000'],
  );
});

test('readingProgressForBook clamps out-of-range and ignores impossible payloads', () => {
  assert.equal(readingProgressForBook({ progression: 1.5 }), 1);
  assert.equal(readingProgressForBook({ progression: -0.1 }), 0);
  assert.equal(readingProgressForBook({ progression: 'n/a' }), null);
});

test('isPlaceholderTitle identifies empty and synthetic catalog strings', () => {
  assert.equal(isPlaceholderTitle(''), true);
  assert.equal(isPlaceholderTitle('LibVault favorite'), true);
  assert.equal(isPlaceholderTitle('A7f2b3c1d9e4'), true);
  assert.equal(isPlaceholderTitle('A Real Title'), false);
});

test('sameLibraryBook compares normalized IDs before URL', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'A'.repeat(32), url: 'https://example.test/other.epub' },
      { id: 'a'.repeat(32), readUrl: 'https://example.test/book.epub' },
    ),
    true,
  );
  assert.equal(
    sameLibraryBook(
      { md5: 'A'.repeat(32), url: 'https://example.test/book.epub' },
      { id: 'b'.repeat(32), readUrl: 'https://example.test/book.epub' },
    ),
    false,
  );
});

test('bookIdentity falls back to read URL only when no stable IDs exist', () => {
  assert.equal(
    bookIdentity({ readUrl: 'https://example.test/book.epub#page=3' }),
    `url:https://example.test/book.epub`,
  );
  assert.equal(
    bookIdentity({ title: 'Untitled book' }),
    'title:untitled book:::',
  );
});

test('canonicalReadUrl returns malformed URLs unchanged when they cannot be parsed', () => {
  assert.equal(canonicalReadUrl({ readUrl: 'not a url' }), 'not a url');
});

test('metadataEndpointForReadUrl handles plain download endpoint without trailing path params', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/download'),
    'https://books-api.guaka.org/api/books/48320',
  );
});

test('metadataEndpointForReadUrl strips query and hash while preserving custom ports', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org:8443/api/books/48320/download?download=1#top'),
    'https://books-api.guaka.org:8443/api/books/48320',
  );
});

test('readingProgressForBook prefers locator.furthestProgression when raw progression missing', () => {
  assert.equal(readingProgressForBook({ locator: { progression: 0.75 } }), 0.75);
});

test('favoriteAddedTag ignores invalid IDs and zero timestamps', () => {
  assert.equal(favoriteAddedTag('invalid-md5', '1700000000'), null);
  assert.equal(favoriteAddedTag('a'.repeat(32), 0), null);
});

test('readingProgressForBook accepts numeric strings and applies clamping', () => {
  assert.equal(readingProgressForBook({ progress: '0.88' }), 0.88);
  assert.equal(readingProgressForBook({ progress: '1.5' }), 1);
  assert.equal(readingProgressForBook({ furthestProgression: '-0.2' }), 0);
});

test('metadataEndpointForReadUrl rejects non-numeric IDs even when download is present', () => {
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/abc/download'), '');
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/abc123/download?download=1'), '');
});

test('normalizeReadUrl keeps query string while dropping fragment', () => {
  assert.equal(
    normalizeReadUrl('https://example.test/book.epub?download=1#reader'),
    'https://example.test/book.epub?download=1',
  );
});

test('normalizeReadUrl resolves relative paths against provided base URL', () => {
  assert.equal(
    normalizeReadUrl('book.epub', 'https://library.example.com/shelf/'),
    'https://library.example.com/shelf/book.epub',
  );
  assert.equal(
    normalizeReadUrl('/read/book.epub#top', 'https://library.example.com/'),
    'https://library.example.com/read/book.epub',
  );
});

test('sortBooks falls back to title tie-breaker when language values are unavailable', () => {
  const sorted = sortBooks(
    [{ title: 'Zulu', language: 'zz' }, { title: 'Alpha', language: 'aa' }, { title: 'Beta' }],
    'language',
  );

  assert.equal(sorted[0].title, 'Beta');
  assert.equal(sorted[1].title, 'Alpha');
  assert.equal(sorted[2].title, 'Zulu');
});

test('sameLibraryBook favors stable IDs over URL collisions', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), readUrl: 'https://example.test/shared.epub' },
      { id: 'b'.repeat(32), readUrl: 'https://example.test/shared.epub' },
    ),
    false,
  );
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), readUrl: 'https://example.test/shared.epub' },
      { md5: 'a'.repeat(32), readUrl: 'https://example.test/another.epub' },
    ),
    true,
  );
});

test('bookIdentity returns URL fallback only after stable IDs are missing', () => {
  const md5 = 'A'.repeat(32);
  assert.equal(
    bookIdentity({ md5, readUrl: 'https://example.test/base?query=1' }),
    `id:${'a'.repeat(32)}`,
  );
  assert.equal(
    bookIdentity({ readUrl: 'https://example.test/base?query=1' }),
    'url:https://example.test/base?query=1',
  );
});

test('findBookByReadUrl normalizes query and fragment before matching across collections', () => {
  const reading = [
    { title: 'Reading', readUrl: 'https://library.example.com/book.epub?download=1' },
  ];
  const favorites = [
    { title: 'Saved', url: 'https://example.test/other.epub' },
  ];

  assert.equal(
    findBookByReadUrl('https://library.example.com/book.epub#page-3', reading, favorites)?.title,
    'Reading',
  );
});

test('canonicalReadUrl ignores /api/read locator URLs for fallback', () => {
  assert.equal(
    canonicalReadUrl({ readUrl: 'https://lib.b.bfr.ee/api/read/f4a1c5d2f8b0d9d3e8e7f6a5b4c3d2e1' }),
    '',
  );
});

test('sameLibraryBook matches by blossomSha256 when stable ids are absent', () => {
  assert.equal(
    sameLibraryBook(
      { blossomSha256: 'a'.repeat(64) },
      { id: 'x', title: 'Reader copy', blossomSha256: 'a'.repeat(64) },
    ),
    true,
  );
});

test('findBookByReadUrl matches by URL field when read URL is absent', () => {
  assert.equal(
    findBookByReadUrl(
      'https://example.test/favorites.epub',
      [{ url: 'https://example.test/favorites.epub?download=1#reader' }],
    )?.url,
    'https://example.test/favorites.epub?download=1#reader',
  );
});

test('canonicalCatalogUrl converts openlibrary ids for work and edition forms', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: 'OL12345W' }),
    'https://openlibrary.org/works/OL12345W',
  );
  assert.equal(
    canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: '67890' }),
    'https://openlibrary.org/works/OL67890W',
  );
});

test('canonicalCatalogUrl returns empty string for non-openlibrary catalog ids', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'gutenberg', sourceNativeId: 'OL12345W' }),
    '',
  );
});

test('dedupeLibraryBooks keeps the stronger title from incoming non-placeholder', () => {
  const books = dedupeLibraryBooks([
    { md5: 'a'.repeat(32), title: 'Untitled book', readUrl: 'https://library.example.com/book.epub' },
    { md5: 'a'.repeat(32), title: 'Real title', readUrl: 'https://library.example.com/book.epub', favoriteAddedAt: 99 },
  ]);

  assert.equal(books.length, 1);
  assert.equal(books[0].title, 'Real title');
  assert.equal(books[0].favoriteAddedAt, 99);
});

test('normalizeFavoriteAddedAt trims numeric values and rejects padded dates', () => {
  assert.equal(normalizeFavoriteAddedAt(' 1700000000 '), 1700000000);
  assert.equal(normalizeFavoriteAddedAt(' 2023-11-14T22:13:20Z\n'), 0);
});

test('canonicalCatalogUrl trims whitespace in openlibrary source native IDs', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: '  OL999W  ' }),
    'https://openlibrary.org/works/OL999W',
  );
});

test('metadataEndpointForReadUrl returns empty for relative URLs', () => {
  assert.equal(metadataEndpointForReadUrl('/api/books/48320/download?download=1'), '');
});

test('availabilitySourcesForBook treats legacy read URLs as metadata-only', () => {
  assert.deepEqual(
    availabilitySourcesForBook({
      source: 'libvault',
      readUrl: 'https://books-api.guaka.org/api/read/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }),
    ['Metadata only'],
  );

  assert.deepEqual(
    availabilitySourcesForBook({
      source: 'libvault',
      readUrl: 'https://books-api.guaka.org/api/read/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }, true),
    ['Metadata only', 'Cached'],
  );
});

test('metadataEndpointForReadUrl rejects non-lowercase download suffix', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/DOWNLOAD?download=1'),
    '',
  );
});

test('availabilitySourcesForBook treats explicit retired Blossom markers as metadata only', () => {
  assert.deepEqual(
    availabilitySourcesForBook({
      source: 'blossom-cdn',
      readUrl: 'https://lib.b.bfr.ee/api/read/f123',
      blossomSha256: 'abc',
    }),
    ['Metadata only'],
  );
});

test('availabilityForBook uses cached label when metadata-only book is cached', () => {
  assert.equal(
    availabilityForBook(
      { readUrl: 'https://example.test/favorites/48320.epub' },
      true,
    ),
    'Cached',
  );
});

test('metadataEndpointForReadUrl ignores non-matching host path but accepts valid id path shape', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://other.example/api/books/111/download?download=1'),
    'https://other.example/api/books/111',
  );
});

test('metadataEndpointForReadUrl normalizes download endpoint with trailing slash', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/download/'),
    'https://books-api.guaka.org/api/books/48320',
  );
});

test('availabilitySourcesForBook infers Gutenberg source from source label only', () => {
  assert.deepEqual(
    availabilitySourcesForBook({
      source: 'Gutenberg',
      readUrl: 'https://example.test/read/30142',
      md5: 'bad',
    }),
    ['Gutenberg'],
  );
});

test('canonicalCatalogUrl supports source_native_id snake_case input', () => {
  assert.equal(
    canonicalCatalogUrl({
      source: 'openlibrary',
      source_native_id: '  OL321M  ',
    }),
    'https://openlibrary.org/books/OL321M',
  );
});

test('dedupeLibraryBooks keeps earlier strong title and title metadata when incoming metadata is placeholder-only', () => {
  const merged = dedupeLibraryBooks([
    { md5: 'b'.repeat(32), title: 'Primary Title', readUrl: 'https://example.test/known.epub' },
    { md5: 'b'.repeat(32), title: 'Untitled book', author: 'Another' },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Primary Title');
  assert.equal(merged[0].author || merged[0].authors, 'Another');
});

test('sameLibraryBook requires both values to share a stable key when both carry identifiers', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'c'.repeat(32), readUrl: 'https://example.test/one.epub', id: 'local-1' },
      { md5: 'd'.repeat(32), readUrl: 'https://example.test/one.epub', id: 'local-2' },
    ),
    false,
  );
});

test('metadataObject ignores non-object JSON string values', () => {
  assert.deepEqual(
    metadataObject('123'),
    {},
  );
  assert.deepEqual(
    metadataObject('false'),
    {},
  );
});
