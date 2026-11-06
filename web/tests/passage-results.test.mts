import test from 'node:test';
import { importWebRuntime } from './web-test-import.mts';
import assert from 'node:assert/strict';
import type { PassageResultsApi } from '../src/passage-results.js';

await importWebRuntime('../passage-results.js');
const { normalizePassageHits, passageResultsMarkup, sourceFilename } = (globalThis as typeof globalThis & { PassageResults: PassageResultsApi }).PassageResults;

test('normalizes and renders cited passages separately from book cards', () => {
  const entries = normalizePassageHits({ hits: [{
    citation: {
      uri: 'file:///books/a%20book.epub',
      title: 'Citation title',
      heading_path: ['Chapter One', 'A green idea'],
      snippet: 'The exact <cited> passage.',
      block: { page: 12 },
      metadata: { dublin_core: { creator: ['Ada Writer'], format: 'application/epub+zip' } },
    },
    book: { md5: 'a'.repeat(32), title: 'Green Library', authors: 'Ada Writer', extension: 'epub' },
  }] });
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.ok(entry);
  assert.equal(entry.title, 'Green Library');
  assert.equal(entry.heading, 'Chapter One › A green idea');
  assert.equal(entry.provenance, 'EPUB · p. 12 · a book.epub');
  const markup = passageResultsMarkup([{ ...entry, canOpen: true }]);
  assert.match(markup, /class="passage-result"/);
  assert.match(markup, /data-passage-open="0"/);
  assert.match(markup, /Chapter One › A green idea/);
  assert.match(markup, /The exact &lt;cited&gt; passage/);
  assert.doesNotMatch(markup, /class="book-table"/);
});

test('renders citations even when book enrichment is unavailable', () => {
  const entries = normalizePassageHits({ hits: [{
    citation: { uri: 'file:///books/unknown.pdf', title: 'Unknown source', snippet: 'Still a valid passage.' },
    book: null,
  }] });
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.ok(entry);
  assert.equal(entry.title, 'Unknown source');
  const markup = passageResultsMarkup([{ ...entry, canOpen: false }]);
  assert.match(markup, /Still a valid passage/);
  assert.doesNotMatch(markup, /data-passage-open/);
});

test('extracts concise source filenames without exposing the full local path', () => {
  assert.equal(sourceFilename('file:///private/cache/green%20library.pdf'), 'green library.pdf');
  assert.equal(sourceFilename('%not-a-url%'), '');
});

test('normalizes passage hits only when citation snippets are present', () => {
  assert.deepEqual(normalizePassageHits({}), []);
  assert.deepEqual(normalizePassageHits({ hits: [{ book: { title: 'No citation' } }] }), []);
  assert.deepEqual(
    normalizePassageHits({
      hits: [{
        citation: { uri: 'file:///books/a.epub', snippet: '   ', title: 'Ignored' },
        book: { title: 'Ignored' },
      }],
    }),
    [],
  );
});

test('normalizes passage metadata when metadata formats are missing', () => {
  const entries = normalizePassageHits({
    hits: [{
      citation: {
        uri: 'file:///books/b%20book.epub',
        title: 'Mystery',
        snippet: 'A valid snippet.',
        block: { page: 0 },
      },
      book: { title: 'Untitled', md5: 'B'.repeat(32), authors: ['Alice', 'Bob'] },
    }],
  });

  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.ok(entry);
  assert.equal(entry.provenance, 'b book.epub');
  assert.equal(entry.authors, 'Alice, Bob');
});

test('renders empty passage results as an empty-state note', () => {
  assert.equal(passageResultsMarkup([]), '<p class=\"note\">No matching passages.</p>');
});
