import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../book-metadata.js';
import '../desktop-kindle.js';

function element() {
  return { dataset: {}, attributes: {}, children: [], classList: { remove() {} },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; } };
}
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function kindleContext({ job = { status: 'ready', extension: 'cbz', bookId: 'comic' }, devices = [{ id: 'kindle' }], result = { transferred: ['comic'], alreadyPresent: 0, errors: [] }, failure } = {}) {
  const button = { dataset: { kindleBookId: 'comic' }, disabled: false, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } };
  const calls = [];
  const buttons = [button];
  const context = vm.createContext({
    kindleTransferRunning: false, kindleLibraryButton: null, kindleLibraryBookId: '', currentKindleId: 'kindle',
    kindleLibraryPresence: globalThis.BookstrDesktopKindle.createLibraryPresence(),
    kindleTransferOverview: globalThis.BookstrDesktopKindle.createTransferOverview(),
    kindleTransferPanel: element(), kindleTransferStatus: element(), kindleTransferCount: element(),
    kindleTransferProgress: element(), kindleTransferDismiss: element(), kindleTransferItems: element(),
    document: { createElement: element },
    kindlePresenceRequest: null, homeReadingList: { querySelectorAll: () => buttons },
    desktopKindleSummary: { textContent: '' }, desktopKindleOffer: { classList: { remove() {} } },
    desktopDownloadForBook: () => job, BookstrDesktopKindle: globalThis.BookstrDesktopKindle,
    desktopBridge: { kindle: { devices: async () => devices, transfer: async (...args) => {
      calls.push(args);
      if (failure !== undefined) throw failure;
      return result;
    } } },
  });
  const start = html.indexOf('      function updateKindleLibraryButton(');
  const end = html.indexOf('      async function renderDesktopDownloads(', start);
  vm.runInContext(html.slice(start, end), context);
  return { context, button, calls, buttons };
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
  assert.equal(button.textContent, 'On Kindle');
  assert.equal(button.disabled, false);
  assert.equal(button.attributes['aria-busy'], undefined);
  assert.equal(context.desktopKindleSummary.textContent, 'Copied to Kindle');
  assert.equal(context.kindleTransferStatus.textContent, '1 copied · 0 already there · 0 skipped · 0 failed');
  assert.equal(context.kindleTransferItems.children[0].children[0].textContent, 'Comic');
  assert.equal(context.kindleTransferDismiss.disabled, false);
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
    kindleTransferRunning: true, kindleLibraryButton: button,
    kindleTransferOverview: { update() {} }, renderKindleTransferOverview() {}, desktopKindleSummary: { textContent: '' },
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


test('Kindle presence survives row replacement, filtering, device polling and late snapshots', async () => {
  const { context, button, buttons } = kindleContext();
  const stale = context.kindleLibraryPresence.begin('kindle');
  await context.sendLibraryBookToKindle({ title: 'Comic' }, button);
  assert.equal(context.kindleLibraryPresence.apply(stale, []), false);
  const replacement = { ...button, dataset: { ...button.dataset }, attributes: {} };
  buttons.splice(0, 1, replacement);
  context.refreshKindleLibraryButtons();
  assert.equal(replacement.textContent, 'On Kindle');
  context.currentKindleId = 'different';
  context.refreshKindleLibraryButtons();
  assert.equal(replacement.textContent, 'Send to Kindle');
  context.currentKindleId = 'kindle';
  context.refreshKindleLibraryButtons();
  assert.equal(replacement.textContent, 'On Kindle');
});

test('presence lookup is optional, coalesced and never lets an old device update the current rows', async () => {
  const { context, button } = kindleContext();
  await context.refreshKindlePresence();
  let resolve;
  let calls = 0;
  context.desktopBridge.kindle.presence = () => { calls++; return new Promise(done => { resolve = done; }); };
  const pending = context.refreshKindlePresence();
  await context.refreshKindlePresence();
  assert.equal(calls, 1);
  resolve({ bookIds: ['comic'] });
  await pending;
  assert.equal(button.textContent, 'On Kindle');
  const oldDevice = context.refreshKindlePresence();
  context.currentKindleId = 'different';
  resolve({ bookIds: [] });
  await oldDevice;
  context.desktopBridge.kindle.presence = async () => { throw new Error('Disconnected'); };
  await context.refreshKindlePresence();
  context.currentKindleId = '';
  await context.refreshKindlePresence();
});


test('Kindle presence IPC only forwards a normalized device ID', async () => {
  const main = fs.readFileSync(new URL('../../desktop/main.js', import.meta.url), 'utf8');
  const source = main.split('\n').find(line => line.includes("ipcMain.handle('bookstr-desktop-kindle-presence'"));
  let handler;
  const ids = [];
  vm.runInNewContext(source, { ipcMain: { handle(name, callback) { assert.equal(name, 'bookstr-desktop-kindle-presence'); handler = callback; } }, getKindleSync: () => ({ presence: id => { ids.push(id); return Promise.resolve({ bookIds: [] }); } }) });
  await handler({}, 'kindle');
  await handler({}, undefined);
  assert.deepEqual(ids, ['kindle', '']);
  const preload = fs.readFileSync(new URL('../../desktop/preload.js', import.meta.url), 'utf8');
  const method = preload.match(/presence\(id\) \{[^}]+\}/)[0];
  const ipcRenderer = { invoke: (...args) => args };
  const context = vm.createContext({ ipcRenderer, electron_1: { ipcRenderer } });
  const bridge = vm.runInContext(`({ ${method} })`, context);
  assert.deepEqual(Array.from(bridge.presence('kindle')), ['bookstr-desktop-kindle-presence', 'kindle']);
});


test('Kindle overview renders determinate progress and stays available after errors', () => {
  const { context } = kindleContext();
  context.kindleTransferOverview.start([{ bookId: 'comic', title: 'Comic' }]);
  context.kindleTransferOverview.update({ phase: 'converting', bookId: 'comic', page: 3, pages: 10 });
  context.renderKindleTransferOverview();
  assert.equal(context.kindleTransferProgress.value, 30);
  assert.equal(context.kindleTransferCount.textContent, '0 / 1 copied');
  assert.equal(context.kindleTransferDismiss.disabled, true);
  context.kindleTransferOverview.fail(new Error('Disconnected'));
  context.renderKindleTransferOverview();
  assert.equal(context.kindleTransferStatus.textContent, 'Disconnected');
  assert.equal(context.kindleTransferProgress.hidden, true);
  assert.equal(context.kindleTransferDismiss.disabled, false);
});
