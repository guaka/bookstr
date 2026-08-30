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

test('web adapter resolves the active browser signer without persisting a secret', async () => {
  const secret = nostrTools.generateSecretKey();
  const signer = {
    getPublicKey: async () => nostrTools.getPublicKey(secret),
    nip44: { decrypt: async () => { throw new Error('not used'); } },
  };
  const previousWindow = globalThis.window;
  const previousNostr = globalThis.nostr;
  try {
    globalThis.window = { nostr: signer };
    globalThis.nostr = undefined;
    const pairing = await createWebPairing({ tools: nostrTools });
    assert.equal((await pairing.status()).accountPubkey, nostrTools.getPublicKey(secret));
    globalThis.window = {};
    globalThis.nostr = signer;
    assert.equal((await (await createWebPairing({ tools: nostrTools })).status()).accountPubkey, nostrTools.getPublicKey(secret));
  } finally {
    globalThis.window = previousWindow;
    globalThis.nostr = previousNostr;
  }
});

test('web adapter loads the bundled tools when a native shell only supplies a signer', async () => {
  const secret = nostrTools.generateSecretKey();
  const pairing = await createWebPairing({
    signer: {
      getPublicKey: async () => nostrTools.getPublicKey(secret),
      nip44: { decrypt: async () => { throw new Error('not used'); } },
    },
  });
  assert.equal((await pairing.status()).accountPubkey, nostrTools.getPublicKey(secret));
});
