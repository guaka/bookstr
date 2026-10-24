import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../book-metadata.js';
import '../desktop-kindle.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function kindleContext({ job = { status: 'ready', extension: 'cbz', bookId: 'comic' }, devices = [{ id: 'kindle' }], result = { transferred: ['comic'], alreadyPresent: 0, errors: [] }, failure } = {}) {
  const button = { disabled: false, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } };
  const calls = [];
  const context = vm.createContext({
    kindleTransferRunning: false, kindleLibraryButton: null, currentKindleId: 'kindle',
    desktopKindleSummary: { textContent: '' }, desktopKindleOffer: { classList: { remove() {} } },
    desktopDownloadForBook: () => job, BookstrDesktopKindle: globalThis.BookstrDesktopKindle,
    desktopBridge: { kindle: { devices: async () => devices, transfer: async (...args) => {
      calls.push(args);
      if (failure !== undefined) throw failure;
      return result;
    } } },
  });
  const start = html.indexOf('      async function sendLibraryBookToKindle(');
  const end = html.indexOf('      async function renderDesktopDownloads(', start);
  vm.runInContext(html.slice(start, end), context);
  return { context, button, calls };
}

test('Library Kindle action shows busy state and reports success beside the library', async () => {
  const { context, button, calls } = kindleContext();
  const pending = context.sendLibraryBookToKindle({ title: 'Comic' }, button);
  assert.equal(button.textContent, 'Sending…');
  assert.equal(button.disabled, true);
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.equal(context.kindleLibraryButton, button);
  await pending;
  assert.deepEqual(calls, [['kindle', 'comic']]);
  assert.equal(button.textContent, 'Sent');
  assert.equal(button.disabled, false);
  assert.equal(button.attributes['aria-busy'], undefined);
  assert.equal(context.desktopKindleSummary.textContent, 'Copied to Kindle');
  assert.equal(context.kindleLibraryButton, null);
  assert.equal(context.kindleTransferRunning, false);
});

test('Library Kindle action handles duplicates, errors, absent devices and unsupported books visibly', async () => {
  for (const [options, expected, label] of [
    [{ result: { transferred: [], alreadyPresent: 1, errors: [] } }, 'Already on Kindle', 'On Kindle'],
    [{ result: { transferred: [], alreadyPresent: 0, errors: [{ error: 'No space' }] } }, 'No space', 'Retry'],
    [{ result: { transferred: [], alreadyPresent: 0, errors: [] } }, 'Could not copy to Kindle', 'Retry'],
    [{ failure: new Error('Disconnected') }, 'Disconnected', 'Retry'],
    [{ failure: 'USB error' }, 'USB error', 'Retry'],
    [{ devices: [] }, 'No Kindle connected.', 'Retry'],
    [{ job: null }, 'This book cannot be sent to Kindle.', 'Retry'],
    [{ job: { status: 'ready', extension: 'epub' } }, 'This book cannot be sent to Kindle.', 'Retry'],
  ]) {
    const { context, button } = kindleContext(options);
    context.currentKindleId = 'other';
    await context.sendLibraryBookToKindle({}, button);
    assert.equal(context.desktopKindleSummary.textContent, expected);
    assert.equal(button.textContent, label);
    assert.equal(button.title, expected);
    assert.equal(button.attributes['aria-description'], expected);
    assert.equal(button.disabled, false);
  }
  const { context, button, calls } = kindleContext();
  context.kindleTransferRunning = true;
  await context.sendLibraryBookToKindle({}, button);
  assert.equal(calls.length, 0);
});

test('Kindle progress updates the Library action and ignores late completion events', () => {
  const button = {};
  const context = loadFunction('renderKindleProgress', 'desktopBridge?.kindle?.onProgress', {
    kindleTransferRunning: true, kindleLibraryButton: button, desktopKindleSummary: { textContent: '' },
    BookstrDesktopKindle: globalThis.BookstrDesktopKindle,
  });
  context.renderKindleProgress({ phase: 'converting', page: 1, pages: 20 });
  assert.equal(button.title, 'Converting · 1/20 pages');
  assert.equal(context.desktopKindleSummary.textContent, button.title);
  context.kindleLibraryButton = null;
  context.renderKindleProgress({ phase: 'checking' });
  assert.equal(context.desktopKindleSummary.textContent, 'Checking existing books');
  context.renderKindleProgress({ done: true });
  context.kindleTransferRunning = false;
  context.renderKindleProgress({ phase: 'verifying' });
  assert.equal(context.desktopKindleSummary.textContent, 'Checking existing books');
});
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
