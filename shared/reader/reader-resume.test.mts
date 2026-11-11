import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { functionSource } from '../../web/tests/source-tools.mts';

const reader = await readFile(new URL('./reader.html', import.meta.url), 'utf8');

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function readerHarness() {
  const reports: Array<Record<string, unknown>> = [];
  const ready: string[] = [];
  const warnings: unknown[][] = [];
  const books: Array<{
    generated: ReturnType<typeof deferred<void>>;
    displayCalls: Array<string | undefined>;
    currentCfi: () => string;
    moveTo: (cfi: string, percentage: number) => void;
  }> = [];
  const bridge = {
    onRelocated(payload: string) { reports.push(JSON.parse(payload) as Record<string, unknown>); },
    onReaderReady() { ready.push('ready'); },
  };
  function createBook() {
    const generated = deferred<void>();
    const displayCalls: Array<string | undefined> = [];
    let location = {
      start: { cfi: 'epubcfi(/6/2[chapter]!/4/1:0)', percentage: 0.1, index: 0 },
    };
    let relocated: ((value: typeof location) => void) | undefined;
    const rendition = {
      hooks: { content: { register() {} } },
      on(event: string, callback: (value: typeof location) => void) {
        if (event === 'relocated') relocated = callback;
      },
      themes: { fontSize() {} },
      display(target?: string) {
        displayCalls.push(target);
        if (target) location = { start: { cfi: target, percentage: 0.25, index: 0 } };
        relocated?.(location);
        return Promise.resolve();
      },
      currentLocation() { return location; },
    };
    const book = {
      ready: Promise.resolve(),
      spine: { spineItems: [{ linear: true, index: 0 }], get: () => ({ index: 0 }) },
      packaging: { metadata: { language: 'en' } },
      renderTo() { return rendition; },
      locations: {
        generate() { return generated.promise; },
        length() { return 100; },
        percentageFromCfi() { return 0.25; },
      },
    };
    books.push({
      generated,
      displayCalls,
      currentCfi: () => location.start.cfi,
      moveTo(cfi, percentage) {
        location = { start: { cfi, percentage, index: 0 } };
        relocated?.(location);
      },
    });
    return book;
  }
  const context = vm.createContext({
    window: { AndroidBridge: bridge }, AndroidBridge: bridge,
    ePub: () => createBook(), readerFontPercent: 100,
    console: { warn(...args: unknown[]) { warnings.push(args); } },
    waitForReaderViewport: () => Promise.resolve(), applyTheme() {},
    reportBookMetadata() {}, reportBookSections() {}, installContinuousShellWatch() {},
    registerThemes() {}, restoredHighlights: () => ({ words: [], marks: [] }),
    rememberReaderHighlights() {}, activeReaderHighlights: { words: [], marks: [] },
    applyHighlight() {}, reportReaderStartupStage() {},
  });
  vm.runInContext(functionSource(reader, 'includeOpeningSpineItems'), context);
  vm.runInContext(functionSource(reader, 'cfiProgression'), context);
  vm.runInContext(functionSource(reader, 'spinePositionForCfi'), context);
  vm.runInContext(functionSource(reader, 'reportLocation'), context);
  vm.runInContext(functionSource(reader, 'reportSpeechLocator'), context);
  vm.runInContext(functionSource(reader, 'openBook'), context);
  return {
    context, reports, ready, warnings,
    get generated() { return books[0].generated; },
    get displayCalls() { return books[0].displayCalls; },
    moveTo(cfi: string, percentage: number) { books.at(-1)?.moveTo(cfi, percentage); },
    currentCfi() { return books.at(-1)?.currentCfi(); },
  };
}

test('iOS keeps the system text selection menu instead of a custom reader toolbar', () => {
  assert.match(reader, /if \(window\.bookstrNativeSwipeNavigation\)\s*return;/);
  assert.match(reader, /window\.bookstrCurrentTextSelection = function\s*\(\)/);
  assert.match(reader, /captureLiveTextSelection\(\)/);
  assert.match(reader, /window\.highlightCurrentSelection = function\s*\(kind\)/);
  assert.match(reader, /function paintCurrentSelectionHighlight\s*\(kind\)/);
  assert.match(reader, /::highlight\(bookstr-mark\)/);
  assert.match(reader, /window\.__bookstrTextSelection = payload/);
  assert.match(reader, /window\.highlightReaderCfi = function\s*\(cfi, kind\)/);
  assert.match(reader, /window\.setReaderHighlights = function\s*\(highlightsJson\)/);
  assert.doesNotMatch(reader, /id="selection-actions"/);
});

test('reader reports structured startup stages to native hosts', () => {
  assert.match(reader, /AndroidBridge.onReaderStage\(stage\)/);
  for (const stage of ['fetching', 'decoding', 'parsing', 'rendering', 'ready']) {
    assert.ok(reader.includes(`reportReaderStartupStage("${stage}")`));
  }
  assert.doesNotMatch(reader, /Opening archive/);
  assert.doesNotMatch(reader, /Laying out pages/);
  assert.doesNotMatch(reader, /Decoding EPUB/);
  assert.doesNotMatch(reader, /Reading book metadata/);
});

test('word and mark highlights stay distinct and readable in every reader theme', () => {
  assert.match(reader, /word: \{ background: "#e7c766", foreground: "#1c1916"/);
  assert.match(reader, /mark: \{ background: "#efaa96", foreground: "#1c1916"/);
  assert.match(reader, /word: \{ background: "#68561f", foreground: "#f4f0e8"/);
  assert.match(reader, /mark: \{ background: "#713327", foreground: "#f4f0e8"/);
  assert.match(reader, /function repaintReaderAnnotations\(\)/);
  assert.match(reader, /rendition\.annotations\.remove\(cfi, "highlight"\)/);
  assert.match(reader, /applyTheme\(theme\)[\s\S]*?repaintReaderAnnotations\(\)/);
  assert.match(reader, /activeReaderHighlights\.words\.forEach/);
  assert.match(reader, /activeReaderHighlights\.marks\.forEach/);
  assert.match(reader, /Array\.isArray\(parsed\) \? \{ words: parsed, marks: \[\] \}/);
});

test('saved word and mark annotations navigate back to their list entries when tapped', () => {
  assert.match(reader, /activateSavedHighlight\(\{ kind: resolvedKind, locator: cfi \}\)/);
  assert.match(reader, /activeReaderHighlights\[group\]\.includes\(cfi\)/);
  assert.match(reader, /savedHighlightAtPoint\(contentDocument, event\.clientX, event\.clientY\)/);
  assert.match(reader, /window\.activateSavedHighlightAtViewportPoint\(event\.clientX, event\.clientY\)/);
  assert.match(reader, /x - rect\.left, y - rect\.top/);
  assert.match(reader, /window\.activateSavedHighlightAtViewportPoint = function\s*\(x, y\)/);
  assert.match(reader, /lastSavedHighlightActivation/);
  assert.match(reader, /const range = contents\.range\(cfi\)/);
  assert.match(reader, /\{ kind: "mark", values: activeReaderHighlights\.marks \}/);
});

test('dictionary results remain attached when the user adds the shown word', () => {
  assert.match(reader, /activeDictionary = Object\.assign\(\{\}, activeDictionary, payload\);/);
  assert.match(reader, /AndroidBridge\.onWordSelected\(JSON\.stringify\(activeDictionary\)\);/);
});

test('reader captures live iframe selection for Add Word and Mark', () => {
  assert.match(reader, /function captureLiveTextSelection\(\)/);
  assert.match(reader, /function installSelectionBridge\(contentDocument\)/);
  assert.match(reader, /contentDocument\.addEventListener\("selectionchange"/);
  assert.match(reader, /rangeToCfi\(selection\.getRangeAt\(0\)\)/);
  assert.match(reader, /AndroidBridge\.onTextSelected\(JSON\.stringify\(payload\)\)/);
});

test('an unmoved reopen reports the saved CFI after location generation', async () => {
  const harness = readerHarness();
  const savedCfi = 'epubcfi(/6/8[chapter]!/4/12:3)';
  await harness.context.openBook('fixture', savedCfi, 'paper', '', 'saved-book');

  assert.deepEqual(harness.displayCalls, [savedCfi]);
  assert.deepEqual(harness.ready, ['ready']);
  const reportsBeforeGeneration = harness.reports.length;
  harness.generated.resolve();
  await harness.generated.promise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.currentCfi(), savedCfi);
  assert.ok(harness.reports.length > reportsBeforeGeneration);
  assert.equal(harness.reports.at(-1)?.cfi, savedCfi);
});

test('a user relocation after ready survives deferred location generation and reaches Android', async () => {
  const harness = readerHarness();
  const savedCfi = 'epubcfi(/6/8[chapter]!/4/12:3)';
  const userCfi = 'epubcfi(/6/8[chapter]!/4/44:9)';
  await harness.context.openBook('fixture', savedCfi, 'paper', '', 'saved-book');
  assert.deepEqual(harness.ready, ['ready']);

  harness.moveTo(userCfi, 0.72);
  assert.equal(harness.reports.at(-1)?.cfi, userCfi);
  const reportsBeforeGeneration = harness.reports.length;
  harness.generated.resolve();
  await harness.generated.promise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.currentCfi(), userCfi);
  assert.ok(harness.reports.length > reportsBeforeGeneration);
  assert.equal(harness.reports.at(-1)?.cfi, userCfi);
});

test('a user relocation is reported when location generation rejects', async () => {
  const harness = readerHarness();
  const savedCfi = 'epubcfi(/6/8[chapter]!/4/12:3)';
  const userCfi = 'epubcfi(/6/8[chapter]!/4/44:9)';
  await harness.context.openBook('fixture', savedCfi, 'paper', '', 'saved-book');

  harness.moveTo(userCfi, 0.72);
  const reportsBeforeGeneration = harness.reports.length;
  harness.generated.reject(new Error('fixture generation failure'));
  await assert.rejects(harness.generated.promise, /fixture generation failure/);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.currentCfi(), userCfi);
  assert.ok(harness.reports.length > reportsBeforeGeneration);
  assert.equal(harness.reports.at(-1)?.cfi, userCfi);
  assert.ok(harness.warnings.some(([message, error]) =>
    message === 'Could not generate EPUB locations' && String(error).includes('fixture generation failure')));
});

test('an EPUB opened without a saved CFI reports its current location before generation finishes', async () => {
  const harness = readerHarness();
  await harness.context.openBook('fixture', '', 'paper', '', 'new-book');

  assert.deepEqual(harness.displayCalls, [undefined]);
  assert.equal(harness.reports.at(-1)?.cfi, 'epubcfi(/6/2[chapter]!/4/1:0)');
  harness.generated.resolve();
  await harness.generated.promise;
});

test('location generation while speaking reports the spoken CFI without restoring the saved CFI', async () => {
  const harness = readerHarness();
  const savedCfi = 'epubcfi(/6/8[chapter]!/4/12:3)';
  const spokenCfi = 'epubcfi(/6/8[chapter]!/4/61:4)';
  await harness.context.openBook('fixture', savedCfi, 'paper', '', 'saved-book');

  harness.moveTo(spokenCfi, 0.9);
  harness.context.speechActive = true;
  harness.context.lastSpeechCfi = spokenCfi;
  harness.generated.resolve();
  await harness.generated.promise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.currentCfi(), spokenCfi);
  assert.equal(harness.reports.at(-1)?.cfi, spokenCfi);
  assert.equal(harness.reports.at(-1)?.source, 'speech');
});

test('obsolete location generation cannot restore into a newly opened book', async () => {
  const harness = readerHarness();
  const firstSavedCfi = 'epubcfi(/6/2[old]!/4/12:3)';
  const secondSavedCfi = 'epubcfi(/6/4[new]!/4/20:7)';
  await harness.context.openBook('first-fixture', firstSavedCfi, 'paper', '', 'first-book');
  await harness.context.openBook('second-fixture', secondSavedCfi, 'paper', '', 'second-book');
  const reportsBeforeOldCompletion = harness.reports.length;

  harness.generated.resolve();
  await harness.generated.promise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.currentCfi(), secondSavedCfi);
  assert.equal(harness.reports.length, reportsBeforeOldCompletion);
});

test('speech progress and reading progress share the spoken CFI after locations exist', () => {
  assert.match(reader, /if \(speechActive\) \{\s*reportSpeechLocator\(lastSpeechCfi, false\);/s);
  assert.match(reader, /function cfiProgression\(cfi\)/);
  assert.match(reader, /function spinePositionForCfi\(cfi, fallbackIndex(?:\s*=\s*0)?\)/);
  assert.match(reader, /sectionCount: spine\.sectionCount/);
  assert.match(reader, /const speechFeatures = window\.BookstrSpeech[\s\S]*?speechFeatures\??\.relocationProgression/);
  assert.match(reader, /rangeToCfi\(spokenRange\) \|\| elementBoundaryCfi\(block\.element, false\)/);
});

test('speech extraction uses speakableBlocks and recovers from an empty resume CFI', () => {
  assert.match(reader, /window\.BookstrSpeech\.speakableBlocks/);
  assert.match(reader, /function collectSpeechParts\(activeResumeCfi\)/);
  assert.match(reader, /let collected = collectSpeechParts\(resumeCfi\);/);
  assert.match(reader, /if \(!collected\.parts\.length && resumeCfi\)/);
  assert.match(reader, /lastSpeechCfi = "";/);
  assert.match(reader, /collected = collectSpeechParts\(""\);/);
});

test('speech continues into the next spine section after the current plan ends', () => {
  assert.match(reader, /window\.continueSpeechAfterSection = function\s*\(notifyNative, requestID, attempts\)/);
  assert.match(reader, /exhausted: true/);
  assert.match(reader, /window\.requestSpeechText\(false, requestID, ""\)/);
  assert.match(reader, /window\.continueSpeechAfterSection\(notifyNative, requestID, attempt \+ 1\)/);
});

test('shared reader inline script parses as JavaScript', () => {
  const scripts = [...reader.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((source) => source.trim());
  assert.ok(scripts.length > 0);
  for (const source of scripts) {
    assert.doesNotThrow(() => new Function(source));
  }
});

test('loadBookUrl forwards highlight kind into openBook', () => {
  assert.match(reader, /window\.loadBookUrl = function\s*\(url, cfi, theme, highlightCfi, bookId, highlightKind\)/);
  assert.match(reader, /return openBook\(buffer, cfi, theme, highlightCfi, bookId, highlightKind \|\| null\);/);
});

test('continuous scroll keeps theme-colored shells and isolates author backgrounds', () => {
  assert.match(reader, /<script src="reader-chrome.js"><\/script>/);
  assert.match(reader, /BookstrReaderChrome\.prepareContentDocument/);
  assert.match(reader, /BookstrReaderChrome\.paintShell/);
  assert.match(reader, /installContinuousShellWatch/);
  assert.match(reader, /isolateAuthorBackgrounds/);
  assert.match(reader, /background: inherit !important/);
  assert.match(reader, /background-color": "transparent !important"/);
});
