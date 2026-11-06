import { present } from './test-values.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../book-metadata.js';
import '../desktop-kindle.js';
import { functionSource } from './source-tools.mts';
import type { DesktopKindleApi } from '../src/desktop-kindle.js';
import type { BookMetadataApi } from '../src/book-metadata.js';

interface MockElement {
  dataset: Record<string, string>;
  attributes: Record<string, string | undefined>;
  children: MockElement[];
  classList: { remove(): void; toggle?(name: string, force?: boolean): void };
  setAttribute(key: string, value: string): void;
  removeAttribute(key: string): void;
  append(...items: MockElement[]): void;
  appendChild(item: MockElement): void;
  replaceChildren(...items: MockElement[]): void;
  querySelectorAll(): MockElement[];
  querySelector?(selector: string): MockElement | null;
  textContent?: string;
  innerHTML?: string;
  title?: string;
  disabled?: boolean;
  hidden?: boolean;
  value?: number;
}
interface KindleContextFixture {
  [key: string]: unknown;
  kindleTransferRunning: boolean;
  kindleLibraryButton: MockElement | null;
  kindleLibraryBookId: string;
  currentKindleId: string;
  kindleLibraryPresence: ReturnType<DesktopKindleApi['createLibraryPresence']>;
  kindleTransferOverview: ReturnType<DesktopKindleApi['createTransferOverview']>;
  kindleTransferPanel: MockElement;
  kindleTransferStatus: MockElement;
  kindleTransferCount: MockElement;
  kindleTransferProgress: MockElement;
  kindleTransferDismiss: MockElement;
  kindleTransferItems: MockElement;
  kindlePresenceRequest: unknown;
  homeReadingList: { querySelectorAll(): MockElement[] };
  desktopKindleSummary: { textContent: string };
  desktopKindleOffer: { classList: { remove(): void } };
  desktopDownloadForBook(book: Record<string, unknown>): unknown;
  desktopBridge: { kindle: {
    devices(): Promise<Array<{ id: string }>>;
    transfer(...args: unknown[]): Promise<{ transferred: string[]; alreadyPresent?: number; errors?: Array<{ error: string }> }>;
    presence?: () => Promise<{ bookIds: string[] }>;
  } };
  sendLibraryBookToKindle(book: Record<string, unknown>, button: MockElement): Promise<void>;
  refreshKindleLibraryButtons(): void;
  refreshKindlePresence(): Promise<void>;
  updateKindleLibraryButton(button: MockElement): void;
  renderKindleTransferOverview(): void;
}

const desktopKindle = (globalThis as typeof globalThis & { BookstrDesktopKindle: DesktopKindleApi }).BookstrDesktopKindle;
const bookMetadata = (globalThis as typeof globalThis & { BookMetadata: BookMetadataApi }).BookMetadata;
function fixture<T>(value: unknown): T { return value as T; }

function element(): MockElement {
  return { dataset: {}, attributes: {}, children: [], classList: { remove() {} },
    setAttribute(key: string, value: string) { this.attributes[key] = value; },
    removeAttribute(key: string) { delete this.attributes[key]; },
    append(...items: MockElement[]) { this.children.push(...items); },
    appendChild(item: MockElement) { this.children.push(item); },
    querySelectorAll() { return []; },
    replaceChildren(...items: MockElement[]) { this.children = items; } };
}
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
interface KindleTestOptions {
  job?: { status: string; extension: string; bookId: string } | null;
  devices?: Array<{ id: string }>;
  result?: { transferred: string[]; alreadyPresent?: number; errors: Array<{ error: string }> };
  failure?: unknown;
}
function kindleContext({ job = { status: 'ready', extension: 'cbz', bookId: 'comic' }, devices = [{ id: 'kindle' }], result = { transferred: ['comic'], alreadyPresent: 0, errors: [] }, failure }: KindleTestOptions = {}): { context: KindleContextFixture; button: MockElement; calls: unknown[][]; buttons: MockElement[] } {
  const button: MockElement = { ...element(), dataset: { kindleBookId: 'comic' }, disabled: false };
  const calls: unknown[][] = [];
  const buttons = [button];
  const rawContext = vm.createContext({
    kindleTransferRunning: false, kindleLibraryButton: null, kindleLibraryBookId: '', currentKindleId: 'kindle',
    kindleLibraryPresence: desktopKindle.createLibraryPresence(),
    kindleTransferOverview: desktopKindle.createTransferOverview(),
    kindleTransferPanel: element(), kindleTransferStatus: element(), kindleTransferCount: element(),
    kindleTransferProgress: element(), kindleTransferDismiss: element(), kindleTransferItems: element(),
    document: { createElement: element },
    kindlePresenceRequest: null, homeReadingList: { querySelectorAll: () => buttons },
    desktopKindleSummary: { textContent: '' }, desktopKindleOffer: { classList: { remove() {} } },
    desktopDownloadForBook: () => job, BookstrDesktopKindle: desktopKindle,
    desktopBridge: { kindle: { devices: async () => devices, transfer: async (...args: unknown[]) => {
      calls.push(args);
      if (failure !== undefined) throw failure;
      return result;
    } } },
  });
  const kindleFunctions = ['updateKindleLibraryButton', 'refreshKindleLibraryButtons', 'refreshKindlePresence',
    'renderKindleTransferOverview', 'sendLibraryBookToKindle'];
  vm.runInContext(kindleFunctions.map(name => functionSource(html, name)).join('\n'), rawContext);
  const context = rawContext as unknown as KindleContextFixture;
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
  assert.equal(present(present(context.kindleTransferItems.children[0]).children[0]).textContent, 'Comic');
  assert.equal(context.kindleTransferDismiss.disabled, false);
  assert.equal(context.kindleLibraryButton, null);
  assert.equal(context.kindleTransferRunning, false);
});

test('Library Kindle action handles duplicates, errors, absent devices and unsupported books visibly', async () => {
  const cases: Array<[KindleTestOptions, string, string]> = [
    [{ result: { transferred: [], alreadyPresent: 1, errors: [] } }, 'Already on Kindle', 'On Kindle'],
    [{ result: { transferred: [], alreadyPresent: 0, errors: [{ error: 'No space' }] } }, 'No space', 'Retry'],
    [{ result: { transferred: [], alreadyPresent: 0, errors: [] } }, 'Could not copy to Kindle', 'Retry'],
    [{ failure: new Error('Disconnected') }, 'Disconnected', 'Retry'],
    [{ failure: 'USB error' }, 'USB error', 'Retry'],
    [{ devices: [] }, 'No Kindle connected.', 'Retry'],
    [{ job: null }, 'This book cannot be sent to Kindle.', 'Retry'],
    [{ job: { status: 'ready', extension: 'epub', bookId: 'comic' } }, 'This book cannot be sent to Kindle.', 'Retry'],
  ];
  for (const [options, expected, label] of cases) {
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
  const button: MockElement = { ...element() };
  const context = loadFunction('renderKindleProgress', 'desktopBridge?.kindle?.onProgress', {
    kindleTransferRunning: true, kindleLibraryButton: button,
    kindleTransferOverview: { update() {} }, renderKindleTransferOverview() {}, desktopKindleSummary: { textContent: '' },
    BookstrDesktopKindle: desktopKindle,
  }) as unknown as vm.Context & { renderKindleProgress(progress: unknown): void; kindleTransferRunning: boolean; kindleLibraryButton: MockElement | null; desktopKindleSummary: { textContent: string } };
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
function loadFunction<T extends object>(name: string, _next: string, values: T): T & vm.Context {
  const context = vm.createContext(values);
  vm.runInContext(functionSource(html, name), context, { filename: `bookstr-function:${name}` });
  return context as T & vm.Context;
}

test('Library titles keep disabled formats as metadata across routing and callback modes', () => {
  function node() {
    return { ...element(), appendChild(child: MockElement) { this.children.push(child); },
      addEventListener() {}, querySelector() { return null; } };
  }
  const formats = loadFunction('isDisabledBookFormat', '', {});
  const c = loadFunction('renderBookTable', '', {
    document: { createElement: node }, cachedBookKeys: new Set(), bookCacheKey: () => '',
    isDesktopMode: false, isDisabledBookFormat: formats.isDisabledBookFormat,
    BookMetadata: bookMetadata, authorSearchName: () => '',
    torrentStatusForBook: () => '', torrentStatusClass: () => '',
    isBookReadableNow: () => false, escapeHtml: String, DICTIONARY_LANGUAGES: {},
    bookCoverUrls: () => [], CoverAssets: { placeholderCoverUrl: () => '', attachImageFallback() {} },
    isLibraryBook: () => true, rightsMarkerMarkup: () => '', readRouteValue: () => 'book',
  });
  for (const options of [{ routeOnly: true }, { canOpen: () => true }, { onOpen() {} }, { canOpen: () => false }, {}]) {
    for (const format of [{ extension: 'mobi' }, { extension: 'epub' }, { format: 'mobi' }, { format: 'epub' }]) {
      const target = node();
      c.renderBookTable(target, [{ title: 'Saved book', ...format }], options);
      const markup = present(present(target.children[0]).children[1]).innerHTML || '';
      const expectedLink = (format.extension || format.format) === 'epub' && Boolean(options.routeOnly || options.onOpen || options.canOpen?.());
      assert.equal(markup.includes('data-action="open"'), expectedLink);
      assert.ok(markup.includes('Saved book'));
    }
  }
});

test('legacy saved MOBI formats survive normalization without restoring guessed EPUB formats', () => {
  const formats = loadFunction('isDisabledBookFormat', '', {});
  const c = loadFunction('normalizeFavoriteFromRemote', '', {
    isDisabledBookFormat: formats.isDisabledBookFormat, BookMetadata: bookMetadata,
    BOOKS_API_BASE: 'https://books.test', window: { location: { href: 'https://books.test' } },
    normalizeSha256: () => '', isMd5: () => true,
  });
  const fixtures: Array<[Record<string, unknown>, string]> = [
    [{ extension: 'mobi' }, 'mobi'], [{ format: '.MOBI' }, 'mobi'],
    [{ extension: 'epub' }, ''],
    [{ extension: 'pdf', metadataProvenance: { extension: 'detected-local' } }, 'pdf'],
  ];
  for (const [ref, expected] of fixtures) {
    const normalized = c.normalizeFavoriteFromRemote({ ...ref, md5: 'a'.repeat(32), title: 'Saved' }, { trustExplicitFormat: false });
    assert.equal(normalized.extension, expected);
  }
  assert.equal(c.normalizeFavoriteFromRemote({ md5: 'a'.repeat(32), extension: 'epub' }).extension, 'epub');
});

test('Electron library requires a verified readable local file', () => {
  const formatContext = loadFunction('isDisabledBookFormat', 'function normalizeSearchBooks', {});
  const c = loadFunction('isBookReadableNow', 'function isBookSeeded', {
    isDesktopMode: true, cachedBookKeys: new Set(), bookCacheKey: () => 'cached',
    desktopDownloadForBook: (book: Record<string, unknown>) => book.job, BookMetadata: bookMetadata,
    isBookSeeded: () => true, BOOKS_API_BASE: 'https://books.test',
    isDisabledBookFormat: formatContext.isDisabledBookFormat,
  });
  assert.equal(c.isBookReadableNow({ job: { status: 'ready', readable: false } }), false);
  assert.equal(c.isBookReadableNow({ job: { status: 'failed', readable: true } }), true);
  assert.equal(c.isBookReadableNow({ extension: 'mobi', job: { readable: true } }), false);
  assert.equal(c.isBookReadableNow({ readUrl: 'https://books.test/book.epub' }), false);
  c.isDesktopMode = false;
  assert.equal(c.isBookReadableNow({}), true);
});

test('Electron language filter displays names while retaining catalog values', () => {
  const c = loadFunction('configureSearchResultFilter', 'function filteredSearchResultBooks', {
    document: { createElement: () => ({}) },
  });
  const select: { items: Array<{ textContent?: string }>; replaceChildren(): void; appendChild(item: { textContent?: string }): void } = {
    items: [], replaceChildren() { this.items = []; }, appendChild(item) { this.items.push(item); },
  };
  const wrap = { classList: { toggle() {} } };
  assert.equal(c.configureSearchResultFilter(select, wrap, ['cat', 'en', 'fr'], 'All languages', 'cat', bookMetadata.languageLabel), 'cat');
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
    BookMetadata: { dedupeLibraryBooks: (books: Array<Record<string, unknown>>) => books },
    bookFromDesktopDownload: (job: { bookId: string; title: string }) => ({ id: job.bookId, title: job.title }),
    desktopDownloadForBook: (book: { id: string }) => jobs.find(job => job.bookId === (book.id === 'saved-edition' ? 'old' : book.id)),
  });
  const books = fixture<Array<{ title: string }>>(c.desktopReadableLibrary([{ id: 'saved-edition', title: 'Saved title' }, { id: 'missing', title: 'Missing' }]));
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
  let resolve: (result: { bookIds: string[] }) => void = () => {};
  let calls = 0;
  context.desktopBridge.kindle.presence = () => { calls++; return new Promise<{ bookIds: string[] }>(done => { resolve = done; }); };
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
  const main = fs.readFileSync(new URL('../../desktop/src/main.ts', import.meta.url), 'utf8');
  const source = present(main.split('\n').find(line => line.includes("ipcMain.handle('bookstr-desktop-kindle-presence'")));
  let handler: ((event: unknown, id?: string) => unknown) | undefined;
  const ids: string[] = [];
  vm.runInNewContext(source, { ipcMain: { handle(name: string, callback: (event: unknown, id?: string) => unknown) { assert.equal(name, 'bookstr-desktop-kindle-presence'); handler = callback; } }, getKindleSync: () => ({ presence: (id: string) => { ids.push(id); return Promise.resolve({ bookIds: [] }); } }) });
  await present(handler)({}, 'kindle');
  await present(handler)({}, undefined);
  assert.deepEqual(ids, ['kindle', '']);
  const preload = fs.readFileSync(new URL('../../desktop/src/preload.ts', import.meta.url), 'utf8');
  const method = present(present(preload.match(/presence\(id\) \{[^}]+\}/))[0]);
  const ipcRenderer = { invoke: (...args: unknown[]) => args };
  const context = vm.createContext({ ipcRenderer, electron_1: { ipcRenderer } });
  const bridge = fixture<{ presence(id: string): unknown[] }>(vm.runInContext(`({ ${method} })`, context));
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

test('inactive download rows expose an accessible icon beside Retry', () => {
  const renderer = functionSource(html, 'renderDesktopDownloads');
  assert.match(renderer, /\['failed', 'stopped'\]\.includes\(jobStatus\)/);
  assert.match(renderer, /remove\.setAttribute\('aria-label', `Delete \$\{job.title \|\| 'book'\} from Downloads`\)/);
  assert.match(renderer, /remove\.innerHTML = '<svg[^\n]*aria-hidden="true"/);
  assert.match(renderer, /actions\.append\(retry, remove\)/);
  assert.match(renderer, /desktopBridge\.library\.removeDownload\(job.bookId\)/);
});

test('an old Downloads snapshot cannot overwrite a newer render', async () => {
  let resolveOld: (value: unknown) => void = () => {};
  let requests = 0;
  let renders = 0;
  const context = vm.createContext({
    isDesktopMode: true, desktopDownloadsRenderGeneration: 0,
    desktopDownloadEntryNeedsSnapshot: false, desktopHiddenCompletedIds: new Set(),
    desktopDownloadsNotice: { textContent: 'Loading' },
    desktopDownloadsList: { replaceChildren() { renders++; } },
    desktopBridge: { library: { downloads() {
      if (++requests === 1) return new Promise<unknown>(resolve => { resolveOld = resolve; });
      return Promise.resolve([]);
    } } },
  });
  vm.runInContext(functionSource(html, 'renderDesktopDownloads'), context);
  const old = context.renderDesktopDownloads();
  await context.renderDesktopDownloads();
  assert.equal(renders, 1);
  resolveOld([]);
  await old;
  assert.equal(renders, 1);
});

test('Library Kindle actions are hidden until a device is connected', () => {
  const { context, button } = kindleContext();
  context.currentKindleId = '';
  context.updateKindleLibraryButton(button);
  assert.equal(button.hidden, true);
  context.currentKindleId = 'kindle';
  context.updateKindleLibraryButton(button);
  assert.equal(button.hidden, false);
  context.currentKindleId = '';
  context.refreshKindleLibraryButtons();
  assert.equal(button.hidden, true);
});
