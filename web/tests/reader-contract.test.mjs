import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reader = await readFile(new URL('../reader.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('EPUB reader uses continuous vertical scrolling', () => {
  assert.match(reader, /manager:\s*"continuous"/);
  assert.match(reader, /flow:\s*"scrolled-doc"/);
  assert.doesNotMatch(reader, /flow:\s*"paginated"/);
});

test('EPUB reader provides mouse, keyboard, and swipe navigation', () => {
  assert.match(reader, /aria-label="Previous page"/);
  assert.match(reader, /aria-label="Next page"/);
  assert.match(reader, /event\.key === "ArrowRight"/);
  assert.doesNotMatch(reader, /event\.key === "PageDown"/);
  assert.doesNotMatch(reader, /event\.key === "PageUp"/);
  assert.match(reader, /installSwipeNavigation/);
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
  assert.match(pdfReaderJs, /download\.download = filename;/);
  assert.match(pdfReaderJs, /download\.href = downloadUrl;/);
});

test('reader keyboard handlers and zoom UI are present', () => {
  assert.match(reader, /document\.addEventListener\("keydown", function\(event\) \{/);
  assert.match(reader, /id="reader-prev"/);
  assert.match(reader, /id="reader-next"/);
  assert.match(reader, /let readerFontPercent = Number\(localStorage\.getItem\("bookstr-reader-font-percent"\)\) \|\| 100;/);
  assert.match(reader, /rendition\.themes\.fontSize\(readerFontPercent \+ "%"\);/);
  assert.match(reader, /window\.prevPage/);
  assert.match(reader, /window\.nextPage/);
});
