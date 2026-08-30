'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const nostrTools = require('../../../web/vendor/nostr-tools.js');
const { ElectronDevicePairing } = require('../../device-pairing');

function fakeStorage(available) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: value => Buffer.from(`encrypted:${value}`),
    decryptString: value => Buffer.from(value).toString().replace(/^encrypted:/, ''),
  };
}

function adapter(state, available) {
  return new ElectronDevicePairing({
    loadState: async () => state,
    saveState: async next => Object.assign(state, next),
    safeStorage: fakeStorage(available),
    loadTools: async () => nostrTools,
    accountPublicKey: async () => 'a'.repeat(64),
    decryptForAccount: async () => { throw new Error('not used'); },
    relays: ['wss://relay.example', 'https://not-secure.example'],
  });
}

test('uses encrypted persistent device storage when Linux keyring is available', async () => {
  const state = {};
  const first = adapter(state, true);
  const firstStatus = await first.status();
  assert.equal(firstStatus.persistent, true);
  assert.match(state.devicePairing.secret, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(state.devicePairing.pubkey, firstStatus.devicePubkey);
  const secondStatus = await adapter(state, true).status();
  assert.equal(secondStatus.devicePubkey, firstStatus.devicePubkey);
});

test('falls back to session-only device identity without plaintext persistence', async () => {
  const state = {};
  const pairing = adapter(state, false);
  const status = await pairing.status();
  assert.equal(status.persistent, false);
  assert.equal(state.devicePairing, undefined);
  assert.deepEqual(status.relays, ['wss://relay.example']);
});

test('builds an encrypted device announce envelope without exposing the device secret', async () => {
  const pairing = adapter({}, false);
  const recipientPubkey = nostrTools.getPublicKey(nostrTools.generateSecretKey());
  const wrapped = await pairing.createEnvelope(recipientPubkey, {
    version: 1,
    type: 'bookstr.device.announce',
    device_id: 'ignored-by-envelope',
    expires_at: Math.floor(Date.now() / 1000) + 120,
  });
  assert.equal(wrapped.kind, 1059);
  assert.equal(Object.hasOwn(wrapped, 'deviceSecret'), false);
});

test('opens envelopes against the main-process registry and clock', async () => {
  const senderAccount = nostrTools.generateSecretKey();
  const recipientAccount = nostrTools.generateSecretKey();
  const sender = new ElectronDevicePairing({
    loadState: async () => ({}),
    saveState: async () => {},
    safeStorage: fakeStorage(false),
    loadTools: async () => nostrTools,
    accountPublicKey: async () => nostrTools.getPublicKey(senderAccount),
    decryptForAccount: async () => { throw new Error('not used'); },
    clock: () => 100,
  });
  const recipient = new ElectronDevicePairing({
    loadState: async () => ({}),
    saveState: async () => {},
    safeStorage: fakeStorage(false),
    loadTools: async () => nostrTools,
    accountPublicKey: async () => nostrTools.getPublicKey(recipientAccount),
    decryptForAccount: async (peer, ciphertext) => nostrTools.nip44.v2.decrypt(
      ciphertext,
      nostrTools.nip44.v2.utils.getConversationKey(recipientAccount, peer),
    ),
    loadRegistry: async () => ({
      version: 1,
      devices: [{
        device_id: (await sender.status()).deviceId,
        pubkey: (await sender.status()).devicePubkey,
        platform: 'electron',
      }],
    }),
    clock: () => 100,
  });
  const senderStatus = await sender.status();
  const recipientPubkey = await recipient.accountPublicKey();
  const wrapped = await sender.createEnvelope(recipientPubkey, {
    type: 'bookstr.library.manifest.request',
    request_id: 'trusted-registry',
  });
  const opened = await recipient.openEnvelope(wrapped, {
    senderPubkey: senderStatus.devicePubkey,
    // These renderer-controlled values are intentionally ignored.
    registry: { devices: [{ device_id: 'attacker', pubkey: 'b'.repeat(64), platform: 'web' }] },
    now: 9999999999,
  });
  assert.equal(opened?.request_id, 'trusted-registry');
});
