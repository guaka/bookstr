import test from 'node:test';
import assert from 'node:assert/strict';

await import('../book-metadata.js');
const {
  bookIdentity,
  metadataObject,
  resolveTitle,
  languageForBook,
  yearForBook,
  readingProgressForBook,
  authorSearchName,
  normalizeReadUrl,
  availabilityForBook,
  enrichBookMetadata,
  availabilitySourcesForBook,
  canonicalReadUrl,
  metadataEndpointForReadUrl,
  canonicalCatalogUrl,
  sameLibraryBook,
  matchesBookFilter,
  sortBooks,
  dedupeLibraryBooks,
  mergeLibraryState,
  mergeFavoriteEntry,
  findBookByReadUrl,
  normalizeFavoriteAddedAt,
  earliestFavoriteAddedAt,
  favoriteAddedTag,
  isbnForBook,
} = globalThis.BookMetadata;

test('resolveTitle reads nested source and publication titles', () => {
  assert.equal(resolveTitle({
    source: { book: { title: 'Source Book' } },
  }), 'Source Book');
  assert.equal(resolveTitle({
    publication: { title: 'Publication Title' },
  }), 'Publication Title');
});

test('languageForBook uses sourceLanguage and sourceLanguage object aliases', () => {
  assert.equal(languageForBook({ sourceLanguage: 'PT' }), 'pt');
  assert.equal(languageForBook({ sourceLanguage: { id: 'ES' } }), 'es');
});

test('yearForBook reads published year as a fallback', () => {
  assert.equal(yearForBook({ published: '1999-12-31' }), '1999');
});

test('yearForBook reads issued year fallback', () => {
  assert.equal(yearForBook({ issued: '1998-07-09' }), '1998');
});

test('languageForBook reads language object from metadata language list', () => {
  assert.equal(languageForBook({ metadata: { languages: [{ code: 'EN-US' }] } }), 'en-us');
});

test('sameLibraryBook compares books using libvaultMd5 alias with normalized IDs', () => {
  const md5 = 'a'.repeat(32);
  assert.equal(sameLibraryBook({ libvaultMd5: md5 }, { md5: 'A'.repeat(32) }), true);
});

test('enrichBookMetadata preserves existing title while filling missing fields without provenance noise', () => {
  const merged = enrichBookMetadata(
    { title: 'Existing title', bookTitle: 'Ignored source book title' },
    { title: 'Incoming title', authors: 'Jose Saramago', language: 'pt' },
  );

  assert.equal(merged.title, 'Existing title');
  assert.equal(merged.authors, 'Jose Saramago');
  assert.deepEqual(merged.metadataProvenance, {});
  assert.equal(merged.metadataLookupComplete, true);
});

test('languageForBook ignores unknown language structures', () => {
  assert.equal(languageForBook({ language: { invalid: true } }), '');
  assert.equal(languageForBook({ metadata: { language: { invalid: true } } }), '');
});

test('yearForBook returns empty when no year-like fields are available', () => {
  assert.equal(yearForBook({}), '');
  assert.equal(yearForBook({ metadata: { year: 'n/a' }, date: '' }), '');
});

test('metadataObject trims and rejects whitespace-only payloads', () => {
  assert.deepEqual(metadataObject('   '), {});
  assert.deepEqual(metadataObject(''), {});
});

test('metadataObject rejects non-object JSON values', () => {
  assert.deepEqual(metadataObject('\"string\"'), {});
  assert.deepEqual(metadataObject('123'), {});
});

test('availabilitySourcesForBook keeps supported source hints and treats retired Blossom hints as metadata', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'GuTeNbErG' }),
    ['Gutenberg'],
  );
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'BlOsSoM-cdn', blossomSha256: 'a'.repeat(64) }, true),
    ['Metadata only', 'Cached'],
  );
});

test('bookIdentity normalizes readUrl when generating URL identity', () => {
  assert.equal(
    bookIdentity({ readUrl: 'https://example.test/books/guide.epub?download=1#reader', title: 'Untitled book' }),
    'url:https://example.test/books/guide.epub?download=1',
  );
});

test('sameLibraryBook normalizes URLs before matching', () => {
  assert.equal(
    sameLibraryBook(
      { readUrl: 'https://example.test/books/guide.epub?download=1#reader' },
      { url: 'https://example.test/books/guide.epub?download=1' },
    ),
    true,
  );
});

test('normalizeReadUrl trims input and strips fragments while preserving query', () => {
  assert.equal(
    normalizeReadUrl('https://example.test/books/guide.epub?download=1#reader'),
    'https://example.test/books/guide.epub?download=1',
  );
  assert.equal(normalizeReadUrl('   /books/guide.epub?download=1#reader   ', 'https://example.test'), 'https://example.test/books/guide.epub?download=1');
});

test('normalizeReadUrl keeps non-url payloads untouched when they have no scheme and no base URL', () => {
  assert.equal(normalizeReadUrl('relative.epub'), 'relative.epub');
});

test('canonicalReadUrl drops unsupported API read routes', () => {
  assert.equal(
    canonicalReadUrl({ readUrl: 'https://books-api.guaka.org/api/read/f4a1c5d2f8b0d9d3e8e7f6a5b4c3d2e1' }),
    '',
  );
});

test('canonicalReadUrl preserves non-URL read hints as raw input', () => {
  assert.equal(canonicalReadUrl({ readUrl: 'not a valid url 123' }), 'not a valid url 123');
});

test('metadataEndpointForReadUrl preserves a custom host with a matching route', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://other.example/api/books/48320/download?download=1'),
    'https://other.example/api/books/48320',
  );
});

test('metadataEndpointForReadUrl strips query string but keeps API route', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/download?download=1'),
    'https://books-api.guaka.org/api/books/48320',
  );
});

test('metadataObject keeps object payloads as-is and rejects primitive JSON strings', () => {
  const obj = { source: 'openlibrary' };
  assert.equal(metadataObject(obj), obj);
  assert.deepEqual(metadataObject('"not-object"'), {});
});

test('readingProgressForBook clamps mixed inputs and ignores invalid payloads', () => {
  assert.equal(readingProgressForBook({ progression: 1.8 }), 1);
  assert.equal(readingProgressForBook({ progress: '-0.1' }), 0);
  assert.equal(readingProgressForBook({ furthestProgression: '0.45' }), 0.45);
  assert.equal(readingProgressForBook({ locator: 123 }), null);
  assert.equal(
    readingProgressForBook({ locator: '{"progression":0.42}' }),
    0.42,
  );
});

test('canonicalReadUrl resolves gutenberg identifier from source native ID', () => {
  assert.equal(
    canonicalReadUrl({ source: 'gutenberg', sourceNativeId: '30142' }),
    'https://books-api.guaka.org/api/books/30142/download',
  );
});

test('canonicalCatalogUrl normalizes openlibrary identifiers with whitespace', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'OpenLibrary', sourceNativeId: '  ol123m  ' }),
    'https://openlibrary.org/books/OL123M',
  );
});

test('canonicalCatalogUrl returns empty for unsupported openlibrary IDs', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: 'not-an-id' }),
    '',
  );
});

test('availabilityForBook collapses metadata+cached state to cached', () => {
  assert.equal(
    availabilityForBook({ readUrl: 'https://example.test/book.epub' }, true),
    'Cached',
  );
});

test('availabilityForBook ignores retired Blossom sources when combining availability', () => {
  assert.equal(
    availabilityForBook({
      readUrl: 'https://books-api.guaka.org/api/books/48320/download',
      blossomUrl: 'https://blossom.example.com/book.epub',
    }),
    'Gutenberg',
  );
  assert.equal(
    availabilityForBook({
      readUrl: 'https://books-api.guaka.org/api/books/48320/download',
      blossomUrl: 'https://blossom.example.com/book.epub',
    }, true),
    'Gutenberg · Cached',
  );
});

test('availabilitySourcesForBook preserves cached after deduping source labels', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'gutenberg', readUrl: 'https://books-api.guaka.org/api/books/48320/download' }, true),
    ['Gutenberg', 'Cached'],
  );
});

test('sameLibraryBook matches blossom SHA aliases case-insensitively', () => {
  assert.equal(
    sameLibraryBook(
      { blossomSha256: 'A'.repeat(64) },
      { blossomSha256: 'a'.repeat(64) },
    ),
    true,
  );
});

test('availabilitySourcesForBook keeps legacy api/read URLs metadata-only and adds cached only when requested', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ readUrl: 'https://lib.b.bfr.ee/api/read/' + 'a'.repeat(32) }, true),
    ['Metadata only', 'Cached'],
  );
});

test('sameLibraryBook falls back to URL matching when only one record carries stable IDs', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), readUrl: 'https://example.test/books/gutenberg.epub' },
      { readUrl: 'https://example.test/books/gutenberg.epub#reader' },
    ),
    true,
  );
});

test('sameLibraryBook ignores URL collision when stable IDs conflict', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), readUrl: 'https://example.test/book-a.epub' },
      { md5: 'b'.repeat(32), readUrl: 'https://example.test/book-a.epub' },
    ),
    false,
  );
});

test('bookIdentity uses md5 in preference to source metadata', () => {
  const stable = { md5: 'A'.repeat(32), source: 'openlibrary', sourceNativeId: '12345' };
  const bySource = { source: 'openlibrary', sourceNativeId: '12345' };
  assert.equal(bookIdentity(stable), `id:${'a'.repeat(32)}`);
  assert.equal(bookIdentity(bySource), 'source:openlibrary:12345');
});

test('bookIdentity falls back to URL identity when no IDs are available', () => {
  assert.equal(
    bookIdentity({ readUrl: 'https://example.test/books/guide.epub?download=1#reader' }),
    `url:https://example.test/books/guide.epub?download=1`,
  );
});

test('bookIdentity collapses isbn variants and preserves normalized digits', () => {
  const expectedIsbn = '9781234567890';
  assert.equal(
    bookIdentity({
      isbn10: '978-1-234-56789-0',
      readUrl: 'https://example.test/books/guide.epub',
    }),
    `isbn:${expectedIsbn}`,
  );
});

test('normalizeFavoriteAddedAt and earliestFavoriteAddedAt prefer earliest valid second', () => {
  assert.equal(normalizeFavoriteAddedAt('1700000000000'), 1700000000);
  assert.equal(normalizeFavoriteAddedAt('1700000000'), 1700000000);
  assert.equal(normalizeFavoriteAddedAt('bad'), 0);
  assert.equal(earliestFavoriteAddedAt('1700000000', '1700000001', 'bad', null), 1700000000);
});

test('favoriteAddedTag requires valid md5 and non-zero timestamp', () => {
  assert.equal(favoriteAddedTag('A'.repeat(31), 170000), null);
  assert.equal(favoriteAddedTag('A'.repeat(32), 0), null);
  assert.deepEqual(favoriteAddedTag('A'.repeat(32), 170000), ['libvault-added', 'a'.repeat(32), '170000']);
});

test('sameLibraryBook matches isbn when no stable ids or urls are available', () => {
  assert.equal(
    sameLibraryBook(
      { isbn: '978-1-234-56789-0' },
      { isbn13: '9781234567890' },
    ),
    true,
  );
});

test('metadataObject returns empty object for invalid JSON text', () => {
  assert.deepEqual(metadataObject('{"bad":'), {});
});

test('isbnForBook reads identifier lists and normalizes direct identifiers', () => {
  assert.equal(isbnForBook({ isbn: '  0-306-40615-2  ' }), '0306406152');
  assert.equal(
    isbnForBook({
      identifiers: [
        { type: 'isbn_10', value: '  1 6 2 4 4 8 0 9 9 5 X ' },
      ],
    }),
    '1624480995X',
  );
});

test('metadataEndpointForReadUrl returns empty for non-numeric api book ids', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/not-a-number/download'),
    '',
  );
});

test('findBookByReadUrl matches readUrl and url but ignores retired blossomUrl fields', () => {
  const books = [
    { readUrl: 'https://example.test/books/guide.epub?download=1#reader', title: 'A' },
    { url: 'https://example.test/books/other.epub', title: 'B' },
    { blossomUrl: 'https://blossom.test/file.epub#frag', title: 'C' },
  ];

  assert.equal(findBookByReadUrl('https://example.test/books/guide.epub?download=1', books).title, 'A');
  assert.equal(findBookByReadUrl('https://example.test/books/other.epub#section', books).title, 'B');
  assert.equal(findBookByReadUrl('https://blossom.test/file.epub', books), null);
});

test('findBookByReadUrl matches a collection entry in later argument lists', () => {
  const preferred = [{ readUrl: 'https://example.test/a.epub', title: 'A' }];
  const fallback = [{ readUrl: 'https://example.test/b.epub', title: 'B' }];

  assert.equal(
    findBookByReadUrl('https://example.test/b.epub?download=1#reader', preferred, fallback).title,
    'B',
  );
});

test('findBookByReadUrl ignores non-matching collections and searches further entries', () => {
  const preferred = [{ readUrl: 'https://example.test/a.epub', title: 'A' }];
  const fallback = [{ url: 'https://example.test/b.epub', title: 'B' }];

  assert.equal(
    findBookByReadUrl('https://example.test/b.epub', preferred, fallback).title,
    'B',
  );
});

test('metadataEndpointForReadUrl returns base API endpoint when download URL is valid', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/download'),
    'https://books-api.guaka.org/api/books/48320',
  );
});

test('canonicalReadUrl supports Gutenberg source with raw md5-style source identifier', () => {
  assert.equal(
    canonicalReadUrl({ md5: 'gutenberg:30142' }),
    'https://books-api.guaka.org/api/books/30142/download',
  );
});

test('metadataEndpointForReadUrl strips query/hash and trailing slash from download URL', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/download/?download=1#reader'),
    'https://books-api.guaka.org/api/books/48320',
  );
});

test('metadataEndpointForReadUrl returns empty string for invalid urls', () => {
  assert.equal(metadataEndpointForReadUrl('not a real url'), '');
});

test('findBookByReadUrl returns null for invalid query input', () => {
  assert.equal(findBookByReadUrl('not a real url', [{ readUrl: 'https://example.test/a.epub' }]), null);
});

test('availabilitySourcesForBook defaults to Metadata only without recognized sources', () => {
  assert.deepEqual(availabilitySourcesForBook({ title: 'No sources' }), ['Metadata only']);
});

test('authorSearchName strips birth/death/year suffixes', () => {
  assert.equal(authorSearchName('Jane Austen (1780-1817)'), 'Jane Austen');
  assert.equal(authorSearchName('George Orwell, b.1903-1950'), 'George Orwell');
});

test('canonicalCatalogUrl normalizes numeric openlibrary IDs to works URLs', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: '12345' }),
    'https://openlibrary.org/works/OL12345W',
  );
});

test('dedupeLibraryBooks preserves non-empty existing authors when incoming title is placeholder', () => {
  const md5 = 'd'.repeat(32);
  const unique = dedupeLibraryBooks([
    { md5, readUrl: 'https://example.test/book.epub', title: 'Real Title', authors: 'Jane Doe' },
    { md5, title: 'Untitled book', authors: 'Should be ignored' },
  ]);

  assert.equal(unique.length, 1);
  assert.equal(unique[0].title, 'Real Title');
  assert.equal(unique[0].authors, 'Jane Doe');
});

test('canonicalCatalogUrl normalizes canonical M-type openlibrary IDs to books URLs', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'OpenLibrary', sourceNativeId: 'ol987m' }),
    'https://openlibrary.org/books/OL987M',
  );
});

test('matchesBookFilter checks searchable fields and cached label', () => {
  const book = {
    title: 'Sample Book',
    authors: 'Author Name',
    year: '2022',
    format: 'epub',
    isFavorite: true,
    language: 'pt',
  };
  assert.equal(matchesBookFilter(book, 'sample author', () => false), true);
  assert.equal(matchesBookFilter(book, 'favorite', () => true), true);
  assert.equal(matchesBookFilter(book, 'missing term', () => false), false);
  assert.equal(matchesBookFilter(book, '', () => false), true);
});

test('sortBooks sorts by year descending while keeping deterministic title tie-break', () => {
  const books = [
    { title: 'Zulu', authors: 'A', year: '2001', availability: 0, readUrl: 'https://x.local/book.epub' },
    { title: 'Alpha', authors: 'B', year: '2011', availability: 0, readUrl: 'https://x.local/book.epub' },
    { title: 'Beta', authors: 'C', year: '2011', availability: 0, readUrl: 'https://x.local/book2.epub' },
  ];

  const sorted = sortBooks(books, 'year', 'desc');
  assert.equal(sorted[0].title, 'Alpha');
  assert.equal(sorted[1].title, 'Beta');
  assert.equal(sorted[2].title, 'Zulu');
});

test('sortBooks can sort by cached status and prefers reading state input callback', () => {
  const books = [
    { title: 'Not Cached', readUrl: 'a' },
    { title: 'Cached', readUrl: 'b' },
    { title: 'Also Cached', readUrl: 'c' },
  ];
  const sorted = sortBooks(books, 'cached', 'desc', (book) => book.title.startsWith('C'));
  assert.equal(sorted[0].title, 'Cached');
  assert.equal(sorted[1].title, 'Also Cached');
  assert.equal(sorted[2].title, 'Not Cached');
});

test('findBookByReadUrl returns null when no candidates match', () => {
  const books = [{ readUrl: 'https://example.test/a.epub' }];
  assert.equal(findBookByReadUrl('https://example.test/missing.epub', books), null);
});

test('dedupeLibraryBooks keeps first identity and improves title from non-placeholder incoming', () => {
  const unique = dedupeLibraryBooks([
    { id: 'x'.repeat(32), title: 'Untitled book' },
    { id: 'x'.repeat(32), title: 'Real Book Title', readUrl: 'https://example.test/book.epub' },
  ]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].title, 'Real Book Title');
});

test('mergeLibraryState merges reading and favorites into a single book entry', () => {
  const md5 = 'e'.repeat(32);
  const merged = mergeLibraryState(
    [{ md5, bookId: '1', title: 'Reading Title', updatedAt: 10 }],
    [{ md5, bookId: '1', title: 'Favorite Title', updatedAt: 20, favoriteAddedAt: 40 }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].isReading, true);
  assert.equal(merged[0].isFavorite, true);
  assert.equal(merged[0].readingUpdatedAt, 10);
  assert.equal(merged[0].favoriteAddedAt, 40);
});

test('mergeFavoriteEntry keeps earliest favorite timestamp and ignores blank fields', () => {
  const entries = [];
  const first = mergeFavoriteEntry(entries, { md5: 'A'.repeat(32), title: '', favoriteAddedAt: 1700000002 });
  const second = mergeFavoriteEntry(entries, { md5: 'a'.repeat(32), title: 'Real title', favoriteAddedAt: 1700000001 });

  assert.equal(entries.length, 1);
  assert.equal(first.title, second.title);
  assert.equal(first.title, 'Real title');
  assert.equal(first.favoriteAddedAt, 1700000001);
});

test('availabilitySourcesForBook treats case-insensitive retired Blossom hints as metadata only', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'BlOsSoM' }),
    ['Metadata only'],
  );
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'BLossOM', md5: 'A'.repeat(32) }, true),
    ['Metadata only', 'Cached'],
  );
});

test('sortBooks falls back to title ordering for unknown keys', () => {
  const books = [
    { title: 'Zulu', year: '2020' },
    { title: 'Alpha', year: '1990' },
    { title: 'Beta', year: '2010' },
  ];
  const sorted = sortBooks(books, 'unknown');
  assert.deepEqual(sorted.map(book => book.title), ['Alpha', 'Beta', 'Zulu']);
});

test('sortBooks can sort by language with human-readable labels', () => {
  const books = [
    { title: 'Book A', language: 'de' },
    { title: 'Book B', language: 'en' },
    { title: 'Book C', language: '' },
  ];

  assert.deepEqual(
    sortBooks(books, 'language').map(book => book.title),
    ['Book C', 'Book B', 'Book A'],
  );
});

test('canonicalCatalogUrl requires whitespace and case normalization for numeric source IDs', () => {
  assert.equal(
    canonicalCatalogUrl({ source: ' openlibrary ', sourceNativeId: '  000123 	' }),
    'https://openlibrary.org/works/OL000123W',
  );
});

test('metadataEndpointForReadUrl derives metadata routes on custom hosts', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://cdn.example.org/api/books/48320/download?download=1'),
    'https://cdn.example.org/api/books/48320',
  );
});

test('canonicalCatalogUrl returns empty for malformed openlibrary ids even with source hints', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: 'olabc' }),
    '',
  );
});

test('metadataObject rejects string "null" as empty metadata', () => {
  assert.deepEqual(metadataObject('null'), {});
});

test('metadataObject preserves arrays but rejects primitives', () => {
  assert.deepEqual(metadataObject('["a","b"]'), ['a', 'b']);
  assert.deepEqual(metadataObject('42'), {});
});

test('availabilitySourcesForBook removes duplicate labels when both source hint and URL imply Gutenberg', () => {
  assert.deepEqual(
    availabilitySourcesForBook({
      source: 'GUTENBERG',
      readUrl: 'https://books-api.guaka.org/api/books/48320/download',
    }),
    ['Gutenberg'],
  );
});

test('availabilityForBook collapses metadata-only + cached to plain cached label', () => {
  assert.equal(
    availabilityForBook({}, true),
    'Cached',
  );
});

test('metadataEndpointForReadUrl rejects uppercase DOWNLOAD path variants', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/Download'),
    '',
  );
});

test('sameLibraryBook preserves query distinctions for plain URL fallback', () => {
  assert.equal(
    sameLibraryBook(
      { readUrl: 'https://example.test/a.epub?download=1#reader' },
      { url: 'https://example.test/a.epub' },
    ),
    false,
  );
});

test('metadataObject keeps object-like JSON strings and rejects booleans', () => {
  assert.deepEqual(metadataObject('{"title":"Keep me"}'), { title: 'Keep me' });
  assert.deepEqual(metadataObject('false'), {});
});

test('normalizeFavoriteAddedAt preserves explicit zero and ignores non-positive numbers', () => {
  assert.equal(normalizeFavoriteAddedAt(0), 0);
  assert.equal(normalizeFavoriteAddedAt(-42), 0);
});

test('resolveTitle falls back to filename when no title metadata is provided', () => {
  assert.equal(
    resolveTitle({
      readUrl: 'https://example.test/files/Brave%20New%20World.epub',
    }),
    'Brave New World',
  );
});

test('mergeLibraryState keeps current reading status when favorite arrives first', () => {
  const merged = mergeLibraryState(
    [
      {
        bookId: 'book-2',
        title: 'Second',
        readUrl: 'https://example.test/second.epub',
        isReading: true,
        updatedAt: 111,
      },
    ],
    [
      {
        bookId: 'book-2',
        title: 'Second',
        readUrl: 'https://example.test/second.epub',
        favoriteAddedAt: 222,
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].isReading, true);
  assert.equal(merged[0].isFavorite, true);
  assert.equal(merged[0].readingUpdatedAt, 111);
  assert.equal(merged[0].favoriteAddedAt, 222);
});
