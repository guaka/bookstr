import test from 'node:test';
import assert from 'node:assert/strict';

await import('../passage-results.js');
const { normalizePassageHits, passageResultsMarkup, sourceFilename } = globalThis.PassageResults;

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
  assert.equal(entries[0].title, 'Green Library');
  assert.equal(entries[0].heading, 'Chapter One › A green idea');
  assert.equal(entries[0].provenance, 'EPUB · p. 12 · a book.epub');
  const markup = passageResultsMarkup([{ ...entries[0], canOpen: true }]);
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
  assert.equal(entries[0].title, 'Unknown source');
  const markup = passageResultsMarkup([{ ...entries[0], canOpen: false }]);
  assert.match(markup, /Still a valid passage/);
  assert.doesNotMatch(markup, /data-passage-open/);
});

test('extracts concise source filenames without exposing the full local path', () => {
  assert.equal(sourceFilename('file:///private/cache/green%20library.pdf'), 'green library.pdf');
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
  assert.equal(entries[0].provenance, 'b book.epub');
  assert.equal(entries[0].authors, 'Alice, Bob');
});

test('renders empty passage results as an empty-state note', () => {
  assert.equal(passageResultsMarkup([]), '<p class=\"note\">No matching passages.</p>');
});
