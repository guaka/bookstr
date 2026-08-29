import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const reader = await readFile(new URL('./reader.html', import.meta.url), 'utf8');

test('speech progress uses a muted sage highlight distinct from known-word gold', () => {
  assert.match(reader, /window\.showSpeechProgress = function\(start, end\)/);
  assert.match(
    reader,
    /\.bookstr-speaking\{background:rgba\(127,184,167,\.18\)!important;/,
  );
  assert.match(reader, /box-shadow:inset 3px 0 0 #7fb8a7/);
  assert.match(
    reader,
    /::highlight\(bookstr-speaking-word\)\{background:rgba\(47,93,80,\.32\);color:inherit\}/,
  );
  assert.match(reader, /::highlight\(bookstr-known-word\)\{background:#e7c766;/);
  assert.doesNotMatch(
    reader,
    /::highlight\(bookstr-speaking-word\)\{background:#e7c766/,
  );
});
