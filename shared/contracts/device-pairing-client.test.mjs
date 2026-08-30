import assert from 'node:assert/strict';
import test from 'node:test';
import * as nostrTools from '../../web/vendor/nostr-tools.js';
import { createManifestRequest, registerDevice } from './device-pairing-v1.mjs';
import { DevicePairingClient, createWebPairingClient } from './device-pairing-client.mjs';

function signerFor(secret) {
  return {
    getPublicKey: async () => nostrTools.getPublicKey(secret),
    nip44: {
      decrypt: async (peer, ciphertext) => nostrTools.nip44.v2.decrypt(ciphertext, nostrTools.nip44.v2.utils.getConversationKey(secret, peer)),
    },
  };
}

test('web client falls back to a session-only identity without secure storage', async () => {
  const account = nostrTools.generateSecretKey();
  const client = createWebPairingClient({ signer: signerFor(account), tools: nostrTools });
  const status = await client.status();
  assert.equal(status.platform, 'web');
  assert.equal(status.persistent, false);
  assert.equal(status.relays.length, 0);
});

test('native-style secure storage persists the device secret without exposing it', async () => {
  const account = nostrTools.generateSecretKey();
  let stored = null;
  const storage = {
    isAvailable: () => true,
    get: async () => stored,
    set: async secret => { stored = new Uint8Array(secret); },
  };
  const first = new DevicePairingClient({ platform: 'ios', signer: signerFor(account), tools: nostrTools, secureStorage: storage, name: 'Phone' });
  const firstStatus = await first.status();
  const secondStatus = await new DevicePairingClient({ platform: 'ios', signer: signerFor(account), tools: nostrTools, secureStorage: storage, name: 'Phone' }).status();
  assert.equal(firstStatus.persistent, true);
  assert.equal(secondStatus.devicePubkey, firstStatus.devicePubkey);
  assert.equal(Object.hasOwn(firstStatus, 'deviceSecret'), false);
  assert.equal(stored instanceof Uint8Array, true);
});

test('pairing client encrypts messages and enforces the shared device registry', async () => {
  const senderSecret = nostrTools.generateSecretKey();
  const recipientSecret = nostrTools.generateSecretKey();
  const sender = new DevicePairingClient({ platform: 'android', signer: signerFor(senderSecret), tools: nostrTools });
  const recipient = new DevicePairingClient({ platform: 'web', signer: signerFor(recipientSecret), tools: nostrTools });
  const senderStatus = await sender.status();
  const recipientStatus = await recipient.status();
  const registry = registerDevice({ devices: [] }, {
    device_id: senderStatus.deviceId,
    pubkey: senderStatus.devicePubkey,
    platform: 'android',
    capabilities: senderStatus.capabilities,
  }, { now: 100 });
  const wrapped = await sender.createEnvelope(recipientStatus.accountPubkey, createManifestRequest({ requestId: 'client-1' }), { now: 100 });
  const opened = await recipient.openEnvelope(wrapped, { senderPubkey: senderStatus.devicePubkey, registry, now: 100 });
  assert.equal(opened?.type, 'bookstr.library.manifest.request');
  assert.equal(opened?.request_id, 'client-1');
});

test('relay publication is limited to secure WSS endpoints', async () => {
  const account = nostrTools.generateSecretKey();
  const calls = [];
  const client = new DevicePairingClient({
    platform: 'web', signer: signerFor(account), tools: nostrTools,
    relays: ['wss://one.example', 'https://bad.example', 'wss://one.example'],
    publish: async (relay, event) => { calls.push([relay, event.kind]); return true; },
  });
  const recipient = nostrTools.getPublicKey(nostrTools.generateSecretKey());
  await client.publishMessage(createManifestRequest({ requestId: 'client-2' }), recipient, { now: 100 });
  assert.deepEqual(calls.map(call => call[0]), ['wss://one.example']);
  assert.equal(calls[0][1], 1059);
});
