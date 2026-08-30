import assert from 'node:assert/strict';
import test from 'node:test';

function createMockElement(tagName, { ownerDocument } = {}) {
  const children = [];
  const classSet = new Set();
  const listeners = {};
  const style = {};
  const dataset = {};
  const rect = { top: 0, bottom: 0 };

  const classList = {
    add(name) {
      classSet.add(name);
      return this;
    },
    remove(name) {
      classSet.delete(name);
      return this;
    },
    contains(name) {
      return classSet.has(name);
    },
    get value() {
      return [...classSet].join(' ');
    },
  };

  const element = {
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
    set className(value) {
      classSet.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach(name => classSet.add(name));
    },
    get className() {
      return classList.value;
    },
    appendChild(child) {
      child.parentElement = element;
      children.push(child);
      return child;
    },
    replaceChildren() {
      children.length = 0;
    },
    addEventListener(name, listener) {
      (listeners[name] ||= []).push(listener);
    },
    click() {
      (listeners.click || []).forEach(listener => listener());
    },
    setAttribute(name, value) {
      element[name] = value;
    },
    getAttribute(name) {
      return element[name];
    },
    querySelector(selector) {
      if (selector === 'canvas') {
        return children.find(child => child.tagName === 'canvas');
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector !== '.pdf-page' && selector !== '[data-page]') return [];
      return children.filter(child => child.classList.contains('pdf-page'));
    },
    getContext() {
      return {};
    },
    getBoundingClientRect() {
      return rect;
    },
    setRect(top, bottom) {
      rect.top = top;
      rect.bottom = bottom;
    },
  };

  return element;
}

function setupPdfReaderEnvironment({ pdfPages = 3 } = {}) {
  const document = {
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
    getElementById(id) {
      return this._elementsById[id] || null;
    },
    registerElement(id, element) {
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

  const pages = document.getElementById('pages');
  const message = document.getElementById('message');
  const title = document.getElementById('title');
  const pageCount = document.getElementById('page-count');
  const zoomLabel = document.getElementById('zoom-label');
  const download = document.getElementById('download');
  const controls = {
    panel: document.getElementById('pdf-speech-controls'),
    play: document.getElementById('pdf-speech-play'),
    pause: document.getElementById('pdf-speech-pause'),
    stop: document.getElementById('pdf-speech-stop'),
  };

  for (const button of [controls.play, controls.pause, controls.stop, document.getElementById('zoom-out'), document.getElementById('zoom-in')]) {
    button.getContext = () => ({});
    button.disabled = false;
    button.textContent = '';
  }

  const progress = [];
  const speech = {
    createCalls: 0,
    startCalls: 0,
    pauseCalls: 0,
    resumeCalls: 0,
    stopCalls: 0,
    lastPlan: null,
    onStateChange: null,
  };
  speech.supported = true;
  speech.lastOptions = null;

  const createdObjectURLs = [];
  const revokedObjectURLs = [];

  const windowObject = globalThis;
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
  windowObject.addEventListener = (name, listener) => {
    (windowObject._events[name] ||= []).push(listener);
  };
  windowObject.requestAnimationFrame = (callback) => {
    setTimeout(callback, 0);
    return 1;
  };
  windowObject.__triggers = {
    trigger(name) {
      (windowObject._events[name] || []).forEach(listener => listener());
    },
  };
  windowObject.BookstrSpeech = {
    supported: true,
    normalizeLocale: (language) => String(language || 'en').replace(/_/g, '-').toLowerCase() === 'pt' ? 'pt-PT' : String(language || 'en'),
    buildPlan: (paragraphs) => {
      const text = Array.isArray(paragraphs) ? paragraphs.join(' ').trim() : '';
      const chunks = text ? [{ text, start: 0, pauseMs: 0 }] : [];
      speech.startCalls = 0;
      return { text, chunks, language: 'en' };
    },
    createPlayer: ({ onStateChange }) => {
      speech.createCalls += 1;
      speech.onStateChange = onStateChange;
      let state = 'stopped';
      return {
        supported: true,
        start(plan, options) {
          speech.startCalls += 1;
          speech.lastPlan = plan;
          speech.lastOptions = options;
          state = 'playing';
          if (typeof onStateChange === 'function') onStateChange('playing');
          return true;
        },
        pause() {
          speech.pauseCalls += 1;
          state = 'paused';
          if (typeof onStateChange === 'function') onStateChange('paused');
          return true;
        },
        resume() {
          speech.resumeCalls += 1;
          state = 'playing';
          if (typeof onStateChange === 'function') onStateChange('playing');
          return true;
        },
        stop() {
          speech.stopCalls += 1;
          state = 'stopped';
          if (typeof onStateChange === 'function') onStateChange('stopped');
          return true;
        },
      };
    },
  };
  windowObject.speechSynthesis = {
    cancel: () => {},
  };
  windowObject.SpeechSynthesisUtterance = function(text) {
    this.text = text;
    this.lang = '';
    this.rate = 0;
    this.onend = null;
    this.onerror = null;
  };

  windowObject.bookstrDesktop = {
    reportProgress: (payload) => {
      progress.push(payload);
    },
    onOpenReader: (callback) => {
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

  const intersectionObserverEntries = [];
  windowObject.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
    }
    observe(target) {
      this.targets.push(target);
      intersectionObserverEntries.push(target);
      const rect = target.getBoundingClientRect();
      this.callback([{ isIntersecting: true, target, boundingClientRect: rect }]);
    }
    unobserve(target) {
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
    zoomOutButton: document.getElementById('zoom-out'),
    zoomInButton: document.getElementById('zoom-in'),
    progress,
    speech,
    createdObjectURLs,
    revokedObjectURLs,
    intersectionObserverEntries,
  };
}

test('pdf-reader supports desktop payload normalization, rendering, and speech controls', async () => {
  const env = setupPdfReaderEnvironment();
  await import('../pdf-reader.js');
  const { PdfReaderTest } = env.window;

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
  assert.equal(env.progress.at(-1).cfi, 'page:1');

  await env.window.loadPdf({ ...prepared, initialCfi: 'page:3' });
  assert.equal(env.progress.at(-1).cfi, 'page:3');
  assert.equal(env.progress.at(-1).progression, 1);

  const firstUrl = env.createdObjectURLs[0].value;
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
  await env.window.__openReaderCallback({
    base64: 'VGVzdC1wZGY=',
    theme: 'sepia',
    filename: 'FromBridge.pdf',
    book: { md5: 'D'.repeat(32), title: 'Bridge title' },
  });
  assert.equal(forwardedCalls, 1);
  await env.window.__openReaderCallback({});
  assert.equal(forwardedCalls, 1);
  env.window.loadPdf = originalLoadPdf;

  assert.equal(env.progress.length > reportedBefore, true);
  assert.equal(env.speech.createCalls > 0, true);

  const progressBeforeScroll = env.progress.length;
  env.window.__triggers.trigger('scroll');
  env.window.__triggers.trigger('scroll');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(env.progress.length > progressBeforeScroll, true);

  env.controls.play.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(env.speech.startCalls, 1);
  assert.ok(env.speech.lastPlan?.chunks?.length > 0);
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

  const parentProgress = [];
  env.window.parent = {
    postMessage(payload, origin) {
      parentProgress.push({ payload, origin });
    },
  };
  env.window.__triggers.trigger('beforeunload');
  assert.equal(parentProgress.at(-1).payload.type, 'bookstr-reader-progress');
  assert.equal(parentProgress.at(-1).origin, 'app://bookstr');
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
  assert.equal(env.speech.lastOptions.rate, 1);
  assert.equal(env.speech.lastOptions.voiceIdentifier, 'portuguese-voice');
  env.controls.stop.click();

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

  await import('../pdf-reader.js?no-speech');
  const { PdfReaderTest } = env.window;
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
  await PdfReaderTest.renderPage(1, env.pages.children[0].querySelector('canvas'), -1);
  await assert.rejects(
    env.window.loadPdf({ base64: '%%%not-base64%%%' }),
    /Invalid character|invalid/i,
  );
  assert.match(env.message.textContent, /Could not display PDF/);
});
