import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { functionSource } from './source-tools.mts';

const reader = await readFile(new URL('../reader.html', import.meta.url), 'utf8');
const sharedReader = await readFile(new URL('../../shared/reader/reader.html', import.meta.url), 'utf8');
const comicReader = await readFile(new URL('../comic-reader.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('EPUB timeout identifies the active startup stage', async () => {
  const source = sharedReader.slice(sharedReader.indexOf('function withTimeout('), sharedReader.indexOf('function waitForReaderViewport('));
  const context = { setTimeout, clearTimeout, Promise, Error };
  vm.runInNewContext(source, context);
  let stage = 'fetching';
  const stalled = new Promise(() => {});
  stage = 'rendering';
  await assert.rejects(
    context.withTimeout(stalled, 1, () => `EPUB reader timed out while ${stage}`),
    /EPUB reader timed out while rendering/,
  );
  assert.match(sharedReader, /reportReaderStartupStage\("fetching"\)/);
  assert.match(sharedReader, /reportReaderStartupStage\("parsing"\)/);
  assert.match(sharedReader, /reportReaderStartupStage\("rendering"\)/);
  assert.match(sharedReader, /reportReaderStartupStage\("ready"\)/);
});

test('comic reader supports bounded CBZ and CBR page extraction and navigation', () => {
  assert.match(comicReader, /JSZip\.loadAsync/);
  assert.match(comicReader, /vendor\/libarchive\.js/);
  assert.match(comicReader, /archive_read_new_memory/);
  assert.match(comicReader, /Encrypted comic archives are not supported/);
  assert.match(comicReader, /MAX_ENTRIES\s*=\s*2000/);
  assert.match(comicReader, /MAX_PAGE_BYTES\s*=\s*30\s*\*\s*1024\s*\*\s*1024/);
  assert.match(comicReader, /localeCompare\(b,\s*undefined,\s*\{\s*numeric:\s*true/);
  assert.match(comicReader, /Previous page/);
  assert.match(comicReader, /Next page/);
  assert.match(comicReader, /bookstr-comic-progress/);
  assert.match(comicReader, /id="opening-progress" aria-label="Comic opening progress"/);
  assert.match(comicReader, /setOpeningProgress\('Extracting pages…',\s*0,\s*names\.length\)/);
  assert.match(comicReader, /Extracting pages · \$\{processed\} of \$\{names\.length\}/);
  assert.match(comicReader, /setOpeningProgress\('Rendering first page…'\)/);
  assert.match(comicReader, /split\('\/'\)\.includes\('\.\.'\)/);
  assert.match(comicReader, /overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y/);
  assert.match(comicReader, /function layoutImage\(reset\s*=\s*false\)/);
  assert.match(comicReader, /scale\s*<=\s*FIT_SCALE\s*\+\s*\.01/);
  assert.match(comicReader, /fast\s*=\s*Math\.abs\(deltaX\)\s*\/\s*elapsed\s*>\s*\.35/);
  assert.match(comicReader, /touchend[\s\S]*finishGesture/);
  assert.match(comicReader, /now\s*-\s*lastFlipAt\s*>\s*300/);
  assert.match(comicReader, /orientation: landscape.*min-width: 900px/);
  assert.match(comicReader, /function facingPages\(\)/);
  assert.match(comicReader, /function turn\(direction\)/);
  assert.match(comicReader, /current\s*\+\s*1\s*<\s*pages\.length/);
  assert.doesNotMatch(comicReader, /setPassword/);
});

test('comic reader restores its opening message with legacy DOM child APIs', () => {
  class LegacyNode {
    constructor(name) { this.name = name; this.parentNode = null; this.children = []; this._textContent = ''; }
    set textContent(value) { this._textContent = value; this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
    get textContent() { return this._textContent; }
    appendChild(child) {
      if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child);
      child.parentNode = this; this.children.push(child); return child;
    }
  }
  const reset = functionSource(comicReader, 'resetComicMessage');
  assert.ok(reset);
  const message = new LegacyNode('message');
  const stage = new LegacyNode('stage');
  const openingLabel = new LegacyNode('opening-label');
  const openingProgress = new LegacyNode('opening-progress');
  message.appendChild(new LegacyNode('old-error'));
  vm.runInNewContext(`${reset}; resetComicMessage()`, { message, stage, openingLabel, openingProgress });
  assert.deepEqual(message.children.map(node => node.name), ['opening-label', 'opening-progress']);
  assert.equal(message.parentNode, stage);
  assert.deepEqual(stage.children, [message]);
  assert.equal('replaceChildren' in message, false);
  assert.equal('append' in message, false);
  assert.equal('isConnected' in message, false);
  assert.doesNotMatch(comicReader, /\.replaceAll\(|\.append\(|\.replaceChildren\(|\.isConnected/);
  vm.runInNewContext(`${reset}; resetComicMessage()`, { message, stage, openingLabel, openingProgress });
  assert.deepEqual(stage.children, [message]);
  assert.deepEqual(message.children, [openingLabel, openingProgress]);
});

test('Bookstr routes CBZ and CBR files to the comic reader', () => {
  assert.match(app, /displayComic\(blob, book, readPath, openGeneration, format\)/);
  assert.match(app, /archiveBlob: blob,/);
  assert.match(comicReader, /options\.archiveBlob\.arrayBuffer\(\)/);
  assert.match(app, /id = 'read-comic-opening-progress'/);
  assert.match(app, /format === 'cbz' \|\| format === 'cbr'/);
  assert.match(app, /Only EPUB, PDF, CBZ, and CBR book files can be opened/);
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
  assert.match(reader, /if \(!window\.AndroidBridge\)\s+return/);
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
  assert.match(reader, /document\.addEventListener\("keydown", function\s*\(event\) \{/);
  assert.match(reader, /id="reader-prev"/);
  assert.match(reader, /id="reader-next"/);
  assert.match(reader, /let readerFontPercent = Number\(currentReaderSettings\.readerFontPercent\)[\s\S]*?localStorage\.getItem\("bookstr-reader-font-percent"\)[\s\S]*?100;/);
  assert.match(reader, /rendition\.themes\.fontSize\(readerFontPercent \+ "%"\);/);
  assert.match(reader, /<script src="reader-typography.js"><\/script>/);
  assert.match(reader, /<script src="reader-chrome.js"><\/script>/);
  assert.match(reader, /BookstrTypography.css/);
  assert.match(reader, /BookstrTypography\.css\(readerFontFamily, readerAlignment, readerPadding\)/);
  assert.match(reader, /window\.setReaderTypography = function\s*\(font, alignment, padding\)/);
  assert.match(reader, /window.setReaderTypography/);
  assert.match(reader, /window\.prevPage/);
  assert.match(reader, /window\.nextPage/);
});

test('comic archive paths normalize all Windows separators without replaceAll', () => {
  const source = functionSource(comicReader, 'imageName');
  assert.ok(source);
  const imageName = vm.runInNewContext(`${source}; String.prototype.replaceAll = undefined; imageName`);
  for (const name of ['folder\\nested\\page.JPG', 'chapter/page.png', 'page.webp']) assert.equal(imageName(name), true, name);
  for (const name of ['', 'folder\\', 'folder\\..\\page.jpg', '__MACOSX\\page.png', 'thumbs\\page.jpg', 'cover.txt']) assert.equal(imageName(name), false, name);
});

test('reader format detection recognizes PDF, EPUB and comic archives without treating XML as a book', async () => {
  const context = vm.createContext({ Blob, Uint8Array, String, Object,
    isComicImageName: name => /\.(?:png|jpg)$/i.test(name),
    JSZip: { loadAsync: async blob => ({ files: JSON.parse(await blob.text()) }) },
  });
  vm.runInContext(functionSource(app, 'bookFormatForBlob'), context);
  const detect = context.bookFormatForBlob;
  assert.equal(await detect(null), '');
  assert.equal(await detect(new Blob(['%PDF-test'])), 'pdf');
  assert.equal(await detect(new Blob(['ignored'], { type: 'application/pdf' })), 'pdf');
  assert.equal(await detect(new Blob(['<document>text</document>'])), '');
  assert.equal(await detect(new Blob(['Rar!payload'])), 'cbr');
  assert.equal(await detect(new Blob(['{"META-INF/container.xml":{}}'], { type: 'application/epub+zip' })), 'epub');
  assert.equal(await detect(new Blob(['{"page.jpg":{}}'], { type: 'application/zip' })), 'cbz');
  assert.equal(await detect(new Blob(['broken zip'], { type: 'application/zip' })), 'epub');
});

test('readability accepts only registered extensions and publication MIME types', () => {
  const context = vm.createContext({});
  vm.runInContext(functionSource(app, 'isDisabledBookFormat'), context);
  for (const format of ['', null, 'epub', '.PDF', 'CBZ', 'cbr', 'application/epub+zip', 'application/pdf', 'application/vnd.comicbook+zip', 'application/vnd.comicbook-rar']) {
    assert.equal(context.isDisabledBookFormat(format), false, String(format));
  }
  for (const format of ['mobi', 'exe', 'application/octet-stream']) {
    assert.equal(context.isDisabledBookFormat(format), true, format);
  }
});
