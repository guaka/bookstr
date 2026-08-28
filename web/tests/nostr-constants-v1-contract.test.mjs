import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('../generated/nostr-constants-v1.js');

test('generated web Nostr constants match the canonical v1 source', async () => {
  const canonical = JSON.parse(await readFile(
    new URL('../../shared/contracts/nostr-constants-v1.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(globalThis.BookstrNostrConstants, canonical);
});

test('web shell consumes generated Nostr constants before inline adapters', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="generated\/nostr-constants-v1\.js"><\/script>/);
  assert.match(html, /BookstrNostrConstants\.kinds\.favorites/);
  assert.match(html, /BookstrNostrConstants\.kinds\.progress/);
  assert.match(html, /BookstrNostrConstants\.dTags\.favorites/);
  assert.match(html, /BookstrNostrConstants\.prefixes\.vocabulary/);
});
