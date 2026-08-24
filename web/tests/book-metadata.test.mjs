import test from 'node:test';
import assert from 'node:assert/strict';

await import('../book-metadata.js');
const {
  isPlaceholderTitle,
  resolveTitle,
  languageForBook,
  yearForBook,
  authorSearchName,
  readingProgressForBook,
  normalizeFavoriteAddedAt,
  earliestFavoriteAddedAt,
  favoriteAddedTag,
  mergeFavoriteEntry,
  normalizeReadUrl,
  findBookByReadUrl,
  metadataEndpointForReadUrl,
  canonicalReadUrl,
  canonicalCatalogUrl,
  bookIdentity,
  availabilityForBook,
  availabilitySourcesForBook,
  sortBooks,
  dedupeLibraryBooks,
  matchesBookFilter,
  sameLibraryBook,
  mergeLibraryState,
  enrichBookMetadata,
  isbnForBook,
} = globalThis.BookMetadata;

test('normalizes and preserves the earliest favorite addition time', () => {
  assert.equal(normalizeFavoriteAddedAt(1_700_000_000_123), 1_700_000_000);
  assert.equal(normalizeFavoriteAddedAt('2023-11-14T22:13:20Z'), 1_700_000_000);
  assert.equal(earliestFavoriteAddedAt(1_700_000_100, 1_700_000_000), 1_700_000_000);
  assert.deepEqual(
    favoriteAddedTag('A'.repeat(32), 1_700_000_000),
    ['libvault-added', 'a'.repeat(32), '1700000000'],
  );
});

test('resolves titles from APK and nested metadata field variants', () => {
  assert.equal(resolveTitle({ bookTitle: 'A Cidade e as Serras' }), 'A Cidade e as Serras');
  assert.equal(resolveTitle({ metadata: { title: 'Os Maias' } }), 'Os Maias');
  assert.equal(resolveTitle({ metadata: JSON.stringify({ name: 'Mensagem' }) }), 'Mensagem');
});

test('preserves common language metadata shapes', () => {
  assert.equal(languageForBook({ language: 'PT' }), 'pt');
  assert.equal(languageForBook({ languages: ['nl', 'en'] }), 'nl');
  assert.equal(languageForBook({ metadata: { language: { code: 'DE' } } }), 'de');
  assert.equal(languageForBook({ metadata: JSON.stringify({ lang: 'fr' }) }), 'fr');
});

test('extracts years from common publication metadata', () => {
  assert.equal(yearForBook({ issued: '2009-09-30' }), '2009');
  assert.equal(yearForBook({ metadata: { publicationYear: 1984 } }), '1984');
  assert.equal(yearForBook({}), '');
});

test('author searches exclude birth and death years', () => {
  assert.equal(authorSearchName('Doyle, Arthur Conan, 1859-1930'), 'Doyle, Arthur Conan');
  assert.equal(authorSearchName('Taleb, Nassim Nicholas, 1960-'), 'Taleb, Nassim Nicholas');
  assert.equal(authorSearchName('Ursula K. Le Guin (1929–2018)'), 'Ursula K. Le Guin');
  assert.equal(authorSearchName('Author, Example, born 1970-'), 'Author, Example');
});

test('normalizes saved reading progress', () => {
  assert.equal(readingProgressForBook({ progression: 0.42 }), 0.42);
  assert.equal(readingProgressForBook({ locator: { progression: 0.65 } }), 0.65);
  assert.equal(readingProgressForBook({ progression: 3 }), 1);
  assert.equal(readingProgressForBook({ progression: -1 }), 0);
  assert.equal(readingProgressForBook({ progression: 'unknown' }), null);
});

test('rejects placeholders and derives a useful filename title', () => {
  assert.equal(isPlaceholderTitle('Untitled book'), true);
  assert.equal(resolveTitle({ title: 'LibVault favorite', readUrl: 'https://example.test/A-Relíquia.epub' }), 'A Relíquia');
});

test('merges repeated favorite tags without losing the real title', () => {
  const entries = [];
  mergeFavoriteEntry(entries, { md5: 'A'.repeat(32), title: 'Untitled book', url: 'https://example.test/book.epub', favoriteAddedAt: 1_700_000_100 });
  mergeFavoriteEntry(entries, { md5: 'a'.repeat(32), title: 'Ensaio sobre a Cegueira', author: 'José Saramago', favoriteAddedAt: 1_700_000_000 });
  mergeFavoriteEntry(entries, { md5: 'a'.repeat(32), title: '', format: 'epub' });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'Ensaio sobre a Cegueira');
  assert.equal(entries[0].author, 'José Saramago');
  assert.equal(entries[0].format, 'epub');
  assert.equal(entries[0].favoriteAddedAt, 1_700_000_000);
});

test('finds reading metadata by readUrl, url, or Blossom URL', () => {
  const reading = [{ title: 'Scale', readUrl: 'https://books-api.guaka.org/api/books/48320/download' }];
  const favorites = [{ title: 'Other', blossomUrl: 'https://blossom.example/abc.epub' }];
  assert.equal(findBookByReadUrl('https://books-api.guaka.org/api/books/48320/download', reading, favorites)?.title, 'Scale');
  assert.equal(findBookByReadUrl('https://blossom.example/abc.epub', reading, favorites)?.title, 'Other');
});

test('normalizes away URL fragments when matching cached books', () => {
  assert.equal(
    normalizeReadUrl('https://example.test/book.epub#chapter-2'),
    'https://example.test/book.epub',
  );
});

test('derives the metadata endpoint from a Gutenberg download route', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/download?download=1'),
    'https://books-api.guaka.org/api/books/48320',
  );
});

test('uses a Gutenberg ID instead of a stale URL from another book', () => {
  assert.equal(
    canonicalReadUrl({
      md5: 'gutenberg:30142',
      title: 'Little Brother',
      readUrl: 'https://books-api.guaka.org/api/books/48320/download',
    }),
    'https://books-api.guaka.org/api/books/30142/download',
  );
});

test('derives Gutenberg downloads from source-native IDs', () => {
  assert.equal(
    canonicalReadUrl({ source: 'gutenberg', sourceNativeId: '30142' }, 'https://proxy.test/api/'),
    'https://proxy.test/api/books/30142/download',
  );
});

test('leaves non-Gutenberg Blossom URLs unchanged', () => {
  assert.equal(
    canonicalReadUrl({ blossomUrl: 'https://blossom.test/file.epub' }),
    'https://blossom.test/file.epub',
  );
});

test('prefers Blossom over a LibVault read endpoint', () => {
  assert.equal(canonicalReadUrl({
    md5: 'a'.repeat(32),
    readUrl: 'https://lib.b.bfr.ee/api/read/' + 'a'.repeat(32),
    blossomUrl: 'https://blossom.example/' + 'b'.repeat(64),
  }), 'https://blossom.example/' + 'b'.repeat(64));
});

test('never uses a legacy LibVault read endpoint as a book source', () => {
  assert.equal(canonicalReadUrl({
    md5: 'a'.repeat(32),
    readUrl: 'https://lib.b.bfr.ee/api/read/' + 'a'.repeat(32),
  }), '');
  assert.equal(availabilityForBook({ md5: 'a'.repeat(32), source: 'libvault' }), 'Metadata only');
});

test('allows an immediately readable cached LibVault file while Blossom publishes', () => {
  const url = 'https://lib.b.bfr.ee/api/files/' + 'a'.repeat(32);
  assert.equal(canonicalReadUrl({ md5: 'a'.repeat(32), readUrl: url }), url);
});

test('builds stable identities for books without MD5 hashes', () => {
  assert.equal(bookIdentity({ source: 'gutenberg', sourceNativeId: 34527 }), 'source:gutenberg:34527');
  assert.equal(bookIdentity({ blossomSha256: 'A'.repeat(64) }), `sha256:${'a'.repeat(64)}`);
  assert.equal(bookIdentity({ isbn: '978-1-2345-6789-0' }), 'isbn:9781234567890');
  assert.equal(
    bookIdentity({ title: 'A Book', authors: 'An Author', year: 2024, language: 'pt' }),
    'title:a book:an author:2024:pt',
  );
});

test('builds canonical Open Library work and edition links', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: '16795887' }),
    'https://openlibrary.org/works/OL16795887W',
  );
  assert.equal(
    canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: 'OL123M' }),
    'https://openlibrary.org/books/OL123M',
  );
  assert.equal(canonicalCatalogUrl({ source: 'gutenberg', sourceNativeId: '34527' }), '');
});

test('does not invent metadata endpoints for arbitrary EPUB URLs', () => {
  assert.equal(metadataEndpointForReadUrl('https://example.test/books/scale.epub'), '');
});

test('classifies supported book availability sources', () => {
  assert.equal(availabilityForBook({ blossomSha256: 'abc' }), 'Blossom');
  assert.equal(availabilityForBook({ readUrl: 'https://books-api.guaka.org/api/books/48320/download' }), 'Gutenberg');
  assert.equal(availabilityForBook({ md5: 'a'.repeat(32) }), 'Metadata only');
  assert.equal(availabilityForBook({ readUrl: 'https://example.test/book.epub' }), 'Metadata only');
});

test('reports multiple availability sources including cache', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ md5: 'a'.repeat(32), blossomUrl: 'https://blossom.test/a' }, true),
    ['Blossom', 'Cached'],
  );
});

test('sorts books by text and year without mutating the source list', () => {
  const books = [
    { title: 'Zulu', authors: 'Ana', year: '2024' },
    { title: 'Alpha', authors: 'Zeca', year: '1998' },
  ];
  assert.deepEqual(sortBooks(books, 'title').map(book => book.title), ['Alpha', 'Zulu']);
  assert.deepEqual(sortBooks(books, 'author').map(book => book.title), ['Zulu', 'Alpha']);
  assert.deepEqual(sortBooks(books, 'year', 'desc').map(book => book.title), ['Zulu', 'Alpha']);
  assert.deepEqual(books.map(book => book.title), ['Zulu', 'Alpha']);
});

test('sorts availability and cached state', () => {
  const books = [
    { title: 'Local', md5: 'a'.repeat(32) },
    { title: 'Remote', readUrl: 'https://example.test/remote.epub' },
  ];
  assert.deepEqual(sortBooks(books, 'availability').map(book => book.title), ['Local', 'Remote']);
  assert.deepEqual(sortBooks(books, 'cached', 'desc', book => book.title === 'Remote').map(book => book.title), ['Remote', 'Local']);
});

test('sorts case-insensitively and handles missing metadata', () => {
  const books = [{ title: 'zebra' }, { title: 'Árvore' }, { title: 'Alpha' }, {}];
  const sorted = sortBooks(books, 'title').map(book => book.title || '');
  assert.equal(sorted[0], '');
  assert.equal(sorted.at(-1), 'zebra');
});

test('filters across every visible Home table column', () => {
  const book = {
    title: 'Os Maias',
    authors: 'Eça de Queirós',
    year: '1888',
    source: 'gutenberg',
    extension: 'epub',
    language: 'pt',
  };
  for (const query of ['Maias', 'Queirós', '1888', 'Gutenberg', 'EPUB', 'PT', 'cached yes']) {
    assert.equal(matchesBookFilter(book, query, () => true), true, query);
  }
  assert.equal(matchesBookFilter(book, 'cached no', () => true), false);
});

test('requires every term in a multi-column filter', () => {
  const book = { title: 'Little Brother', authors: 'Cory Doctorow', year: '2009', language: 'en' };
  assert.equal(matchesBookFilter(book, 'doctorow 2009 en'), true);
  assert.equal(matchesBookFilter(book, 'doctorow 2008'), false);
});

test('deduplicates stale Untitled rows and preserves the real metadata', () => {
  const md5 = 'c'.repeat(32);
  const books = dedupeLibraryBooks([
    { md5, title: 'Untitled book', authors: '', readUrl: 'https://example.test/book.epub' },
    { md5, bookTitle: 'Aparição', authors: 'Vergílio Ferreira', year: '1959' },
    { md5, title: 'LibVault favorite', authors: 'Wrong placeholder author', language: 'pt' },
  ]);
  assert.equal(books.length, 1);
  assert.equal(books[0].title, 'Aparição');
  assert.equal(books[0].authors, 'Vergílio Ferreira');
  assert.equal(books[0].year, '1959');
  assert.equal(books[0].language, 'pt');
});

test('does not truncate libraries larger than fifty books', () => {
  const books = Array.from({ length: 75 }, (_, index) => ({
    md5: index.toString(16).padStart(32, '0'),
    title: `Book ${index}`,
  }));
  assert.equal(dedupeLibraryBooks(books).length, 75);
});

test('does not merge different IDs merely because titles match', () => {
  const books = dedupeLibraryBooks([
    { md5: '1'.repeat(32), title: 'Little Brother', authors: 'Cory Doctorow' },
    { md5: '2'.repeat(32), title: 'Little Brother', authors: 'Cory Doctorow' },
  ]);
  assert.equal(books.length, 2);
});

test('different stable IDs never merge through a shared URL or ISBN', () => {
  const sharedUrl = 'https://lib.b.bfr.ee/#search?favorites=1';
  const books = dedupeLibraryBooks([
    { md5: '1'.repeat(32), title: 'First edition', readUrl: sharedUrl, isbn: '9781234567890' },
    { md5: '2'.repeat(32), title: 'Second edition', readUrl: sharedUrl, isbn: '9781234567890' },
  ]);
  assert.equal(books.length, 2);
});

test('keeps a known read URL when a partial duplicate omits it', () => {
  const md5 = 'd'.repeat(32);
  const [book] = dedupeLibraryBooks([
    { md5, title: 'Walkaway', readUrl: 'https://example.test/walkaway.epub' },
    { md5, title: 'Walkaway', language: 'en' },
  ]);
  assert.equal(book.readUrl, 'https://example.test/walkaway.epub');
  assert.equal(book.language, 'en');
});

test('shows every availability source when several source hints exist', () => {
  assert.equal(availabilityForBook({ md5: 'a'.repeat(32), blossomUrl: 'https://blossom.test/a' }), 'Blossom');
});

test('matches library books by stable ID, then URL, then ISBN', () => {
  assert.equal(sameLibraryBook({ md5: 'a'.repeat(32) }, { md5: 'A'.repeat(32) }), true);
  assert.equal(sameLibraryBook({ readUrl: 'https://example.test/book.epub#one' }, { url: 'https://example.test/book.epub' }), true);
  assert.equal(sameLibraryBook({ isbn: '978-0-00-000000-1' }, { identifiers: [{ type: 'isbn', value: '9780000000001' }] }), true);
  assert.equal(sameLibraryBook({ md5: 'a'.repeat(32) }, { md5: 'b'.repeat(32) }), false);
});

test('merges reading and favorite status into one library row', () => {
  const md5 = 'e'.repeat(32);
  const library = mergeLibraryState(
    [{ md5, title: 'Walkaway', authors: 'Cory Doctorow', updatedAt: 200 }],
    [{ md5, title: 'Untitled book', favoriteAddedAt: 100, language: 'en' }],
  );
  assert.equal(library.length, 1);
  assert.equal(library[0].title, 'Walkaway');
  assert.equal(library[0].authors, 'Cory Doctorow');
  assert.equal(library[0].language, 'en');
  assert.equal(library[0].isReading, true);
  assert.equal(library[0].isFavorite, true);
});

test('orders recently read books before favorite-only books', () => {
  const library = mergeLibraryState(
    [
      { md5: '1'.repeat(32), title: 'Older read', updatedAt: 100 },
      { md5: '2'.repeat(32), title: 'Recent read', updatedAt: 300 },
    ],
    [
      { md5: '3'.repeat(32), title: 'Older favorite', favoriteAddedAt: 200 },
      { md5: '4'.repeat(32), title: 'Recent favorite', favoriteAddedAt: 400 },
    ],
  );
  assert.deepEqual(library.map(book => book.title), ['Recent read', 'Older read', 'Recent favorite', 'Older favorite']);
});

test('enriches missing fields while tracking their source', () => {
  const enriched = enrichBookMetadata(
    { md5: 'gutenberg:30142', title: 'Untitled book', authors: '' },
    {
      title: 'Little Brother', authors: 'Cory Doctorow', issued: '2009-09-30', language: 'EN', source: 'gutenberg',
      coverUrl: 'https://blossom.example/cover.jpg', coverSha256: 'c'.repeat(64),
    },
    'gutenberg:30142',
  );
  assert.equal(enriched.title, 'Little Brother');
  assert.equal(enriched.authors, 'Cory Doctorow');
  assert.equal(enriched.year, '2009');
  assert.equal(enriched.language, 'en');
  assert.equal(enriched.coverUrl, 'https://blossom.example/cover.jpg');
  assert.equal(enriched.coverSha256, 'c'.repeat(64));
  assert.equal(enriched.metadataProvenance.authors, 'gutenberg:30142');
});

test('does not overwrite established metadata with a different edition', () => {
  const enriched = enrichBookMetadata(
    { title: 'Little Brother', authors: 'Cory Doctorow', year: '2009', language: 'en' },
    { title: 'Little Brother', authors: 'Someone Else', year: '2010', language: 'fr' },
    'fallback',
  );
  assert.equal(enriched.authors, 'Cory Doctorow');
  assert.equal(enriched.year, '2009');
  assert.equal(enriched.language, 'en');
});

test('enriches placeholder metadata with remote values and tracks provenance', () => {
  const merged = enrichBookMetadata(
    { title: 'Untitled book', readUrl: 'https://books.guaka.org/books/123' },
    {
      title: 'Remote title',
      authors: 'Remote Author',
      language: 'en',
      year: 2024,
      extension: 'epub',
      source: 'gutenberg',
      sourceNativeId: '30142',
    },
    'private-search',
  );

  assert.equal(merged.title, 'Remote title');
  assert.equal(merged.authors, 'Remote Author');
  assert.equal(merged.year, '2024');
  assert.equal(merged.language, 'en');
  assert.equal(merged.extension, 'epub');
  assert.equal(merged.readUrl, 'https://books.guaka.org/books/123');
  assert.equal(merged.metadataLookupComplete, true);
  assert.equal(merged.metadataProvenance.title, 'private-search');
  assert.equal(merged.metadataProvenance.readUrl, undefined);
});

test('matches books by normalized URLs and ISBN', () => {
  assert.equal(sameLibraryBook(
    { readUrl: 'https://example.test/book.epub#chapter-2' },
    { url: 'https://example.test/book.epub' },
  ), true);
  assert.equal(sameLibraryBook(
    { isbn13: '978-1-2345-6789-0' },
    { isbn: '9781234567890' },
  ), true);
  assert.equal(sameLibraryBook(
    { md5: 'a'.repeat(32) },
    { md5: 'A'.repeat(32) },
  ), true);
});

test('merges reading and favorites into one row while preserving reading title', () => {
  const merged = mergeLibraryState(
    [{ md5: 'a'.repeat(32), title: 'Reading title', updatedAt: 111 }],
    [{ md5: 'a'.repeat(32), title: 'Untitled book', favoriteAddedAt: 222 }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Reading title');
  assert.equal(merged[0].isReading, true);
  assert.equal(merged[0].isFavorite, true);
  assert.equal(merged[0].readingUpdatedAt, 111);
  assert.equal(merged[0].favoriteAddedAt, 222);
});

test('bookIdentity prefers readUrl fallback only when no canonical IDs exist', () => {
  const baseBook = { readUrl: 'https://example.test/book.epub#v=2' };
  assert.equal(bookIdentity(baseBook), 'url:https://example.test/book.epub');

  const md5Book = { md5: 'B'.repeat(32), readUrl: 'https://example.test/b.md5' };
  assert.equal(bookIdentity(md5Book), `id:${'b'.repeat(32)}`);
});

test('enrichBookMetadata does not replace a real title with a placeholder payload title', () => {
  const merged = enrichBookMetadata(
    { title: 'Real Title', readUrl: 'https://books-api.guaka.org/api/books/123' },
    { title: 'Untitled book', authors: 'Remote Author' },
    'search-response',
  );

  assert.equal(merged.title, 'Real Title');
  assert.equal(merged.authors, 'Remote Author');
  assert.equal(merged.metadataProvenance?.title, undefined);
});

test('sortBooks handles non-numeric years deterministically', () => {
  const books = [
    { title: 'A', year: 'not-a-year' },
    { title: 'B', year: '2021' },
    { title: 'C', year: '' },
  ];
  const sorted = sortBooks(books, 'year');
  assert.equal(sorted[0].title, 'A');
  assert.equal(sorted[1].title, 'C');
  assert.equal(sorted[2].title, 'B');
});

test('bookIdentity prioritizes canonical source IDs before URL fallback', () => {
  const bySha = { blossomSha256: 'A'.repeat(64), readUrl: 'https://example.test/fallback' };
  assert.equal(bookIdentity(bySha), `sha256:${'a'.repeat(64)}`);

  const byIsbn = { isbn: '978-3-16-148410-0', source: 'gutenberg', sourceNativeId: '123' };
  assert.equal(bookIdentity(byIsbn), 'source:gutenberg:123');
});

test('metadataEndpointForReadUrl preserves only canonical Gutenberg download URLs', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/download?download=1#page=2'),
    'https://books-api.guaka.org/api/books/48320',
  );
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/abc/download'), '');
});

test('availabilitySourcesForBook deduplicates repeated sources', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'gutenberg', readUrl: 'https://books-api.guaka.org/api/books/48320/download', blossomUrl: 'https://blossom.example/file.epub' }, true),
    ['Gutenberg', 'Blossom', 'Cached'],
  );
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'gutenberg', md5: 'gutenberg:48320' }, false),
    ['Gutenberg'],
  );
});

test('sortBooks places cached entries after non-cached when sorting cached ascending', () => {
  const books = [
    { title: 'Local', md5: 'a'.repeat(32) },
    { title: 'Remote' },
  ];
  const sorted = sortBooks(books, 'cached', 'asc', book => book.md5 === 'a'.repeat(32));
  assert.equal(sorted[0].title, 'Remote');
  assert.equal(sorted[1].title, 'Local');
});

test('title derivation decodes encoded URL paths', () => {
  assert.equal(
    resolveTitle({ readUrl: 'https://books-api.guaka.org/api/download/O%20Senhor%20dos%20An%C3%A9is.epub' }),
    'O Senhor dos Anéis',
  );
});

test('metadataEndpointForReadUrl ignores malformed ids and non-download endpoints', () => {
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320'), '');
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/abc/download?download=1'), '');
});

test('reading favorites from mixed metadata and ISBN keys are deduplicated', () => {
  const books = [
    { md5: 'a'.repeat(32), title: 'Known', authors: 'Primary' },
    { isbn13: '978-3-16-148410-0', title: 'Fallback', year: 2024 },
    { isbn10: '0-201-53082-1', title: 'Fallback Alt', authors: 'Another' },
  ];
  const merged = dedupeLibraryBooks(books);
  assert.equal(merged.length, 3);
});

test('matches identical books by normalized URL plus cached flag in sort', () => {
  const sameUrl = 'https://books-api.guaka.org/api/books/48320/download#section-2';
  assert.equal(
    sameLibraryBook(
      { readUrl: sameUrl, title: 'A' },
      { url: 'https://books-api.guaka.org/api/books/48320/download#section-8', title: 'B' },
    ),
    true,
  );

  const books = [
    { title: 'Cached one', md5: 'a'.repeat(32), updatedAt: 100 },
    { title: 'Remote one', readUrl: sameUrl },
  ];
  const sorted = sortBooks(books, 'cached', 'desc', book => book.md5 === 'a'.repeat(32));
  assert.equal(sorted[0].title, 'Cached one');
});

test('canonical catalog ids only accept openlibrary sources', () => {
  assert.equal(canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: 'OL123W' }), 'https://openlibrary.org/books/OL123W');
  assert.equal(canonicalCatalogUrl({ source: 'OpenLibrary', sourceNativeId: '123' }), 'https://openlibrary.org/works/OL123W');
  assert.equal(canonicalCatalogUrl({ source: 'gutenberg', sourceNativeId: '123' }), '');
});

test('normalizeFavoriteAddedAt keeps second precision for 10-digit unix values', () => {
  assert.equal(normalizeFavoriteAddedAt(1_700_000_000), 1700000000);
});

test('normalizeFavoriteAddedAt converts millisecond timestamps to seconds', () => {
  const millis = 1_700_000_000_123;
  assert.equal(normalizeFavoriteAddedAt(millis), 1_700_000_000);
});

test('sameLibraryBook does not merge by title when ISBNs differ', () => {
  assert.equal(
    sameLibraryBook(
      { isbn: '978-0-00-000000-1', title: 'Same title' },
      { isbn: '978-0-00-000000-2', title: 'Same title' },
    ),
    false,
  );
});

test('matchesBookFilter supports multi-term language and availability matching', () => {
  const book = {
    title: 'Deep Learning',
    authors: 'Aurélio',
    language: 'PT',
    extension: 'epub',
    source: 'gutenberg',
    readUrl: 'https://books-api.guaka.org/api/books/48320/download',
  };
  assert.equal(matchesBookFilter(book, 'pt epub gutenberg'), true);
  assert.equal(matchesBookFilter(book, 'pt notthere'), false);
});

test('canonicalReadUrl keeps direct non-legacy URLs', () => {
  assert.equal(
    canonicalReadUrl({ readUrl: 'https://example.test/book.epub' }),
    'https://example.test/book.epub',
  );
});

test('merges library rows across reading and favorite sources using normalized ISBN', () => {
  const sharedIsbn = '978-3-16-148410-0';
  const library = mergeLibraryState(
    [{ isbn: sharedIsbn, title: 'Read by ISBN', authors: 'Canonical Author', updatedAt: 200 }],
    [{ isbn: sharedIsbn, readUrl: 'https://example.test/book.epub', title: 'Untitled book', language: 'pt' }],
  );
  assert.equal(library.length, 1);
  assert.equal(library[0].title, 'Read by ISBN');
  assert.equal(library[0].authors, 'Canonical Author');
  assert.equal(library[0].isReading, true);
  assert.equal(library[0].isFavorite, true);
  assert.equal(library[0].language, 'pt');
});

test('extracts ISBN metadata from identifier arrays and normalizes it', () => {
  assert.equal(
    isbnForBook({ identifiers: [{ type: 'isbn', value: '978-3-16-148410-0' }] }),
    '9783161484100',
  );
  assert.equal(
    isbnForBook({ identifiers: [{ type: 'ISBN', value: '0-553-10953-7' }], isbn10: '9999999999' }),
    '0553109537',
  );
});

test('keeps tracked read URL when incoming read URL is merely a placeholder title', () => {
  const enriched = enrichBookMetadata(
    { title: 'Known title', readUrl: 'https://legacy.example/book.epub', readUrlSource: 'existing' },
    {
      title: 'Untitled book',
      readUrl: 'https://new.example/book.epub',
      language: 'en',
      year: 2024,
    },
    'private-search',
  );
  assert.equal(enriched.readUrl, 'https://legacy.example/book.epub');
  assert.equal(enriched.readUrlSource, 'existing');
  assert.equal(enriched.language, 'en');
  assert.equal(enriched.year, 2024);
  assert.equal(enriched.metadataProvenance.language, 'private-search');
  assert.equal(enriched.metadataProvenance.readUrl, undefined);
});
