import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const reader = await readFile(new URL('./reader.html', import.meta.url), 'utf8');

test('iOS keeps the system text selection menu instead of a custom reader toolbar', () => {
  assert.match(reader, /if \(window\.bookstrNativeSwipeNavigation\) return;/);
  assert.doesNotMatch(reader, /id="selection-actions"/);
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
  assert.match(reader, /BookstrSpeech\.relocationProgression/);
  assert.match(reader, /rangeToCfi\(spokenRange\) \|\| elementBoundaryCfi\(block\.element, false\)/);
});
