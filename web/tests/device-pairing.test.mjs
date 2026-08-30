import assert from 'node:assert/strict';
import test from 'node:test';
import * as nostrTools from '../vendor/nostr-tools.js';
import { createWebPairing } from '../device-pairing.js';

test('web adapter uses the supplied NIP-07 signer and tools', async () => {
  const secret = nostrTools.generateSecretKey();
  const signer = {
    getPublicKey: async () => nostrTools.getPublicKey(secret),
    nip44: { decrypt: async () => { throw new Error('not used'); } },
  };
  const pairing = await createWebPairing({ signer, tools: nostrTools, relays: ['wss://relay.example'] });
  const status = await pairing.status();
  assert.equal(status.platform, 'web');
  assert.equal(status.relays[0], 'wss://relay.example');
  assert.equal(status.persistent, false);
});

