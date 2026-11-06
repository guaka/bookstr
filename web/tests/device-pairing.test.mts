import assert from 'node:assert/strict';
import test from 'node:test';
import * as nostrTools from '../vendor/nostr-tools.js';
import { importWebRuntime } from './web-test-import.mts';
type PairingClientApi = {
  status(): Promise<{ platform: string; relays: string[]; persistent: boolean; accountPubkey?: string }>;
  announce(options?: { now?: number }): Promise<{ type: string; expires_at: number }>;
};
type CreateWebPairing = (options?: Record<string, unknown>) => Promise<PairingClientApi>;

const { createWebPairing } = await importWebRuntime('../device-pairing.js') as { createWebPairing: CreateWebPairing };

function signerFor(secret: Uint8Array): MigratedNostrSigner {
  return {
    getPublicKey: async () => nostrTools.getPublicKey(secret),
    signEvent: async event => nostrTools.finalizeEvent(event, secret),
    nip44: {
      encrypt: async () => { throw new Error('not used'); },
      decrypt: async () => { throw new Error('not used'); },
    },
  };
}

test('web adapter uses the supplied NIP-07 signer and tools', async () => {
  const secret = nostrTools.generateSecretKey();
  const signer = signerFor(secret);
  const pairing = await createWebPairing({ signer, tools: nostrTools, relays: ['wss://relay.example'] });
  const status = await pairing.status();
  assert.equal(status.platform, 'web');
  assert.equal(status.relays[0], 'wss://relay.example');
  assert.equal(status.persistent, false);
});

test('web adapter announces the device through the shared contract', async () => {
  const secret = nostrTools.generateSecretKey();
  const signer = signerFor(secret);
  const pairing = await createWebPairing({ signer, tools: nostrTools });
  const announcement = await pairing.announce({ now: 1_700_000_000 });
  assert.equal(announcement.type, 'bookstr.device.announce');
  assert.equal(announcement.expires_at, 1_700_000_120);
});

test('web adapter resolves the active browser signer without persisting a secret', async () => {
  const secret = nostrTools.generateSecretKey();
  const signer = signerFor(secret);
  const previousWindow = globalThis.window;
  const previousNostr = globalThis.nostr;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { nostr: signer } as unknown as Window });
    globalThis.nostr = undefined;
    const pairing = await createWebPairing({ tools: nostrTools });
    assert.equal((await pairing.status()).accountPubkey, nostrTools.getPublicKey(secret));
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: {} as Window });
    globalThis.nostr = signer;
    assert.equal((await (await createWebPairing({ tools: nostrTools })).status()).accountPubkey, nostrTools.getPublicKey(secret));
  } finally {
    globalThis.window = previousWindow;
    globalThis.nostr = previousNostr;
  }
});

test('web adapter loads the bundled tools when a native shell only supplies a signer', async () => {
  const secret = nostrTools.generateSecretKey();
  const pairing = await createWebPairing({ signer: signerFor(secret) });
  assert.equal((await pairing.status()).accountPubkey, nostrTools.getPublicKey(secret));
});
