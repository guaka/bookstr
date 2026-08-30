import { getDocument, GlobalWorkerOptions } from './vendor/pdfjs/pdf.mjs';

GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.mjs';

const resolvePdfDocument = (...args) => {
  const resolver = globalThis.__bookstrGetDocument;
  if (typeof resolver === 'function') return resolver(...args);
  return getDocument(...args);
};

const createPdfObjectURL = value => {
  const createObjectURL = globalThis.__bookstrCreateObjectURL;
  if (typeof createObjectURL === 'function') return createObjectURL(value);
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
  return URL.createObjectURL(value);
};

const revokePdfObjectURL = value => {
  const revoke = globalThis.__bookstrRevokeObjectURL;
  if (typeof revoke === 'function') return revoke(value);
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') return URL.revokeObjectURL(value);
};

const pages = document.getElementById('pages');
const message = document.getElementById('message');
const title = document.getElementById('title');
const pageCount = document.getElementById('page-count');
const zoomLabel = document.getElementById('zoom-label');
const download = document.getElementById('download');
const desktopBridge = window.bookstrDesktop || window.parent?.bookstrDesktop || null;
const pdfSpeechControls = document.getElementById("pdf-speech-controls");
const pdfSpeechPlayButton = document.getElementById("pdf-speech-play");
const pdfSpeechPauseButton = document.getElementById("pdf-speech-pause");
const pdfSpeechStopButton = document.getElementById("pdf-speech-stop");
let pdf = null;
let pdfBytes = null;
let downloadUrl = '';
let zoom = 1;
let renderGeneration = 0;
let activePdfBook = null;
let activePdfPage = 1;
let pdfFurthestProgress = 0;
let latestPdfProgress = null;
let pageObserver = null;
let pdfSpeechState = "stopped";
let pdfSpeechCollectionSession = 0;
let pdfSpeechPlayer = null;
let currentPdfReaderSettings = readPdfReaderSettings();

function readPdfReaderSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem('bookstr_reader_settings_v1') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function selectedPdfSpeechVoice(language) {
  const languageCode = String(language || '').replace('_', '-').toLowerCase().split('-')[0];
  return String(currentPdfReaderSettings.speechVoices?.[languageCode]
    || (languageCode === 'pt' ? currentPdfReaderSettings.speechVoicePortuguese : '')
    || (languageCode === 'en' ? currentPdfReaderSettings.speechVoiceEnglish : ''));
}

window.applyReaderSettings = function(settings = readPdfReaderSettings()) {
  currentPdfReaderSettings = settings && typeof settings === 'object' ? { ...settings } : {};
  if (pdfSpeechState !== 'stopped') stopPdfSpeech();
};

function normalizePdfPageProgress(page, totalPages) {
  const safePage = Number(page) || 1;
  const safeTotal = Number(totalPages) || 0;
  if (safeTotal <= 1) return 1;
  const normalized = (safePage - 1) / (safeTotal - 1);
  return Math.max(0, Math.min(1, normalized));
}

function pdfPageFromLocator(locator, totalPages) {
  const match = String(locator || '').trim().match(/^page:(\d+)$/i);
  const requested = match ? Number(match[1]) : 1;
  const total = Math.max(1, Number(totalPages) || 1);
  return Math.max(1, Math.min(total, Number.isFinite(requested) ? Math.floor(requested) : 1));
}

function clampProgress(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(1, numericValue));
}

function setPdfSpeechState(state) {
  pdfSpeechState = state;
  if (!pdfSpeechControls) return;
  pdfSpeechPlayButton.disabled = state === "playing";
  pdfSpeechPauseButton.disabled = state === "stopped";
  pdfSpeechStopButton.disabled = state === "stopped";
  pdfSpeechPlayButton.setAttribute("aria-label", state === "stopped" ? "Start reading" : "Reading");
  pdfSpeechPauseButton.textContent = state === "paused" ? "▶" : "▮▮";
  if (state === "paused") {
    pdfSpeechPauseButton.setAttribute("aria-label", "Resume reading");
  } else {
    pdfSpeechPauseButton.setAttribute("aria-label", "Pause reading");
  }
}

function hasPdfSpeechSupport() {
  return Boolean(
    desktopBridge &&
    window.BookstrSpeech &&
    typeof window.speechSynthesis === "object" &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

function stopPdfSpeech() {
  pdfSpeechCollectionSession += 1;
  if (pdfSpeechPlayer) pdfSpeechPlayer.stop();
  else setPdfSpeechState("stopped");
}

async function collectPdfSpeechPlan() {
  if (!pdf || !window.BookstrSpeech) return { text: "", chunks: [], language: "en" };
  const paragraphs = [];
  let totalLength = 0;
  const visiblePage = Array.from(pages.querySelectorAll('.pdf-page')).reduce(function(best, element) {
    const rect = element.getBoundingClientRect();
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return visibleHeight > best.visibleHeight
      ? { page: Number(element.dataset.page) || 1, visibleHeight }
      : best;
  }, { page: Math.max(1, activePdfPage), visibleHeight: 0 }).page;
  activePdfPage = visiblePage;
  for (let pageNumber = visiblePage; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    if (!page) continue;
    const textContent = await page.getTextContent();
    const text = (textContent.items || [])
      .map(function(item) { return item && item.str ? item.str : ""; })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    paragraphs.push(text);
    totalLength += text.length + 1;
    if (totalLength >= 100000) break;
  }
  const plan = window.BookstrSpeech.buildPlan(paragraphs);
  plan.language = window.BookstrSpeech.normalizeLocale(activePdfBook?.language || "en");
  return plan;
}

async function startPdfSpeech() {
  if (!hasPdfSpeechSupport() || !pdf || !pdfSpeechPlayer) return;
  stopPdfSpeech();
  const session = ++pdfSpeechCollectionSession;
  const plan = await collectPdfSpeechPlan();
  if (session !== pdfSpeechCollectionSession || !plan.chunks.length) {
    setPdfSpeechState("stopped");
    return;
  }
  pdfSpeechPlayer.start(plan, {
    language: plan.language,
    rate: Number(currentPdfReaderSettings.speechRate) || 1,
    voiceIdentifier: selectedPdfSpeechVoice(plan.language),
  });
}

function pausePdfSpeech() {
  if (!hasPdfSpeechSupport() || !pdfSpeechPlayer) return;
  if (pdfSpeechState === "paused") {
    pdfSpeechPlayer.resume();
    return;
  }
  pdfSpeechPlayer.pause();
}

function normalizeDesktopBookMetadata(payloadBook) {
  const bookPayload = payloadBook && typeof payloadBook === 'object' ? payloadBook : {};
  return {
    md5: String(bookPayload.md5 || "").trim().toLowerCase(),
    title: String(bookPayload.title || bookPayload.name || "Book"),
    authors: String(bookPayload.authors || bookPayload.author || ""),
    year: String(bookPayload.year || ""),
    language: String(bookPayload.language || ""),
    extension: String(bookPayload.extension || bookPayload.format || "pdf").toLowerCase(),
    readUrl: String(bookPayload.readUrl || bookPayload.url || ""),
    source: String(bookPayload.source || ""),
    sourceNativeId: String(bookPayload.sourceNativeId || bookPayload.source_native_id || ""),
    sourceUrl: String(bookPayload.sourceUrl || ""),
    blossomUrl: String(bookPayload.blossomUrl || ""),
    blossomSha256: String(bookPayload.blossomSha256 || ""),
  };
}

function normalizeDesktopReaderPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const base64 = String(payload.base64 || "").trim();
  if (!base64) return null;
  return {
    base64,
    theme: String(payload.theme || "white").toLowerCase(),
    initialCfi: String(payload.initialCfi || payload.cfi || ""),
    readUrl: String(payload.readUrl || ""),
    book: normalizeDesktopBookMetadata(payload.book),
    filename: String(payload.filename || (payload.book && (payload.book.title || payload.book.name) ? `${String(payload.book.title || payload.book.name)}.pdf` : "Book.pdf"))
      .replace(/[\\/:*?"<>|]+/g, ' ').trim(),
  };
}

function reportPdfProgress(pageNumber) {
  if (!activePdfBook?.md5 || !pdf || !Number.isFinite(pageNumber)) return;
  const progression = normalizePdfPageProgress(pageNumber, pdf.numPages);
  const furthest = Math.max(pdfFurthestProgress, progression);
  const payload = {
    type: 'bookstr-reader-progress',
    bookId: activePdfBook.md5,
    md5: activePdfBook.md5,
    readUrl: String(activePdfBook.readUrl || ""),
    progression: clampProgress(progression),
    furthestProgression: clampProgress(furthest),
    cfi: `page:${Math.max(1, Math.floor(pageNumber))}`,
    title: String(activePdfBook.title || "PDF"),
    authors: String(activePdfBook.authors || ""),
    year: String(activePdfBook.year || ""),
    extension: String(activePdfBook.extension || "pdf"),
    language: String(activePdfBook.language || ""),
    source: String(activePdfBook.source || ""),
    sourceNativeId: String(activePdfBook.sourceNativeId || ""),
    sourceUrl: String(activePdfBook.sourceUrl || ""),
    blossomUrl: String(activePdfBook.blossomUrl || ""),
    blossomSha256: String(activePdfBook.blossomSha256 || ""),
  };
  pdfFurthestProgress = payload.furthestProgression;
  latestPdfProgress = payload;
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(payload, window.location.origin);
  } else if (desktopBridge?.reportProgress) {
    desktopBridge.reportProgress(payload);
  }
}

function schedulePdfProgress(pageNumber) {
  const normalizedPage = Number(pageNumber);
  if (!Number.isFinite(normalizedPage) || normalizedPage <= 0 || !pdf) return;
  if (normalizedPage > activePdfPage) activePdfPage = normalizedPage;
  reportPdfProgress(normalizedPage);
}

function handleDesktopOpenReader(payload) {
  const normalized = normalizeDesktopReaderPayload(payload);
  if (!normalized) return;
  void window.loadPdf({
    base64: normalized.base64,
    bookTitle: normalized.book?.title || "PDF",
    filename: normalized.filename,
    theme: normalized.theme,
    book: normalized.book,
    readUrl: normalized.readUrl,
    initialCfi: normalized.initialCfi,
  });
}

if (desktopBridge?.onOpenReader) {
  desktopBridge.onOpenReader(handleDesktopOpenReader);
}

if (pdfSpeechControls) {
  if (hasPdfSpeechSupport()) {
    pdfSpeechPlayer = window.BookstrSpeech.createPlayer({
      speechSynthesis: window.speechSynthesis,
      Utterance: window.SpeechSynthesisUtterance,
      onStateChange: setPdfSpeechState,
    });
    pdfSpeechControls.classList.remove("hidden");
    setPdfSpeechState("stopped");
    pdfSpeechPlayButton.addEventListener("click", function() {
      void startPdfSpeech();
    });
    pdfSpeechPauseButton.addEventListener("click", pausePdfSpeech);
    pdfSpeechStopButton.addEventListener("click", stopPdfSpeech);
  } else {
    pdfSpeechControls.classList.add("hidden");
  }
}

function reportFlushProgress() {
  if (!latestPdfProgress) return;
  if (window.parent && window.parent !== window) window.parent.postMessage(latestPdfProgress, window.location.origin);
  else if (desktopBridge?.reportProgress) desktopBridge.reportProgress(latestPdfProgress);
}

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function renderPage(pageNumber, canvas, generation) {
  if (canvas.dataset.rendered === 'true' || generation !== renderGeneration) return;
  canvas.dataset.rendered = 'true';
  const page = await pdf.getPage(pageNumber);
  if (generation !== renderGeneration) return;
  const base = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(280, Math.min(1100, window.innerWidth - 24));
  const cssScale = (availableWidth / base.width) * zoom;
  const viewport = page.getViewport({ scale: cssScale });
  const outputScale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  canvas.parentElement.style.width = canvas.style.width;
  canvas.parentElement.style.height = canvas.style.height;
  await page.render({
    canvasContext: canvas.getContext('2d'),
    viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise;
}

async function renderPages(initialPage = activePdfPage || 1) {
  const generation = ++renderGeneration;
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }
  pages.replaceChildren();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const canvas = entry.target.querySelector('canvas');
      void renderPage(Number(entry.target.dataset.page), canvas, generation);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '900px 0px' });
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const shell = document.createElement('section');
    shell.className = 'pdf-page';
    shell.dataset.page = String(pageNumber);
    shell.setAttribute('aria-label', `Page ${pageNumber}`);
    shell.appendChild(document.createElement('canvas'));
    pages.appendChild(shell);
    observer.observe(shell);
  }
  pageObserver = observer;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  activePdfPage = pdfPageFromLocator(`page:${initialPage}`, pdf.numPages);
  pages.querySelector(`[data-page="${activePdfPage}"]`)?.scrollIntoView?.({ block: 'start' });
  reportPdfProgress(activePdfPage);
}

window.loadPdf = async ({
  base64,
  bookTitle,
  filename,
  theme = 'white',
  book = {},
  readUrl = '',
  initialCfi = '',
}) => {
  try {
    renderGeneration += 1;
    stopPdfSpeech();
    if (pdf) await pdf.destroy();
    pages.replaceChildren();
    activePdfBook = normalizeDesktopBookMetadata({ ...book, readUrl });
    activePdfBook.title = String(bookTitle || activePdfBook.title || 'PDF');
    activePdfPage = 1;
    pdfFurthestProgress = 0;
    latestPdfProgress = null;
    document.body.dataset.theme = theme;
    title.textContent = bookTitle || activePdfBook.title || 'PDF';
    pdfBytes = bytesFromBase64(base64);
    pdf = await resolvePdfDocument({ data: pdfBytes.slice() }).promise;
    pageCount.textContent = `${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`;
    if (downloadUrl) revokePdfObjectURL(downloadUrl);
    downloadUrl = createPdfObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    download.href = downloadUrl;
    download.download = String(filename || 'Book.pdf').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    await renderPages(pdfPageFromLocator(initialCfi, pdf.numPages));
    message.classList.add('hidden');
    reportPdfProgress(activePdfPage);
  } catch (error) {
    message.textContent = `Could not display PDF: ${error?.message || error}`;
    throw error;
  }
};

document.getElementById('zoom-out').addEventListener('click', () => {
  zoom = Math.max(.5, zoom - .15);
  void renderPages(activePdfPage);
});

document.getElementById('zoom-in').addEventListener('click', () => {
  zoom = Math.min(2.5, zoom + .15);
  void renderPages(activePdfPage);
});

let pdfScrollFrame = 0;
window.addEventListener('scroll', () => {
  if (pdfScrollFrame || !pdf) return;
  pdfScrollFrame = requestAnimationFrame(() => {
    pdfScrollFrame = 0;
    const nearest = [...pages.querySelectorAll('[data-page]')]
      .map(node => ({ node, distance: Math.abs(Number(node.getBoundingClientRect?.().top || 0)) }))
      .sort((left, right) => left.distance - right.distance)[0]?.node;
    const pageNumber = Number(nearest?.dataset?.page || 0);
    if (pageNumber) schedulePdfProgress(pageNumber);
  });
}, { passive: true });

window.addEventListener('beforeunload', () => {
  stopPdfSpeech();
  if (downloadUrl) revokePdfObjectURL(downloadUrl);
  pdf?.destroy();
  reportFlushProgress();
});

window.addEventListener('pagehide', function() {
  stopPdfSpeech();
  reportFlushProgress();
});

window.addEventListener("visibilitychange", function() {
  if (document.hidden && (pdfSpeechState === "playing" || pdfSpeechState === "paused")) {
    stopPdfSpeech();
  }
});

if (typeof globalThis !== 'undefined') {
  globalThis.PdfReaderTest = {
    normalizePdfPageProgress,
    pdfPageFromLocator,
    clampProgress,
    setPdfSpeechState,
    hasPdfSpeechSupport,
    normalizeDesktopBookMetadata,
    normalizeDesktopReaderPayload,
    bytesFromBase64,
    reportPdfProgress,
    schedulePdfProgress,
    collectPdfSpeechPlan,
    startPdfSpeech,
    pausePdfSpeech,
    stopPdfSpeech,
    renderPage,
    renderPages,
    reportFlushProgress,
  };
}
