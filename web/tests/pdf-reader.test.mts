import assert from 'node:assert/strict';
import test from 'node:test';

type MockRect = { top: number; bottom: number };
type MockElement = {
  [attribute: string]: unknown;
  tagName: string; ownerDocument?: MockDocument; children: MockElement[];
  style: Record<string, string>; dataset: Record<string, string>; classList: { add(name: string): unknown; remove(name: string): unknown; contains(name: string): boolean; readonly value: string };
  parentElement: MockElement | null; disabled: boolean; textContent: string; id: string; href: string; download: string; hidden?: boolean;
  className: string; appendChild(child: MockElement): MockElement; replaceChildren(): void;
  addEventListener(name: string, listener: () => void): void; click(): void;
  setAttribute(name: string, value: string): void; getAttribute(name: string): string | undefined;
  querySelector(selector: string): MockElement | null; querySelectorAll(selector: string): MockElement[];
  getContext(): unknown; getBoundingClientRect(): MockRect; setRect(top: number, bottom: number): void;
};
type MockDocument = {
  body: MockElement; hidden?: boolean; _elementsById: Record<string, MockElement>;
  createElement(tagName: string): MockElement; getElementById(id: string): MockElement | null;
  registerElement(id: string, element: MockElement): MockElement;
};
type SpeechPlan = { text: string; chunks: Array<{ text: string; start: number; pauseMs: number }>; language: string };
type PdfReaderTestApi = {
  normalizePdfPageProgress(page: number, count: number): number; pdfPageFromLocator(locator: unknown, count: number): number;
  clampProgress(value: unknown): number; setPdfSpeechState(state: string): void; hasPdfSpeechSupport(): boolean;
  normalizeDesktopBookMetadata(book: unknown): { title: string };
  normalizeDesktopReaderPayload(payload: unknown): { base64?: string; filename: string; theme?: string; book: Record<string, unknown>; readUrl?: string; initialCfi?: string } | null;
  bytesFromBase64(value: string): Uint8Array; reportPdfProgress(page: number): void; schedulePdfProgress(page: number): void;
  collectPdfSpeechPlan(): SpeechPlan; startPdfSpeech(): Promise<void> | void; pausePdfSpeech(): void; stopPdfSpeech(): void;
  renderPage(page: number, canvas: MockElement | null, scale: number): Promise<void>; renderPages(): Promise<void>; reportFlushProgress(): void;
};
type PdfTestWindow = {
  document: MockDocument; window: PdfTestWindow; parent: PdfTestWindow | { postMessage(payload: Record<string, unknown>, origin: string): void };
  location: { origin: string }; localStorage: { getItem(key: string): string | null };
  DOMMatrix: unknown; ImageData: unknown; Path2D: unknown; innerHeight: number; innerWidth: number; hidden: boolean;
  _events: Record<string, Array<() => void>>; __triggers: { trigger(name: string): void };
  addEventListener(name: string, listener: () => void): void; requestAnimationFrame(callback: () => void): number;
  BookstrSpeech?: {
    supported: boolean; normalizeLocale(language: unknown): string; buildPlan(paragraphs: unknown): SpeechPlan;
    createPlayer(options: { onStateChange(state: string): void }): {
      supported: boolean; start(plan: SpeechPlan, options: { language: string; rate: number; voiceIdentifier: string }): boolean;
      pause(): boolean; resume(): boolean; stop(): boolean;
    };
  };
  speechSynthesis?: { cancel(): void };
  SpeechSynthesisUtterance?: new (text: string) => { text: string; lang: string; rate: number; onend: (() => void) | null; onerror: (() => void) | null };
  bookstrDesktop?: { reportProgress(payload: Record<string, unknown>): void; onOpenReader(callback: (payload: unknown) => void): void } | null;
  __bookstrGetDocument?: () => { promise: Promise<{ numPages: number; getPage(): Promise<{ index: number; getTextContent(): Promise<{ items: Array<{ str: string }> }>; getViewport(): { width: number; height: number }; render(): { promise: Promise<void> } }>; destroy(): Promise<void> }> };
  __bookstrCreateObjectURL?: () => string; __bookstrRevokeObjectURL?: (value: string) => void;
  IntersectionObserver: new (callback: (entries: Array<{ isIntersecting: boolean; target: MockElement; boundingClientRect: MockRect }>) => void) => {
    callback: (entries: Array<{ isIntersecting: boolean; target: MockElement; boundingClientRect: MockRect }>) => void;
    targets: MockElement[]; observe(target: MockElement): void; unobserve(target: MockElement): void; disconnect(): void;
  };
  PdfReaderTest?: PdfReaderTestApi; loadPdf(options?: unknown): Promise<void>; __openReaderCallback?: (payload: unknown) => void;
  applyReaderSettings(settings?: Record<string, unknown> | null): void;
};

function createMockElement(tagName: string, { ownerDocument }: { ownerDocument?: MockDocument } = {}): MockElement {
  const children: MockElement[] = [];
  const classSet = new Set();
  const listeners: Record<string, Array<() => void>> = {};
  const style: Record<string, string> = {};
  const dataset: Record<string, string> = {};
  const rect: MockRect = { top: 0, bottom: 0 };

  const classList = {
    add(name: string) {
      classSet.add(name);
      return this;
    },
    remove(name: string) {
      classSet.delete(name);
      return this;
    },
    contains(name: string) {
      return classSet.has(name);
    },
    get value() {
      return [...classSet].join(' ');
    },
  };

  const element: MockElement = {
    tagName,
    ownerDocument,
    children,
    style,
    dataset,
    classList,
    parentElement: null,
    disabled: false,
    textContent: '',
    id: '',
    href: '',
    download: '',
    hidden: false,
    set className(value: string) {
      classSet.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach(name => classSet.add(name));
    },
    get className() {
      return classList.value;
    },
    appendChild(child: MockElement) {
      child.parentElement = element;
      children.push(child);
      return child;
    },
    replaceChildren() {
      children.length = 0;
    },
    addEventListener(name: string, listener: () => void) {
      (listeners[name] ||= []).push(listener);
    },
    click() {
      (listeners.click || []).forEach(listener => listener());
    },
    setAttribute(name: string, value: string) {
      element[name] = value;
    },
    getAttribute(name: string) {
      const value = element[name];
      return typeof value === 'string' ? value : undefined;
    },
    querySelector(selector: string) {
      if (selector === 'canvas') {
        return children.find(child => child.tagName === 'canvas') ?? null;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector !== '.pdf-page' && selector !== '[data-page]') return [];
      return children.filter(child => child.classList.contains('pdf-page'));
    },
    getContext() {
      return {};
    },
    getBoundingClientRect() {
      return rect;
    },
    setRect(top: number, bottom: number) {
      rect.top = top;
      rect.bottom = bottom;
    },
  };

  return element;
}

function setupPdfReaderEnvironment({ pdfPages = 3 }: { pdfPages?: number } = {}) {
  const document: MockDocument = {
    body: createMockElement('body'),
    _elementsById: {},
    createElement(tagName) {
      const element = createMockElement(tagName, { ownerDocument: document });
      if (tagName === 'canvas') {
        element.getContext = () => ({
          putImageData: () => {},
          drawImage: () => {},
          clearRect: () => {},
        });
      }
      return element;
    },
    getElementById(id: string) {
      return this._elementsById[id] || null;
    },
    registerElement(id: string, element: MockElement) {
      this._elementsById[id] = element;
      return element;
    },
  };

  document.body.dataset = {};

  const ids = [
    'pages',
    'message',
    'title',
    'page-count',
    'zoom-label',
    'download',
    'pdf-speech-controls',
    'pdf-speech-play',
    'pdf-speech-pause',
    'pdf-speech-stop',
    'zoom-out',
    'zoom-in',
  ];
  for (const id of ids) {
    const element = document.createElement('div');
    element.id = id;
    document.registerElement(id, element);
  }

  const requiredElement = (id: string): MockElement => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing PDF test element: ${id}`);
    return element;
  };
  const pages = requiredElement('pages');
  const message = requiredElement('message');
  const title = requiredElement('title');
  const pageCount = requiredElement('page-count');
  const zoomLabel = requiredElement('zoom-label');
  const download = requiredElement('download');
  const controls = {
    panel: requiredElement('pdf-speech-controls'),
    play: requiredElement('pdf-speech-play'),
    pause: requiredElement('pdf-speech-pause'),
    stop: requiredElement('pdf-speech-stop'),
  };

  for (const button of [controls.play, controls.pause, controls.stop, requiredElement('zoom-out'), requiredElement('zoom-in')]) {
    button.getContext = () => ({});
    button.disabled = false;
    button.textContent = '';
  }

  const progress: Array<Record<string, unknown>> = [];
  const speech: {
    createCalls: number; startCalls: number; pauseCalls: number; resumeCalls: number; stopCalls: number;
    lastPlan: SpeechPlan | null; lastOptions: { language: string; rate: number; voiceIdentifier: string } | null;
    onStateChange: ((state: string) => void) | null; supported: boolean;
  } = {
    createCalls: 0,
    startCalls: 0,
    pauseCalls: 0,
    resumeCalls: 0,
    stopCalls: 0,
    lastPlan: null,
    lastOptions: null,
    onStateChange: null,
    supported: true,
  };

  const createdObjectURLs: Array<{ value: string; blobLength: number }> = [];
  const revokedObjectURLs: string[] = [];

  const windowObject = globalThis as unknown as PdfTestWindow;
  windowObject.document = document;
  windowObject.window = windowObject;
  windowObject.parent = windowObject;
  windowObject.location = { origin: 'app://bookstr' };
  windowObject.localStorage = {
    getItem: (key) => key === 'bookstr_reader_settings_v1'
      ? JSON.stringify({ speechRate: 1.05, speechVoiceEnglish: 'kokoro-heart' })
      : null,
  };
  windowObject.DOMMatrix = class DOMMatrix {};
  windowObject.ImageData = class ImageData {};
  windowObject.Path2D = class Path2D {};
  windowObject.innerHeight = 900;
  windowObject.innerWidth = 1024;
  windowObject.hidden = false;
  windowObject._events = {};
  windowObject.addEventListener = (name: string, listener: () => void) => {
    (windowObject._events[name] ||= []).push(listener);
  };
  windowObject.requestAnimationFrame = (callback) => {
    setTimeout(callback, 0);
    return 1;
  };
  windowObject.__triggers = {
    trigger(name: string) {
      (windowObject._events[name] || []).forEach(listener => listener());
    },
  };
  windowObject.BookstrSpeech = {
    supported: true,
    normalizeLocale: (language: unknown) => String(language || 'en').replace(/_/g, '-').toLowerCase() === 'pt' ? 'pt-PT' : String(language || 'en'),
    buildPlan: (paragraphs: unknown) => {
      const text = Array.isArray(paragraphs) ? paragraphs.join(' ').trim() : '';
      const chunks = text ? [{ text, start: 0, pauseMs: 0 }] : [];
      speech.startCalls = 0;
      return { text, chunks, language: 'en' };
    },
    createPlayer: ({ onStateChange }: { onStateChange(state: string): void }) => {
      speech.createCalls += 1;
      speech.onStateChange = onStateChange;
      return {
        supported: true,
        start(plan: SpeechPlan, options: { language: string; rate: number; voiceIdentifier: string }) {
          speech.startCalls += 1;
          speech.lastPlan = plan;
          speech.lastOptions = options;
          if (typeof onStateChange === 'function') onStateChange('playing');
          return true;
        },
        pause() {
          speech.pauseCalls += 1;
          if (typeof onStateChange === 'function') onStateChange('paused');
          return true;
        },
        resume() {
          speech.resumeCalls += 1;
          if (typeof onStateChange === 'function') onStateChange('playing');
          return true;
        },
        stop() {
          speech.stopCalls += 1;
          if (typeof onStateChange === 'function') onStateChange('stopped');
          return true;
        },
      };
    },
  };
  windowObject.speechSynthesis = {
    cancel: () => {},
  };
  windowObject.SpeechSynthesisUtterance = class {
    text: string; lang = ''; rate = 0; onend: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor(text: string) { this.text = text; }
  };

  windowObject.bookstrDesktop = {
    reportProgress: (payload: Record<string, unknown>) => {
      progress.push(payload);
    },
    onOpenReader: (callback: (payload: unknown) => void) => {
      windowObject.__openReaderCallback = callback;
    },
  };

  let pageIndex = 1;
  windowObject.__bookstrGetDocument = () => ({
    promise: Promise.resolve({
      numPages: pdfPages,
      getPage: async () => ({
        index: pageIndex++,
        getTextContent: async () => ({ items: [{ str: `page ${pageIndex - 1}` }] }),
        getViewport: () => ({ width: 960, height: 1200 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
      destroy: async () => {},
    }),
  });

  windowObject.__bookstrCreateObjectURL = () => {
    const value = `blob://pdf-${createdObjectURLs.length + 1}`;
    createdObjectURLs.push({ value, blobLength: 1 });
    return value;
  };
  windowObject.__bookstrRevokeObjectURL = (value) => {
    revokedObjectURLs.push(value);
  };

  const intersectionObserverEntries: MockElement[] = [];
  windowObject.IntersectionObserver = class {
    callback: (entries: Array<{ isIntersecting: boolean; target: MockElement; boundingClientRect: MockRect }>) => void;
    targets: MockElement[] = [];
    constructor(callback: (entries: Array<{ isIntersecting: boolean; target: MockElement; boundingClientRect: MockRect }>) => void) {
      this.callback = callback;
    }
    observe(target: MockElement) {
      this.targets.push(target);
      intersectionObserverEntries.push(target);
      const rect = target.getBoundingClientRect();
      this.callback([{ isIntersecting: true, target, boundingClientRect: rect }]);
    }
    unobserve(target: MockElement) {
      this.targets = this.targets.filter(item => item !== target);
    }
    disconnect() {
      this.targets = [];
    }
  };

  return {
    document,
    window: windowObject,
    pages,
    message,
    title,
    pageCount,
    zoomLabel,
    download,
    controls,
    zoomOutButton: requiredElement('zoom-out'),
    zoomInButton: requiredElement('zoom-in'),
    progress,
    speech,
    createdObjectURLs,
    revokedObjectURLs,
    intersectionObserverEntries,
  };
}

function loadPdfReader(suffix = ''): Promise<unknown> {
  return import(new URL(`../pdf-reader.js${suffix}`, import.meta.url).href);
}

function requirePdfReaderTest(windowObject: PdfTestWindow): PdfReaderTestApi {
  const api = windowObject.PdfReaderTest;
  if (!api) throw new Error('PDF reader test API did not initialize');
  return api;
}

test('pdf-reader supports desktop payload normalization, rendering, and speech controls', async () => {
  const env = setupPdfReaderEnvironment();
  await loadPdfReader();
  const PdfReaderTest = requirePdfReaderTest(env.window);

  assert.ok(typeof PdfReaderTest.normalizeDesktopReaderPayload === 'function');
  const prepared = {
    base64: 'VGVzdC1wZGY=',
    filename: 'Bad:Name/Book.pdf',
    theme: 'solarized',
    readUrl: '/books/guide.pdf',
    book: {
      md5: 'A'.repeat(32),
      title: 'Reader title',
      authors: 'Author Name',
      year: 2024,
      source: 'gutenberg',
      sourceNativeId: '123',
      extension: 'pdf',
    },
  };

  assert.equal(PdfReaderTest.normalizePdfPageProgress(1, 1), 1);
  assert.equal(PdfReaderTest.normalizePdfPageProgress(1, 2), 0);
  assert.equal(PdfReaderTest.normalizePdfPageProgress(5, 2), 1);
  assert.equal(PdfReaderTest.clampProgress('1.7'), 1);
  assert.equal(PdfReaderTest.clampProgress(-2), 0);

  const readerPayload = PdfReaderTest.normalizeDesktopReaderPayload(prepared);
  assert.ok(readerPayload);
  assert.equal(readerPayload.filename, 'Bad Name Book.pdf');
  assert.equal(readerPayload.theme, 'solarized');
  assert.equal(readerPayload.book.extension, 'pdf');
  assert.equal(readerPayload.base64, 'VGVzdC1wZGY=');
  assert.equal(PdfReaderTest.pdfPageFromLocator('page:2', 3), 2);
  assert.equal(PdfReaderTest.pdfPageFromLocator('page:99', 3), 3);
  assert.equal(PdfReaderTest.pdfPageFromLocator('', 0), 1);
  assert.equal(PdfReaderTest.pdfPageFromLocator('not-a-page', 3), 1);

  const fallbackPayload = PdfReaderTest.normalizeDesktopReaderPayload({
    base64: 'VGVzdA==',
    book: { },
  });
  assert.ok(fallbackPayload);
  assert.equal(fallbackPayload.filename, 'Book.pdf');
  assert.deepEqual(PdfReaderTest.bytesFromBase64('dGVzdA=='), new Uint8Array([116, 101, 115, 116]));

  await env.window.loadPdf(prepared);

  assert.equal(env.message.classList.contains('hidden'), true);
  assert.equal(env.title.textContent, 'Reader title');
  assert.equal(env.download.href, 'blob://pdf-1');
  assert.equal(env.download.download, 'Bad Name Book.pdf');
  assert.equal(env.pageCount.textContent, '3 pages');
  assert.equal(env.window.document.body.dataset.theme, 'solarized');
  assert.equal(env.zoomLabel.textContent, '100%');
  assert.equal(env.progress.length >= 2, true);
  const firstProgress = env.progress.at(-1);
  assert.ok(firstProgress);
  assert.equal(firstProgress.cfi, 'page:1');

  await env.window.loadPdf({ ...prepared, initialCfi: 'page:3' });
  const lastProgress = env.progress.at(-1);
  assert.ok(lastProgress);
  assert.equal(lastProgress.cfi, 'page:3');
  assert.equal(lastProgress.progression, 1);

  const firstCreatedUrl = env.createdObjectURLs[0];
  assert.ok(firstCreatedUrl);
  const firstUrl = firstCreatedUrl.value;
  await env.window.loadPdf({
    ...prepared,
    filename: 'Reader-Second.pdf',
    base64: 'VGVzdC1wZGY=',
  });
  assert.equal(env.createdObjectURLs.length, 3);
  assert.equal(env.revokedObjectURLs.includes(firstUrl), true);

  const reportedBefore = env.progress.length;
  const originalLoadPdf = env.window.loadPdf;
  let forwardedCalls = 0;
  env.window.loadPdf = async (...args) => {
    forwardedCalls += 1;
    return originalLoadPdf(...args);
  };
  const openReaderCallback = env.window.__openReaderCallback;
  assert.ok(openReaderCallback);
  await openReaderCallback({
    base64: 'VGVzdC1wZGY=',
    theme: 'sepia',
    filename: 'FromBridge.pdf',
    book: { md5: 'D'.repeat(32), title: 'Bridge title' },
  });
  assert.equal(forwardedCalls, 1);
  await openReaderCallback({});
  assert.equal(forwardedCalls, 1);
  env.window.loadPdf = originalLoadPdf;

  assert.equal(env.progress.length > reportedBefore, true);
  assert.equal(env.speech.createCalls > 0, true);

  env.zoomOutButton.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(env.zoomLabel.textContent, '85%');
  env.zoomInButton.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(env.zoomLabel.textContent, '100%');

  const progressBeforeScroll = env.progress.length;
  env.window.__triggers.trigger('scroll');
  env.window.__triggers.trigger('scroll');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(env.progress.length > progressBeforeScroll, true);

  env.controls.play.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(env.speech.startCalls, 1);
  const lastPlan = env.speech.lastPlan;
  assert.ok(lastPlan && lastPlan.chunks.length > 0);
  assert.ok(env.speech.lastOptions);
  assert.deepEqual(env.speech.lastOptions, {
    language: 'en',
    rate: 1.05,
    voiceIdentifier: 'kokoro-heart',
  });

  const stopCallsBeforeSettings = env.speech.stopCalls;
  env.window.applyReaderSettings({
    speechRate: 1.1,
    speechVoiceEnglish: 'new-english-voice',
  });
  assert.equal(env.speech.stopCalls, stopCallsBeforeSettings + 1);
  env.controls.play.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(env.speech.lastOptions);
  assert.equal(env.speech.lastOptions.rate, 1.1);
  assert.equal(env.speech.lastOptions.voiceIdentifier, 'new-english-voice');

  env.controls.pause.click();
  assert.equal(env.speech.pauseCalls, 1);
  assert.equal(env.speech.onStateChange?.name, 'setPdfSpeechState');
  assert.equal(env.controls.pause.textContent, '▶');

  env.controls.pause.click();
  assert.equal(env.speech.resumeCalls, 1);
  const stopCallsBeforeClick = env.speech.stopCalls;
  env.controls.stop.click();
  assert.equal(env.speech.stopCalls, stopCallsBeforeClick + 1);

  const parentProgress: Array<{ payload: Record<string, unknown>; origin: string }> = [];
  env.window.parent = {
    postMessage(payload, origin) {
      parentProgress.push({ payload, origin });
    },
  };
  PdfReaderTest.reportPdfProgress(2);
  const parentProgressEntry = parentProgress.at(-1);
  assert.ok(parentProgressEntry);
  assert.equal(parentProgressEntry.payload.cfi, 'page:2');
  env.window.__triggers.trigger('beforeunload');
  const flushedProgress = parentProgress.at(-1);
  assert.ok(flushedProgress);
  assert.equal(flushedProgress.payload.type, 'bookstr-reader-progress');
  assert.equal(flushedProgress.origin, 'app://bookstr');
  env.window.parent = env.window;
  const bridgeProgressBeforePageHide = env.progress.length;
  env.window.__triggers.trigger('pagehide');
  assert.equal(env.progress.length, bridgeProgressBeforePageHide + 1);

  env.window.applyReaderSettings(null);
  env.window.applyReaderSettings();
  env.window.applyReaderSettings({ speechRate: 0, speechVoicePortuguese: 'portuguese-voice' });
  await env.window.loadPdf({
    ...prepared,
    book: { ...prepared.book, language: 'pt-PT' },
  });
  env.controls.play.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(env.speech.lastOptions);
  assert.equal(env.speech.lastOptions.rate, 1);
  assert.equal(env.speech.lastOptions.voiceIdentifier, 'portuguese-voice');
  env.controls.stop.click();

  const speechApi = env.window.BookstrSpeech;
  assert.ok(speechApi);
  const buildPlan = speechApi.buildPlan;
  speechApi.buildPlan = () => ({ text: '', chunks: [], language: 'en' });
  await PdfReaderTest.startPdfSpeech();
  assert.equal(env.controls.play.disabled, false);
  speechApi.buildPlan = buildPlan;

  PdfReaderTest.setPdfSpeechState('playing');
  env.document.hidden = true;
  const stopsBeforeVisibilityChange = env.speech.stopCalls;
  env.window.__triggers.trigger('visibilitychange');
  assert.equal(env.speech.stopCalls, stopsBeforeVisibilityChange + 1);
  env.document.hidden = false;

  assert.equal(env.controls.play.disabled, false);
  assert.equal(env.controls.pause.disabled, true);
});

test('pdf-reader remains usable without desktop speech support and reports load errors', async () => {
  const env = setupPdfReaderEnvironment({ pdfPages: 1 });
  env.window.BookstrSpeech = undefined;
  env.window.speechSynthesis = undefined;
  env.window.SpeechSynthesisUtterance = undefined;
  env.window.bookstrDesktop = null;
  env.window.localStorage = { getItem: () => '{invalid settings' };
  delete env.window.__bookstrCreateObjectURL;
  delete env.window.__bookstrRevokeObjectURL;

  await loadPdfReader('?no-speech');
  const PdfReaderTest = requirePdfReaderTest(env.window);
  assert.equal(PdfReaderTest.hasPdfSpeechSupport(), false);
  assert.equal(env.controls.panel.classList.contains('hidden'), true);
  assert.deepEqual(await PdfReaderTest.collectPdfSpeechPlan(), { text: '', chunks: [], language: 'en' });
  await PdfReaderTest.startPdfSpeech();
  PdfReaderTest.pausePdfSpeech();
  PdfReaderTest.stopPdfSpeech();
  assert.deepEqual(PdfReaderTest.normalizeDesktopReaderPayload(null), null);
  assert.equal(PdfReaderTest.normalizeDesktopReaderPayload({ base64: ' ' }), null);
  assert.equal(PdfReaderTest.normalizeDesktopBookMetadata(null).title, 'Book');
  assert.equal(PdfReaderTest.clampProgress(Infinity), 0);
  assert.equal(PdfReaderTest.normalizePdfPageProgress(0, 0), 1);
  assert.equal(PdfReaderTest.pdfPageFromLocator('page:not-number', 2), 1);

  await env.window.loadPdf({ base64: 'VGVzdA==', filename: 'fallback.pdf' });
  assert.equal(env.pageCount.textContent, '1 page');
  assert.match(env.download.href, /^blob:/);
  PdfReaderTest.reportPdfProgress(Number.NaN);
  PdfReaderTest.schedulePdfProgress(0);
  const firstPage = env.pages.children[0];
  assert.ok(firstPage);
  await PdfReaderTest.renderPage(1, firstPage.querySelector('canvas'), -1);
  await assert.rejects(
    env.window.loadPdf({ base64: '%%%not-base64%%%' }),
    /Invalid character|invalid/i,
  );
  assert.match(env.message.textContent, /Could not display PDF/);

  delete env.window.__bookstrGetDocument;
  await assert.rejects(
    env.window.loadPdf({ base64: 'VGVzdA==', filename: 'invalid.pdf' }),
    /PDF|document|header|format/i,
  );
});
