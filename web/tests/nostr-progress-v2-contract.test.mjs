import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('../nostr-progress.js');
const { DEFAULT_D_TAG_PREFIX, parseProgressEvent } = globalThis.BookstrNostrProgress;
const fixture = JSON.parse(await readFile(new URL('../../shared/fixtures/reading-progress-v2.json', import.meta.url)));
const schema = JSON.parse(await readFile(new URL('../../shared/contracts/reading-progress-v2.schema.json', import.meta.url)));

test('web progress adapter conforms to every shared v2 compatibility case', () => {
  assert.equal(fixture.version, schema.properties.version.const);
  for (const entry of fixture.cases) {
    const actual = parseProgressEvent(
      { content: JSON.stringify(entry.content), created_at: entry.eventCreatedAt },
      entry.fallbackBookId,
    );
    if (!entry.valid) {
      assert.equal(actual, null, entry.name);
      continue;
    }
    assert.deepEqual({
      bookId: actual.bookId,
      progression: actual.progression,
      furthestProgression: actual.furthestProgression,
      cfi: actual.cfi,
      updatedAt: actual.updatedAt,
    }, entry.expected, entry.name);
  }
});

test('web progress adapter supports d-tags, tombstones, and browser locator aliases', () => {
  assert.equal(DEFAULT_D_TAG_PREFIX, 'app.bookstr.progress.');
  const deleted = parseProgressEvent({
    content: { deleted: true },
    created_at: '7',
    tags: [['x'], ['d', 'app.bookstr.progress.FromTag']],
  });
  assert.deepEqual(deleted, {
    payload: { deleted: true }, bookId: 'FromTag', updatedAt: 7000, deleted: true,
  });

  const locations = parseProgressEvent({
    content: { locator: { progression: 0.2, locations: { cfi: 'locations-cfi' }, href: 'fallback-href' } },
    tags: [['d', 'custom:book']],
  }, '', 'custom:');
  assert.equal(locations.cfi, 'locations-cfi');
  assert.equal(locations.bookId, 'book');

  const href = parseProgressEvent({ content: { bookId: 'href', locator: { progression: 0.3, href: 'chapter.xhtml' } } });
  assert.equal(href.cfi, 'chapter.xhtml');
  const flat = parseProgressEvent({ content: { bookId: 'flat', progression: 0.4, furthestProgression: 0.6, cfi: 'flat' } });
  assert.equal(flat.furthestProgression, 0.6);
});

test('web progress adapter rejects malformed envelopes and missing identities', () => {
  assert.equal(parseProgressEvent(null), null);
  assert.equal(parseProgressEvent({ content: 'not-json' }), null);
  assert.equal(parseProgressEvent({ content: [] }), null);
  assert.equal(parseProgressEvent({ content: { locator: [] } }, 'fallback'), null);
  assert.equal(parseProgressEvent({ content: { progression: 0.2 }, tags: 'bad' }), null);
  assert.equal(parseProgressEvent({ content: { progression: 0.2 }, tags: [['d', 1], ['d', 'other:value']] }), null);
});

test('web shell consumes the shared progress adapter and emits locator v2', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="nostr-progress\.js"><\/script>/);
  assert.match(html, /BookstrNostrProgress\.parseProgressEvent\(event\)/);
  assert.match(html, /content: JSON\.stringify\(\{\s*v: 2,[\s\S]*?locator: \{/);
});
