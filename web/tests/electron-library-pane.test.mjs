import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../book-metadata.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function loadFunction(name, next, values) {
  const start = html.indexOf(`      function ${name}(`);
  const end = html.indexOf(`      ${next}`, start + 1);
  const context = vm.createContext(values);
  vm.runInContext(html.slice(start, end), context);
  return context;
}

test('Electron library requires a verified readable local file', () => {
  const c = loadFunction('isBookReadableNow', 'function isBookSeeded', {
    isDesktopMode: true, cachedBookKeys: new Set(), bookCacheKey: () => 'cached',
    desktopDownloadForBook: book => book.job, BookMetadata: globalThis.BookMetadata,
    isBookSeeded: () => true, BOOKS_API_BASE: 'https://books.test',
  });
  assert.equal(c.isBookReadableNow({ job: { status: 'ready', readable: false } }), false);
  assert.equal(c.isBookReadableNow({ job: { status: 'failed', readable: true } }), true);
  assert.equal(c.isBookReadableNow({ readUrl: 'https://books.test/book.epub' }), false);
  c.isDesktopMode = false;
  assert.equal(c.isBookReadableNow({}), true);
});

test('Electron language filter displays names while retaining catalog values', () => {
  const c = loadFunction('configureSearchResultFilter', 'function filteredSearchResultBooks', {
    document: { createElement: () => ({}) },
  });
  const select = { items: [], replaceChildren() { this.items = []; }, appendChild(item) { this.items.push(item); } };
  const wrap = { classList: { toggle() {} } };
  assert.equal(c.configureSearchResultFilter(select, wrap, ['cat', 'en', 'fr'], 'All languages', 'cat', globalThis.BookMetadata.languageLabel), 'cat');
  assert.deepEqual(select.items.map(item => item.textContent), ['All languages', 'Catalan', 'English', 'French']);
  assert.equal(c.configureSearchResultFilter(select, wrap, ['pdf'], 'All formats', ''), '');
});

test('Electron metadata fallback routes to Downloads without building a details screen', () => {
  let opens = 0;
  const c = loadFunction('showReadMetadataFallback', 'function ', {
    isDesktopMode: true, isBookReadableNow: () => false, openDesktopDownloads: () => { opens += 1; },
    document: { getElementById() { throw new Error('Desktop must not build metadata details'); } },
  });
  c.showReadMetadataFallback({ title: 'Book' });
  assert.equal(opens, 1);
});

test('Downloads has a regular pane and library status is limited to its book count', () => {
  assert.match(html, /<section id="downloads-tab"[^>]*data-tab-panel="downloads"/);
  assert.doesNotMatch(html, /desktopDownloadsDialog|desktop-downloads-close/);
  assert.match(html, /homeLibraryCount\.textContent = isDesktopMode \? visibleCount/);
  assert.match(html, /desktopDownloadsSummary\.textContent = .*downloading.*seeding/);
  assert.match(html, /sendLibraryBookToKindle/);
  assert.match(html, /kindleSelectionDialog\.showModal\(\)/);
  assert.doesNotMatch(html, /desktopDownloadsList[\s\S]{0,1200}Send to Kindle/);
});


test('Library deduplicates saved editions that resolve to one local file and orders completions', () => {
  const jobs = [
    { bookId: 'new', title: 'New', readable: true, completedAt: 30 },
    { bookId: 'old', title: 'Old', readable: true, completedAt: 10 },
    { bookId: 'missing', title: 'Missing', readable: false, completedAt: 40 },
  ];
  const c = loadFunction('desktopReadableLibrary', 'function renderHome', {
    desktopDownloadByBook: new Map(jobs.map(job => [job.bookId, job])),
    BookMetadata: { dedupeLibraryBooks: books => books },
    bookFromDesktopDownload: job => ({ id: job.bookId, title: job.title }),
    desktopDownloadForBook: book => jobs.find(job => job.bookId === (book.id === 'saved-edition' ? 'old' : book.id)),
  });
  const books = c.desktopReadableLibrary([{ id: 'saved-edition', title: 'Saved title' }, { id: 'missing', title: 'Missing' }]);
  assert.deepEqual(Array.from(books, book => book.title), ['New', 'Saved title']);
});
