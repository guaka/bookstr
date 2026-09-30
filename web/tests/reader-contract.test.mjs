import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reader = await readFile(new URL('../reader.html', import.meta.url), 'utf8');
const comicReader = await readFile(new URL('../comic-reader.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('comic reader supports bounded CBZ and CBR page extraction and navigation', () => {
  assert.match(comicReader, /JSZip\.loadAsync/);
  assert.match(comicReader, /vendor\/libarchive\.js/);
  assert.match(comicReader, /archive_read_new_memory/);
  assert.match(comicReader, /Encrypted comic archives are not supported/);
  assert.match(comicReader, /MAX_ENTRIES=2000/);
  assert.match(comicReader, /MAX_PAGE_BYTES=30\*1024\*1024/);
  assert.match(comicReader, /localeCompare\(b,undefined,\{numeric:true/);
  assert.match(comicReader, /Previous page/);
  assert.match(comicReader, /Next page/);
  assert.match(comicReader, /bookstr-comic-progress/);
  assert.match(comicReader, /split\('\/'\)\.includes\('\.\.'\)/);
  assert.match(comicReader, /overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y/);
  assert.match(comicReader, /function layoutImage\(reset=false\)/);
  assert.match(comicReader, /scale<=FIT_SCALE\+\.01/);
  assert.match(comicReader, /fast=Math\.abs\(deltaX\)\/elapsed>\.35/);
  assert.match(comicReader, /touchend.*finishGesture/);
  assert.match(comicReader, /now-lastFlipAt>300/);
  assert.match(comicReader, /orientation: landscape.*min-width: 900px/);
  assert.match(comicReader, /function facingPages\(\)/);
  assert.match(comicReader, /function turn\(direction\)/);
  assert.match(comicReader, /current\+1<pages\.length/);
  assert.doesNotMatch(comicReader, /setPassword/);
});

test('Bookstr routes CBZ and CBR files to the comic reader', () => {
  assert.match(app, /displayComic\(blob, book, readPath, openGeneration, format\)/);
  assert.match(app, /format === 'cbz' \|\| format === 'cbr'/);
  assert.match(app, /Only EPUB, PDF, FB2, CBZ, and CBR book files can be opened/);
});

test('EPUB reader uses continuous vertical scrolling', () => {
  assert.match(reader, /manager:\s*"continuous"/);
  assert.match(reader, /flow:\s*"scrolled-doc"/);
  assert.doesNotMatch(reader, /flow:\s*"paginated"/);
  assert.match(reader, /installContinuousShellWatch/);
  assert.match(reader, /isolateAuthorBackgrounds/);
  assert.match(reader, /BookstrReaderChrome\.paintShell/);
  assert.match(reader, /background: inherit !important/);
});

test('EPUB reader provides mouse, keyboard, and swipe navigation', () => {
  assert.match(reader, /aria-label="Previous page"/);
  assert.match(reader, /aria-label="Next page"/);
  assert.match(reader, /event\.key === "ArrowRight"/);
  assert.doesNotMatch(reader, /event\.key === "PageDown"/);
  assert.doesNotMatch(reader, /event\.key === "PageUp"/);
  assert.match(reader, /installSwipeNavigation/);
  assert.match(reader, /installWheelNavigation/);
  assert.match(reader, /scrollBy\(\{ top: event\.deltaY \}\)/);
  assert.match(reader, /\{ passive: false \}/);
  assert.match(reader, /rendition\.next\(\)/);
  assert.match(reader, /rendition\.prev\(\)/);
  assert.match(reader, /container\.scrollBy\(\{ top: direction \* distance/);
});

test('cover pages retain the full reader viewport', () => {
  assert.match(reader, /bookstr-cover/);
  assert.match(reader, /"height": "100% !important"/);
  assert.match(reader, /"object-fit": "contain !important"/);
  assert.doesNotMatch(app, /\n\s+improveEpubTypography\(\);/);
});

test('reader exposes its current EPUB location for browser progress and E2E checks', () => {
  assert.match(reader, /document\.body\.dataset\.location = start\.cfi/);
  assert.match(reader, /type: "bookstr-reader-progress"/);
  assert.match(reader, /window\.parent\.postMessage\(payload, window\.location\.origin\)/);
  assert.match(reader, /if \(!window\.AndroidBridge\) return/);
});

test('reader shows live progress in its footer and hides scrollbars', () => {
  assert.match(reader, /id="reader-footer"/);
  assert.match(reader, /id="reader-progress-track" role="progressbar"/);
  assert.match(reader, /function updateReaderProgress\(progression\)/);
  assert.match(reader, /scrollbar-width: none/);
  assert.match(reader, /::-webkit-scrollbar/);
});

test('reader uses the shared sage and gold reading colors', () => {
  assert.match(reader, /#2f5d50/);
  assert.match(reader, /#7fb8a7/);
  assert.match(reader, /#e7c766/);
  assert.doesNotMatch(reader, /#ffd54f/i);
});

test('PDF reader exposes semantic landmarks and keyboard-accessible message regions', async () => {
  const pdfReaderHtml = await readFile(new URL('../pdf-reader.html', import.meta.url), 'utf8');
  const pdfReaderJs = await readFile(new URL('../pdf-reader.js', import.meta.url), 'utf8');

  assert.match(pdfReaderHtml, /aria-label="PDF pages"/);
  assert.match(pdfReaderHtml, /id="message" role="status"/);
  assert.match(pdfReaderHtml, /id="zoom-in"[^>]*aria-label="Zoom in"/);
  assert.match(pdfReaderHtml, /id="zoom-out"[^>]*aria-label="Zoom out"/);
  assert.match(pdfReaderJs, /download\.download = String\(filename \|\| 'Book\.pdf'\)\.replace/);
  assert.match(pdfReaderJs, /download\.href = downloadUrl;/);
});

test('reader keyboard handlers and zoom UI are present', () => {
  assert.match(reader, /document\.addEventListener\("keydown", function\(event\) \{/);
  assert.match(reader, /id="reader-prev"/);
  assert.match(reader, /id="reader-next"/);
  assert.match(reader, /let readerFontPercent = Number\(currentReaderSettings\.readerFontPercent\)[\s\S]*?localStorage\.getItem\("bookstr-reader-font-percent"\)[\s\S]*?100;/);
  assert.match(reader, /rendition\.themes\.fontSize\(readerFontPercent \+ "%"\);/);
  assert.match(reader, /<script src="reader-typography.js"><\/script>/);
  assert.match(reader, /<script src="reader-chrome.js"><\/script>/);
  assert.match(reader, /BookstrTypography.css/);
  assert.match(reader, /BookstrTypography\.css\(readerFontFamily, readerAlignment, readerPadding\)/);
  assert.match(reader, /window\.setReaderTypography = function\(font, alignment, padding\)/);
  assert.match(reader, /window.setReaderTypography/);
  assert.match(reader, /window\.prevPage/);
  assert.match(reader, /window\.nextPage/);
});
