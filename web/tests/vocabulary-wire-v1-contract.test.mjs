import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('../vocabulary-wire.js');
const { parseLegacyPayload, parsePayload } = globalThis.BookstrVocabularyWire;
const fixture = JSON.parse(await readFile(new URL('../../shared/fixtures/vocabulary-wire-v1.json', import.meta.url)));
const schema = JSON.parse(await readFile(new URL('../../shared/contracts/vocabulary-wire-v1.schema.json', import.meta.url)));

function comparable(value) {
  if (!value) return null;
  return Object.fromEntries(Object.keys(fixture.fields).map(field => [field, value[field]]));
}

test('web vocabulary adapter conforms to every shared v1 case', () => {
  assert.equal(fixture.version, schema.properties.version.const);
  for (const entry of fixture.cases) {
    assert.deepEqual(
      comparable(parsePayload(entry.payload, entry.fallbackUpdatedAt)),
      entry.valid ? entry.expected : null,
      entry.name,
    );
  }
});

test('web vocabulary adapter rejects malformed required fields', () => {
  const base = { word: 'word', language: 'en', syncId: 'sync', bookId: '', bookTitle: '' };
  assert.equal(parsePayload(null), null);
  assert.equal(parsePayload([]), null);
  assert.equal(parsePayload({ ...base, word: 1 }), null);
  assert.equal(parsePayload({ ...base, language: 1 }), null);
  assert.equal(parsePayload({ ...base, syncId: 1 }), null);
  assert.equal(parsePayload({ ...base, bookId: 1 }), null);
  assert.equal(parsePayload({ ...base, bookTitle: 1 }), null);

  const defaults = parsePayload({
    ...base,
    lastSeenAt: 1,
    definitions: ['kept', '', 3],
    lookupCount: 'not-a-number',
  });
  assert.deepEqual(defaults.definitions, ['kept']);
  assert.equal(defaults.lookupCount, 1);

  const eventFallback = parsePayload(base, 7);
  assert.equal(eventFallback.firstSeenAt, 7);
  assert.equal(eventFallback.lastSeenAt, 7);
  assert.equal(eventFallback.updatedAt, 7);
});

test('web vocabulary adapter retains legacy browser payload compatibility', () => {
  assert.equal(parseLegacyPayload(null), null);
  assert.equal(parseLegacyPayload([]), null);
  assert.equal(parseLegacyPayload({ word: '' }), null);
  assert.deepEqual(parseLegacyPayload({
    word: ' Legacy ', sourceLanguage: 'EN', definitions: ['kept', ''], deleted: 1,
    bookId: 23, bookTitle: 42, cfi: 7, contextSentence: 8, partOfSpeech: 9,
    sourceUrl: 10, lookupCount: 'bad', firstSeenAt: 'bad', lastSeenAt: 6,
  }, 5), {
    word: 'legacy', sourceLanguage: 'EN', language: 'en', key: 'en:legacy',
    definitions: ['kept'], deleted: true, bookId: '23', bookTitle: '42', cfi: '7',
    contextSentence: '8', partOfSpeech: '9', sourceUrl: '10', lookupCount: 1,
    firstSeenAt: 6, lastSeenAt: 6, updatedAt: 6,
  });
  const aliased = parseLegacyPayload({ word: 'Alias', lang: 'FR', key: 'custom', updatedAt: 4 });
  assert.equal(aliased.language, 'fr');
  assert.equal(aliased.key, 'custom');
  assert.equal(aliased.updatedAt, 4);
  assert.equal(parseLegacyPayload({ word: 'Fallback' }, 3).updatedAt, 3);
});

test('web shell delegates decrypted vocabulary wire parsing', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="vocabulary-wire\.js"><\/script>/);
  assert.match(html, /BookstrVocabularyWire\.parsePayload\(payload, fallbackUpdatedAt\)/);
  assert.match(html, /BookstrVocabularyWire\.parseLegacyPayload\(payload, fallbackUpdatedAt\)/);
});
