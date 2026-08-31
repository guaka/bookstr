import test from 'node:test';
import assert from 'node:assert/strict';

await import('../book-metadata.js');
const {
  metadataObject,
  isPlaceholderTitle,
  resolveTitle,
  languageForBook,
  yearForBook,
  normalizeRights,
  preferredRights,
  rightsLabel,
  rightsAccessibleLabel,
  authorSearchName,
  readingProgressForBook,
  normalizeFavoriteAddedAt,
  earliestFavoriteAddedAt,
  favoriteAddedTag,
  mergeFavoriteEntry,
  normalizeReadUrl,
  findBookByReadUrl,
  metadataEndpointForReadUrl,
  torrentMetadataForBook,
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

test('normalizes portable torrent metadata and ignores empty descriptors', () => {
  assert.equal(torrentMetadataForBook({}), null);
  assert.deepEqual(torrentMetadataForBook({
    torrentDescriptor: {
      magnetUri: ' magnet:?xt=urn:btih:book ',
      torrentFile: ' book.torrent ',
      announce: [' wss://tracker.example ', '', null],
    },
  }), {
    torrentId: 'magnet:?xt=urn:btih:book',
    torrentFile: 'book.torrent',
    announce: ['wss://tracker.example'],
  });
});

test('normalizes public torrent metadata without requiring a Blossom URL', () => {
  assert.deepEqual(torrentMetadataForBook({
    torrent_id: 'magnet:?xt=urn:btih:abc',
    torrent_announce: ['wss://tracker.example'],
  }), {
    torrentId: 'magnet:?xt=urn:btih:abc',
    torrentFile: '',
    announce: ['wss://tracker.example'],
  });
  assert.deepEqual(torrentMetadataForBook({
    torrent: { magnetURI: 'magnet:?xt=urn:btih:def', torrentFile: 'base64-metadata', announce: ['wss://tracker.example'] },
  }), {
    torrentId: 'magnet:?xt=urn:btih:def',
    torrentFile: 'base64-metadata',
    announce: ['wss://tracker.example'],
  });
  assert.equal(torrentMetadataForBook({ title: 'No transfer' }), null);
});

test('reports WebTorrent availability when a public torrent is present', () => {
  assert.equal(availabilityForBook({
    title: 'Torrent book',
    torrentId: 'magnet:?xt=urn:btih:abc',
  }), 'WebTorrent');
});

test('normalizes explicit rights evidence without inferring from age or source', () => {
  assert.deepEqual(normalizeRights({ copyright: false, source: 'gutenberg' }), {
    rights_status: 'public_domain',
    license: 'Public domain in the U.S.',
    license_url: '',
    rights_source: '',
  });
  assert.equal(normalizeRights({ copyright: true }).rights_status, 'copyrighted');
  assert.equal(normalizeRights({ copyright: null }).rights_status, 'unknown');
  assert.equal(normalizeRights({ source: 'gutenberg', year: 1800 }).rights_status, 'unknown');
  assert.equal(normalizeRights({ license: 'Public Domain Mark 1.0' }).rights_status, 'public_domain');
  assert.equal(normalizeRights({ license: 'CC0 1.0' }).rights_status, 'public_domain');
  assert.equal(normalizeRights({ rights: 'Creative Commons Attribution-ShareAlike 4.0' }).rights_status, 'open_license');
  assert.equal(normalizeRights({ license: 'GNU Free Documentation License' }).rights_status, 'open_license');
  assert.equal(normalizeRights({ license: 'All rights reserved' }).rights_status, 'copyrighted');
  assert.equal(normalizeRights({ license: 'Use responsibly' }).rights_status, 'unknown');
});

test('formats rights markers and accessible distinctions', () => {
  assert.equal(rightsLabel({ license: 'Public domain' }), 'PD');
  assert.equal(rightsLabel({ license: 'CC0 1.0' }), 'CC0');
  assert.equal(rightsLabel({ license: 'CC BY-SA 4.0' }), 'CC BY-SA 4.0');
  assert.equal(rightsLabel({ license: 'GNU Free Documentation License' }), 'OPEN');
  assert.equal(rightsLabel({}), '©');
  assert.equal(rightsAccessibleLabel({ rights_status: 'copyrighted' }), 'Copyrighted');
  assert.equal(rightsAccessibleLabel({}), 'No open license identified');
});

test('sorts cached books through the caller-provided cache lookup', () => {
  const books = sortBooks([
    { id: 'uncached', title: 'A' },
    { id: 'cached', title: 'B' },
  ], 'cached', 'desc', book => book.id === 'cached');
  assert.deepEqual(books.map(book => book.id), ['cached', 'uncached']);
});

test('keeps license URLs safe and preserves explicit metadata during partial refreshes', () => {
  assert.equal(normalizeRights({ license_url: 'javascript:alert(1)' }).license_url, '');
  assert.equal(
    normalizeRights({ license: 'See https://creativecommons.org/licenses/by/4.0/.' }).license_url,
    'https://creativecommons.org/licenses/by/4.0/',
  );
  const current = normalizeRights({ license: 'CC BY 4.0', rights_source: 'catalog' });
  assert.deepEqual(preferredRights(current, {}), current);
  assert.equal(preferredRights(current, { license: 'All rights reserved' }).rights_status, 'copyrighted');
});

test('metadataObject parses object payloads and ignores invalid payloads', () => {
  assert.deepEqual(metadataObject({ title: 'Book' }), { title: 'Book' });
  assert.deepEqual(metadataObject('{"isbn":"978-0-00-000000-0","title":"Remote"}'), {
    isbn: '978-0-00-000000-0',
    title: 'Remote',
  });
  assert.deepEqual(metadataObject('{ invalid json }'), {});
});

test('metadata helpers safely retain malformed URL text without deriving a title', () => {
  assert.equal(resolveTitle({ title: 'Untitled book' }, 'https://%', 'https://books.example/'), 'Untitled book');
  assert.equal(normalizeReadUrl('https://%', 'https://books.example/'), 'https://%');
});

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

test('extracts language from object-based metadata language lists', () => {
  assert.equal(languageForBook({ metadata: { languages: [{ code: 'ES' }, { code: 'PT' }] } }), 'es');
});

test('extracts years from common publication metadata', () => {
  assert.equal(yearForBook({ issued: '2009-09-30' }), '2009');
  assert.equal(yearForBook({ metadata: { publicationYear: 1984 } }), '1984');
  assert.equal(yearForBook({ publicationYear: 2100 }), '2100');
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

test('mergeFavoriteEntry keeps the established title and URL when incoming metadata is placeholder-only', () => {
  const entries = [];
  mergeFavoriteEntry(entries, {
    md5: 'A'.repeat(32),
    title: 'A Casa',
    url: 'https://books-api.guaka.org/api/books/48320/download',
    favoriteAddedAt: 1_700_000_000,
  });
  mergeFavoriteEntry(entries, {
    md5: 'a'.repeat(32),
    title: 'Untitled book',
    url: '',
    format: 'pdf',
    favoriteAddedAt: 1_700_000_100,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'A Casa');
  assert.equal(entries[0].url, 'https://books-api.guaka.org/api/books/48320/download');
  assert.equal(entries[0].format, 'pdf');
  assert.equal(entries[0].favoriteAddedAt, 1_700_000_000);
});

test('favoriteAddedTag rejects invalid ids and timestamps', () => {
  assert.equal(favoriteAddedTag('not-an-md5', 1_700_000_000), null);
  assert.equal(favoriteAddedTag('a'.repeat(32), 0), null);
  assert.equal(favoriteAddedTag('a'.repeat(32), -1), null);
});

test('finds reading metadata by readUrl, url, or Blossom URL', () => {
  const reading = [{ title: 'Scale', readUrl: 'https://books-api.guaka.org/api/books/48320/download' }];
  const favorites = [{ title: 'Other', blossomUrl: 'https://blossom.example/abc.epub' }];
  assert.equal(findBookByReadUrl('https://books-api.guaka.org/api/books/48320/download', reading, favorites)?.title, 'Scale');
  assert.equal(findBookByReadUrl('https://blossom.example/abc.epub', reading, favorites)?.title, 'Other');
});

test('returns null when findBookByReadUrl cannot match any book', () => {
  assert.equal(
    findBookByReadUrl('https://example.test/missing.epub', [{ title: 'One', readUrl: 'https://example.test/one.epub' }]),
    null,
  );
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

test('bookIdentity preserves malformed URLs as raw identity fallbacks', () => {
  const malformedReadUrl = '::://bad url';
  assert.equal(bookIdentity({ readUrl: malformedReadUrl }), `url:${malformedReadUrl}`);
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

test('availabilityForBook marks cached availability on top of source tags', () => {
  assert.equal(availabilityForBook({ readUrl: 'https://books-api.guaka.org/api/books/48320/download' }, true), 'Gutenberg · Cached');
  assert.equal(availabilityForBook({ title: 'Local-only cached copy', md5: 'a'.repeat(32) }, true), 'Cached');
});

test('normalizeReadUrl keeps invalid values as empty normalized strings', () => {
  assert.equal(normalizeReadUrl('not a url'), 'not a url');
  assert.equal(normalizeReadUrl(''), '');
});

test('normalizeReadUrl resolves relative URLs using the provided base', () => {
  assert.equal(
    normalizeReadUrl('/local/book.epub#chapter', 'https://books-api.guaka.org/library/index.html'),
    'https://books-api.guaka.org/local/book.epub',
  );
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

test('sorts books by language', () => {
  const books = [{ title: 'Z', language: 'pt' }, { title: 'A', language: 'en' }, { title: 'M', language: 'de' }];
  assert.deepEqual(sortBooks(books, 'language').map(book => book.title), ['A', 'M', 'Z']);
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

test('dedupeLibraryBooks merges records without IDs when ISBN matches', () => {
  const sharedIsbn = '978-3-16-148410-0';
  const books = dedupeLibraryBooks([
    { isbn: sharedIsbn, title: 'Edition A', authors: 'Author A', readUrl: 'https://example.test/book-a.epub' },
    { isbn: '9783161484100', title: 'Untitled book', language: 'en' },
    { isbn13: sharedIsbn, title: 'LibVault favorite', year: '2024' },
  ]);
  assert.equal(books.length, 1);
  assert.equal(books[0].title, 'Edition A');
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
  assert.equal(sameLibraryBook({ libvaultMd5: 'B'.repeat(32) }, { id: 'b'.repeat(32) }), true);
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

test('merges reading and favorite rows by URL when no stable IDs exist', () => {
  const library = mergeLibraryState(
    [
      {
        title: 'Reading title',
        url: 'https://example.test/library/book.epub',
        updatedAt: 150,
      },
    ],
    [
      {
        title: 'Untitled book',
        readUrl: 'https://example.test/library/book.epub#top',
        favoriteAddedAt: 400,
      },
    ],
  );

  assert.equal(library.length, 1);
  assert.equal(library[0].title, 'Reading title');
  assert.equal(library[0].isReading, true);
  assert.equal(library[0].isFavorite, true);
  assert.equal(library[0].readingUpdatedAt, 150);
  assert.equal(library[0].favoriteAddedAt, 400);
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

test('resolveTitle uses a base URL when only a relative read path is provided', () => {
  assert.equal(
    resolveTitle({ readUrl: '/books/A%20Great%20Book.epub' }, '', 'https://books-api.guaka.org/shelf/index.html'),
    'A Great Book',
  );
});

test('resolveTitle ignores malformed metadata JSON and falls back to filename', () => {
  assert.equal(
    resolveTitle({ readUrl: 'https://books-api.guaka.org/api/download/A%20Malformed%20Book.epub', metadata: '{"title":' }),
    'A Malformed Book',
  );
});

test('normalizeReadUrl keeps raw relative paths when no base URL is provided', () => {
  assert.equal(normalizeReadUrl('/books/relative.epub'), '/books/relative.epub');
});

test('metadataEndpointForReadUrl ignores malformed ids and non-download endpoints', () => {
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320'), '');
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/abc/download?download=1'), '');
});

test('sorts by format and supports uncached flags without crashing', () => {
  const books = [
    { title: 'Second', extension: 'epub' },
    { title: 'First', extension: 'pdf' },
  ];
  assert.equal(sortBooks(books, 'format')[0].title, 'Second');
  assert.equal(sortBooks(books, 'cached', 'asc', () => false)[1].title, 'Second');
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
  assert.equal(canonicalCatalogUrl({ source: 'openlibrary', sourceNativeId: 'OL123W' }), 'https://openlibrary.org/works/OL123W');
  assert.equal(canonicalCatalogUrl({ source: 'OpenLibrary', sourceNativeId: '123' }), 'https://openlibrary.org/works/OL123W');
  assert.equal(canonicalCatalogUrl({ source: 'gutenberg', sourceNativeId: '123' }), '');
});

test('canonicalCatalogUrl accepts source_native_id aliases from alternate payload shapes', () => {
  assert.equal(
    canonicalCatalogUrl({ source: 'openlibrary', source_native_id: 'OL999M' }),
    'https://openlibrary.org/books/OL999M',
  );
});

test('bookIdentity normalizes read URLs by stripping fragments', () => {
  assert.equal(
    bookIdentity({ readUrl: 'https://example.test/book.epub#chapter-2' }),
    'url:https://example.test/book.epub',
  );
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

test('canonicalReadUrl ignores legacy /api/read/ blob paths', () => {
  assert.equal(
    canonicalReadUrl({ readUrl: 'https://books-api.guaka.org/api/read/' + 'a'.repeat(32) }),
    '',
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
  assert.equal(isbnForBook({ isbn: 'not-an-isbn' }), '');
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
  assert.equal(enriched.year, '2024');
  assert.equal(enriched.metadataProvenance.language, 'private-search');
  assert.equal(enriched.metadataProvenance.readUrl, undefined);
});

test('normalizeFavoriteAddedAt handles empty and malformed inputs', () => {
  assert.equal(normalizeFavoriteAddedAt(''), 0);
  assert.equal(normalizeFavoriteAddedAt(undefined), 0);
  assert.equal(normalizeFavoriteAddedAt('not-a-date'), 0);
  assert.equal(earliestFavoriteAddedAt('', null, '2024-99-99'), 0);
});

test('favoriteAddedTag parses millisecond timestamps', () => {
  assert.deepEqual(
    favoriteAddedTag('A'.repeat(32), '1700000000123'),
    ['libvault-added', 'a'.repeat(32), '1700000000'],
  );
});

test('sameLibraryBook detects equality by ISBN regardless of placeholder title', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), title: 'LibVault favorite', isbn: null },
      { md5: '', isbn: '978-0-123456-78-9', title: 'Actual title' },
    ),
    false,
  );
  assert.equal(
    sameLibraryBook(
      { isbn: '978-0-123456-78-9', title: 'LibVault favorite' },
      { isbn: '9780123456789', title: 'Untitled book', readUrl: 'https://example.test/book.epub' },
    ),
    true,
  );
});

test('sameLibraryBook is insensitive to MD5 casing', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'A'.repeat(32), title: 'Stored title' },
      { md5: 'a'.repeat(32), title: 'Incoming title' },
    ),
    true,
  );
});

test('matchesBookFilter returns true for an empty query', () => {
  assert.equal(matchesBookFilter({ title: 'Any title' }, '   '), true);
  assert.equal(matchesBookFilter({ title: 'Any title' }, ''), true);
  assert.equal(matchesBookFilter({ title: 'Any title' }, null), true);
});

test('sortBooks supports descending cached ordering', () => {
  const books = [
    { title: 'Cached old', readUrl: 'https://example.test/cached-old', isCached: true },
    { title: 'Fresh favorite', readUrl: 'https://example.test/fresh', isFavorite: true },
  ];

  const ordered = sortBooks(books, 'cached', 'desc', book => book?.isCached === true);
  assert.equal(ordered[0].title, 'Cached old');
  assert.equal(ordered[1].title, 'Fresh favorite');
});

test('sortBooks uses an uncached default when no cache lookup is provided', () => {
  const books = [{ title: 'Zulu' }, { title: 'Alpha' }];
  assert.deepEqual(sortBooks(books, 'cached').map(book => book.title), ['Alpha', 'Zulu']);
});

test('bookIdentity strips URL fragments when using URL fallback', () => {
  assert.equal(
    bookIdentity({
      title: 'LibVault favorite',
      readUrl: 'https://example.test/#section-2',
    }),
    `url:https://example.test/`,
  );
});

test('metadataEndpointForReadUrl returns empty for non-download endpoint paths', () => {
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/abc/download'), '');
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/read/123'), '');
  assert.equal(metadataEndpointForReadUrl('https://example.test/books/123'), '');
  assert.equal(metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/123/download/extra'), '');
});

test('bookIdentity uses source_native_id when source is present without md5', () => {
  assert.equal(
    bookIdentity({
      source: 'gutenberg',
      sourceNativeId: '54321',
      md5: '',
    }),
    'source:gutenberg:54321',
  );
});

test('bookIdentity prefers explicit md5 over source-native hints', () => {
  assert.equal(
    bookIdentity({
      md5: 'A'.repeat(32),
      source: 'gutenberg',
      sourceNativeId: 54321,
      readUrl: 'https://example.test/book.epub',
    }),
    `id:${'a'.repeat(32)}`,
  );
});

test('matchesBookFilter includes reading and favorite status keywords', () => {
  const book = {
    title: 'Signals',
    authors: 'Terry Gilliam',
    isReading: true,
    isFavorite: true,
    year: '2024',
  };

  assert.equal(matchesBookFilter(book, 'currently'), true);
  assert.equal(matchesBookFilter(book, 'favourite'), true);
  assert.equal(matchesBookFilter(book, 'notthere'), false);
});

test('dedupeLibraryBooks keeps a real author when duplicate has placeholder title', () => {
  const deduped = dedupeLibraryBooks([
    { md5: 'a'.repeat(32), title: 'Real title', author: 'Real Author' },
    { md5: 'a'.repeat(32), title: 'Untitled book', author: 'Placeholder Author' },
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].title, 'Real title');
  assert.equal(deduped[0].author, 'Real Author');
});

test('findBookByReadUrl matches blossom URL entries with URL normalization', () => {
  const book = findBookByReadUrl(
    'https://example.test/book.epub#reader',
    [
      { blossomUrl: 'https://example.test/book.epub', title: 'Normalized by hash' },
      { readUrl: 'https://example.test/other-book.epub', title: 'Other' },
    ],
    [{ readUrl: 'https://books-api.guaka.org/api/read/123', title: 'Legacy ignored' }],
  );

  assert.equal(book?.title, 'Normalized by hash');
});

test('findBookByReadUrl matches url field entries with normalized fragments', () => {
  const book = findBookByReadUrl(
    'https://example.test/book?download#page=1',
    [],
    [{ url: 'https://example.test/book?download', title: 'Alternate key' }],
  );

  assert.equal(book?.title, 'Alternate key');
});

test('availabilitySourcesForBook returns metadata-only plus cached when needed', () => {
  const book = {
    title: 'Not available yet',
    readUrl: 'https://example.test/book.epub',
  };

  assert.deepEqual(
    availabilitySourcesForBook(book, true),
    ['Metadata only', 'Cached'],
  );
  assert.deepEqual(
    availabilityForBook(book, false),
    'Metadata only',
  );
});

test('sameLibraryBook matches md5 and libvaultMd5 across different key fields', () => {
  const md5 = 'a'.repeat(32);
  const fromShared = { libvaultMd5: md5 };
  const fromCatalog = { md5: md5.toUpperCase() };

  assert.equal(sameLibraryBook(fromShared, fromCatalog), true);
});

test('sameLibraryBook does not fall back to URL when both sides have distinct stable IDs', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), readUrl: 'https://example.test/book.epub' },
      { id: 'b'.repeat(32), url: 'https://example.test/book.epub' },
    ),
    false,
  );
});

test('bookIdentity uses explicit id when source-native id is absent', () => {
  assert.equal(
    bookIdentity({ id: 'catalog:123' }),
    'source:book:catalog:123',
  );
});

test('sameLibraryBook prioritizes stable IDs before URL matches', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), url: 'https://example.test/book.epub' },
      { id: 'b'.repeat(32), readUrl: 'https://example.test/book.epub' },
    ),
    false,
  );
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), id: 'source-1', url: 'https://example.test/book.epub' },
      { id: 'a'.repeat(32), md5: 'b'.repeat(32), url: 'https://example.test/book.epub' },
    ),
    true,
  );
});

test('isbnForBook keeps ISBN-10 check digit X normalization', () => {
  assert.equal(
    isbnForBook({ isbn10: '0-7475-3269-X' }),
    '074753269X',
  );
});

test('bookIdentity preserves md5 fallback ordering over URL and source', () => {
  assert.equal(
    bookIdentity({
      md5: 'a'.repeat(32),
      id: 'source:catalog:1',
      readUrl: 'https://example.test/book.epub',
      source: 'gutenberg',
      sourceNativeId: '54321',
    }),
    `id:${'a'.repeat(32)}`,
  );
});

test('bookIdentity defaults source label to book when source is absent but source-native id exists', () => {
  assert.equal(
    bookIdentity({ sourceNativeId: '54321' }),
    'source:book:54321',
  );
});

test('sortBooks keeps stable ordering for unknown key using title tiebreaker', () => {
  const books = [
    { title: 'B', year: '2020' },
    { title: 'A', year: '2022' },
  ];
  const sorted = sortBooks(books, 'non-existent');
  assert.deepEqual(sorted.map(book => book.title), ['A', 'B']);
});

test('isbnForBook prefers identifiers list over direct isbn fields', () => {
  assert.equal(
    isbnForBook({
      isbn: '1111111111111',
      identifiers: [{ type: 'isbn', value: '978-3-16-148410-0' }],
    }),
    '9783161484100',
  );
});

test('sameLibraryBook can match by legacy id field when md5 is absent', () => {
  assert.equal(
    sameLibraryBook(
      { id: 'source:book:54321' },
      { id: 'source:book:54321', readUrl: 'https://example.test/book.epub' },
    ),
    true,
  );
  assert.equal(
    sameLibraryBook(
      { id: 'source:book:54321' },
      { id: 'source:book:54322', readUrl: 'https://example.test/book.epub' },
    ),
    false,
  );
});

test('availabilitySourcesForBook treats /api/read urls as metadata-only', () => {
  assert.deepEqual(
    availabilitySourcesForBook({
      source: 'libvault',
      readUrl: 'https://books-api.guaka.org/api/read/' + 'a'.repeat(32),
    }),
    ['Metadata only'],
  );
});

test('availabilitySourcesForBook respects explicit blossom source hints', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'blossom-cdn', blossomSha256: 'abc' }),
    ['Blossom'],
  );
  assert.deepEqual(
    availabilitySourcesForBook({ source: 'blossom-cdn', blossomSha256: 'abc' }, true),
    ['Blossom', 'Cached'],
  );
});

test('enrichBookMetadata resolves Gutenberg read URL from source-native metadata', () => {
  const merged = enrichBookMetadata(
    {},
    { source: 'gutenberg', sourceNativeId: '30142', title: 'Remote metadata' },
    'gutenberg-search',
  );

  assert.equal(merged.readUrl, 'https://books-api.guaka.org/api/books/30142/download');
  assert.equal(merged.source, 'gutenberg');
  assert.equal(merged.metadataProvenance.readUrl, 'gutenberg-search');
});

test('bookIdentity supports source_native_id alias when source is present', () => {
  assert.equal(
    bookIdentity({ source: 'gutenberg', source_native_id: '54321' }),
    'source:gutenberg:54321',
  );
});

test('sameLibraryBook matches stable IDs even when URL differs', () => {
  assert.equal(
    sameLibraryBook(
      { id: 'source:book:54321', readUrl: 'https://example.test/book-a.epub' },
      { id: 'source:book:54321', readUrl: 'https://example.test/book-b.epub' },
    ),
    true,
  );
});

test('isbnForBook normalizes direct ISBN13 values and keeps checksum', () => {
  assert.equal(
    isbnForBook({ isbn13: '978 0 12 345 678 9 0' }),
    '97801234567890',
  );
});

test('availabilitySourcesForBook exposes blossom-only favorites as source list', () => {
  assert.deepEqual(
    availabilitySourcesForBook({
      blossomSha256: 'b'.repeat(64),
      title: 'Remote',
    }),
    ['Blossom'],
  );
});

test('sameLibraryBook uses id when both records supply identifiers, ignoring URL conflicts', () => {
  assert.equal(
    sameLibraryBook(
      { id: 'source:book:54321', url: 'https://example.test/book-a.epub' },
      { id: 'source:book:54321', md5: 'a'.repeat(32), url: 'https://example.test/book-b.epub' },
    ),
    true,
  );
});

test('availabilitySourcesForBook keeps Cached among metadata-only favorites', () => {
  assert.deepEqual(
    availabilitySourcesForBook({ title: 'Offline only', source: 'libvault' }, true),
    ['Metadata only', 'Cached'],
  );
});

test('sameLibraryBook normalizes and compares stable IDs with mixed casing', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'A'.repeat(32) },
      { libvaultMd5: 'a'.repeat(32) },
    ),
    true,
  );
});

test('availabilitySourcesForBook detects Gutenberg access via download query URLs', () => {
  assert.deepEqual(
    availabilitySourcesForBook({
      readUrl: 'https://books-api.guaka.org/api/books/48320/download?download=1',
      source: 'other',
    }),
    ['Gutenberg'],
  );
});

test('mergeLibraryState uses lastReadAt when updatedAt is not present', () => {
  const [entry] = mergeLibraryState(
    [
      {
        md5: 'a'.repeat(32),
        title: 'Last read only',
        lastReadAt: 777,
      },
    ],
    [],
  );

  assert.equal(entry.title, 'Last read only');
  assert.equal(entry.isReading, true);
  assert.equal(entry.readingUpdatedAt, 777);
});

test('findBookByReadUrl resolves from the first matching collection', () => {
  const reading = [{ md5: 'a'.repeat(32), readUrl: 'https://example.test/reading.epub', title: 'Reading' }];
  const favorites = [{ md5: 'a'.repeat(32), url: 'https://example.test/reading.epub', title: 'Favorite' }];

  const found = findBookByReadUrl('https://example.test/reading.epub', reading, favorites);
  assert.equal(found?.title, 'Reading');
});

test('resolveTitle treats placeholder filenames as missing metadata', () => {
  assert.equal(
    resolveTitle({ readUrl: 'https://example.test/download' }),
    'Untitled book',
  );
});

test('sameLibraryBook returns false when only titles overlap and no stable key exists', () => {
  assert.equal(
    sameLibraryBook(
      { title: 'Shared title', readUrl: 'https://example.test/book-a.epub' },
      { title: 'Shared title', readUrl: 'https://example.test/book-b.epub' },
    ),
    false,
  );
});

test('mergeLibraryState preserves a real author when incoming favorite title is placeholder', () => {
  const merged = mergeLibraryState(
    [
      {
        md5: 'a'.repeat(32),
        title: 'Real title',
        authors: 'Real Author',
        updatedAt: 100,
      },
    ],
    [
      {
        md5: 'a'.repeat(32),
        title: 'Untitled book',
        author: 'Placeholder Author',
        favoriteAddedAt: 150,
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Real title');
  assert.equal(merged[0].authors, 'Real Author');
});

test('metadataEndpointForReadUrl returns empty on parse errors', () => {
  assert.equal(metadataEndpointForReadUrl('://not-a-url'), '');
});

test('canonicalReadUrl preserves direct blossom URLs', () => {
  assert.equal(
    canonicalReadUrl({ blossomUrl: 'https://example.test/download' }),
    'https://example.test/download',
  );
});

test('canonicalReadUrl preserves unparseable fallback URLs', () => {
  assert.equal(
    canonicalReadUrl({ blossomUrl: '::://bad-url' }),
    '::://bad-url',
  );
});

test('metadataEndpointForReadUrl rejects non-canonical upload suffix casing', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/48320/DOWNLOAD?download=1'),
    '',
  );
});

test('normalizeReadUrl keeps malformed URLs unchanged when no base is present', () => {
  assert.equal(normalizeReadUrl('/books/relative.epub'), '/books/relative.epub');
  assert.equal(normalizeReadUrl('not a valid url'), 'not a valid url');
});

test('normalizeReadUrl clears fragments and resolves relative URLs with a base', () => {
  assert.equal(
    normalizeReadUrl('/local/reader.epub#chapter', 'https://books-api.guaka.org/library/index.html'),
    'https://books-api.guaka.org/local/reader.epub',
  );
});

test('sortBooks leaves unknown key sorting to title order fallback', () => {
  const books = [
    { title: 'Zulu', year: '2020' },
    { title: 'Alpha', year: '2024' },
    { title: 'Bravo', year: '2023' },
  ];

  const sorted = sortBooks(books, 'non-existent');
  assert.deepEqual(sorted.map(item => item.title), ['Alpha', 'Bravo', 'Zulu']);
});

test('sameLibraryBook normalizes URLs for equality regardless of hash fragments', () => {
  assert.equal(
    sameLibraryBook(
      { readUrl: 'https://example.test/book.epub#chapter-2' },
      { url: 'https://example.test/book.epub#section-5' },
    ),
    true,
  );
});

test('isbnForBook normalizes direct and identifier-based ISBN metadata', () => {
  assert.equal(
    isbnForBook({ isbn13: '978-1-2345-6789-0' }),
    '9781234567890',
  );
  assert.equal(
    isbnForBook({ identifiers: [{ type: 'isbn10', value: '0-670-03210-4' }], isbn: 'ignored' }),
    '0670032104',
  );
});

test('bookIdentity falls back to a normalized url when no other identity is available', () => {
  assert.equal(
    bookIdentity({ readUrl: 'https://example.test/books/Example%20Book.epub' }),
    'url:https://example.test/books/Example%20Book.epub',
  );
});

test('metadataEndpointForReadUrl returns empty string for unsupported endpoints', () => {
  assert.equal(
    metadataEndpointForReadUrl('https://books-api.guaka.org/api/books/abc/download'),
    '',
  );
});

test('resolveTitle uses nested source/book title before generic metadata candidates', () => {
  assert.equal(
    resolveTitle({
      source: {
        book: {
          title: 'Nested book title',
        },
      },
      metadata: {
        title: 'Generic metadata title',
        book: {
          title: 'Metadata nested title',
        },
      },
    }),
    'Nested book title',
  );
});

test('metadataEndpointForReadUrl ignores non-absolute or relative urls', () => {
  assert.equal(metadataEndpointForReadUrl('/api/books/48320/download'), '');
  assert.equal(metadataEndpointForReadUrl('not-a-url'), '');
});

test('enrichBookMetadata preserves an existing readUrl when incoming readUrl is a placeholder', () => {
  const enriched = enrichBookMetadata(
    {
      title: 'Existing readUrl',
      readUrl: 'https://example.test/current.epub',
      readUrlSource: 'existing',
      extension: 'epub',
    },
    {
      title: 'Untitled book',
      readUrl: 'https://example.test/new.epub',
      extension: 'pdf',
    },
    'provider',
  );

  assert.equal(enriched.readUrl, 'https://example.test/current.epub');
  assert.equal(enriched.readUrlSource, 'existing');
  assert.equal(enriched.extension, 'epub');
  assert.equal(enriched.title, 'Existing readUrl');
  assert.equal(enriched.metadataProvenance.title, undefined);
});

test('sameLibraryBook ignores URL mismatch when stable identifiers are present', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), readUrl: 'https://example.test/a.epub' },
      { md5: 'A'.repeat(32), readUrl: 'https://example.test/b.epub' },
    ),
    true,
  );
});

test('findBookByReadUrl ignores query and fragment differences when matching URLs', () => {
  const result = findBookByReadUrl(
    'https://example.test/book.epub?download=1',
    [{ readUrl: 'https://example.test/book.epub?download=0', title: 'Base copy' }],
  );
  assert.equal(result?.title, 'Base copy');
});

test('canonicalReadUrl keeps direct non-download api read path when legacy read path is not blocked', () => {
  assert.equal(
    canonicalReadUrl({ readUrl: 'https://books-api.guaka.org/api/books/999' }),
    'https://books-api.guaka.org/api/books/999',
  );
});

test('sameLibraryBook treats read URL and blossom URL as equivalent only when normalized values match', () => {
  assert.equal(
    sameLibraryBook(
      { blossomUrl: 'https://example.test/shared?token=1#frag' },
      { readUrl: 'https://example.test/shared?token=2', title: 'Ignored' },
    ),
    false,
  );
});

test('sameLibraryBook matches books by stable IDs before falling back to URL', () => {
  assert.equal(
    sameLibraryBook(
      { md5: 'a'.repeat(32), libvaultMd5: 'b'.repeat(32), readUrl: 'https://example.test/a.epub' },
      { md5: 'c'.repeat(32), readUrl: 'https://example.test/b.epub' },
    ),
    false,
  );
});

test('availabilitySourcesForBook returns unique source list for readUrl with query and cached state', () => {
  assert.deepEqual(
    availabilitySourcesForBook(
      {
        source: 'gutenberg',
        readUrl: 'https://books-api.guaka.org/api/books/48320/download?download=1',
      },
      true,
    ),
    ['Gutenberg', 'Cached'],
  );
});
