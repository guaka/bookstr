import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const reader = await readFile(new URL('./reader.html', import.meta.url), 'utf8');

test('iOS keeps the system text selection menu instead of a custom reader toolbar', () => {
  assert.match(reader, /if \(window\.bookstrNativeSwipeNavigation\) return;/);
  assert.match(reader, /window\.bookstrCurrentTextSelection = function\(\)/);
  assert.match(reader, /captureLiveTextSelection\(\)/);
  assert.match(reader, /window\.highlightCurrentSelection = function\(kind\)/);
  assert.match(reader, /function paintCurrentSelectionHighlight\(kind\)/);
  assert.match(reader, /::highlight\(bookstr-mark\)/);
  assert.match(reader, /window\.__bookstrTextSelection = payload/);
  assert.match(reader, /window\.highlightReaderCfi = function\(cfi, kind\)/);
  assert.match(reader, /window\.setReaderHighlights = function\(highlightsJson\)/);
  assert.doesNotMatch(reader, /id="selection-actions"/);
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
  assert.match(reader, /window\.activateSavedHighlightAtViewportPoint = function\(x, y\)/);
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

test('reopening an EPUB does not let location generation overwrite the restored CFI', () => {
  assert.match(reader, /function reportRestoredLocation\(\)/);
  assert.match(reader, /if \(!restore\) reportLocation\(rendition\.currentLocation\(\)\)/);
  assert.match(reader, /book\.locations\.generate\(100\)\.then\(function\(\) \{\s*return reportRestoredLocation\(\);/s);
  assert.match(reader, /function reportLocation\(location\) \{\s*if \(speechActive\) return;/s);
});

test('speech progress and reading progress share the spoken CFI after locations exist', () => {
  assert.match(reader, /if \(speechActive\) \{\s*reportSpeechLocator\(lastSpeechCfi, false\);/s);
  assert.match(reader, /function cfiProgression\(cfi\)/);
  assert.match(reader, /function spinePositionForCfi\(cfi, fallbackIndex\)/);
  assert.match(reader, /sectionCount: spine\.sectionCount/);
  assert.match(reader, /BookstrSpeech\.relocationProgression/);
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
  assert.match(reader, /window\.continueSpeechAfterSection = function\(notifyNative, requestID, attempts\)/);
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
  assert.match(reader, /window\.loadBookUrl = function\(url, cfi, theme, highlightCfi, bookId, highlightKind\)/);
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
