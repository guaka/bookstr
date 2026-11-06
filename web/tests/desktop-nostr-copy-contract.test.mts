import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const nip17 = await readFile(new URL('../nip17-fetch.js', import.meta.url), 'utf8');

test('Electron-facing signer copy never assumes a NIP-07 browser extension', () => {
  assert.match(html, /const nostrSignerName = isDesktopMode \? 'Nostr signer' : 'NIP-07'/);
  assert.match(html, /Nostr signer not connected\. Open Settings to connect one\./);
  assert.match(html, /Favorites sync through your Nostr signer\./);
  assert.doesNotMatch(nip17, /NIP-07/);
  assert.match(nip17, /A Nostr signer with NIP-44 support is required/);
});
