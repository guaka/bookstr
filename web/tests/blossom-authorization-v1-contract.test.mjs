import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('../blossom-authorization.js');
const { KIND, authorizationHeader, unsignedGetEvent } = globalThis.BookstrBlossomAuthorization;
const fixture = JSON.parse(await readFile(new URL('../../shared/fixtures/blossom-authorization-v1.json', import.meta.url)));
const schema = JSON.parse(await readFile(new URL('../../shared/contracts/blossom-authorization-v1.schema.json', import.meta.url)));

test('web Blossom authorization builder conforms to every shared v1 case', () => {
  assert.equal(fixture.version, schema.properties.version.const);
  assert.equal(KIND, 24242);
  for (const entry of fixture.cases) {
    let actual;
    try {
      actual = unsignedGetEvent(entry.hash, entry.server, entry.now, entry.content);
    } catch {
      actual = null;
    }
    assert.deepEqual(actual, entry.valid ? entry.expected : null, entry.name);
  }
});

test('web Blossom builder rejects non-string inputs and encodes UTF-8 headers', () => {
  assert.throws(() => unsignedGetEvent(null, 'blossom.bfr.ee', 1, 'Download'), /SHA-256/);
  assert.throws(() => unsignedGetEvent('a'.repeat(64), null, 1, 'Download'), /server name/);
  const event = unsignedGetEvent('a'.repeat(64), 'blossom.bfr.ee', 1, 'Télécharger');
  const header = authorizationHeader(event);
  assert.match(header, /^Nostr [A-Za-z0-9+/]+=*$/);
  assert.deepEqual(JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8')), event);
});

test('web shell no longer loads or invokes Blossom authorization', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script src="blossom-authorization\.js"><\/script>/);
  assert.doesNotMatch(html, /BookstrBlossomAuthorization/);
});
