import assert from 'node:assert/strict';
import test from 'node:test';
import * as nostrTools from '../../web/vendor/nostr-tools.js';
import {
  DEVICE_REGISTRY_D_TAG_V1,
  DEVICE_REGISTRY_KIND_V1,
  verifyDeviceRegistryEvent,
} from './device-registry-nip78.mjs';

function registryEvent(secret, devices = []) {
  const owner = nostrTools.getPublicKey(secret);
  const conversationKey = nostrTools.nip44.v2.utils.getConversationKey(secret, owner);
  return nostrTools.finalizeEvent({
    kind: DEVICE_REGISTRY_KIND_V1,
    created_at: 100,
    tags: [['d', DEVICE_REGISTRY_D_TAG_V1]],
    content: nostrTools.nip44.v2.encrypt(JSON.stringify({ version: 1, devices }), conversationKey),
  }, secret);
}

test('verifies and decrypts an account-owned device registry event', async () => {
  const account = nostrTools.generateSecretKey();
  const deviceSecret = nostrTools.generateSecretKey();
  const devicePubkey = nostrTools.getPublicKey(deviceSecret);
  const event = registryEvent(account, [{ device_id: 'phone', pubkey: devicePubkey, platform: 'ios' }]);
  const registry = await verifyDeviceRegistryEvent(event, {
    ownerPubkey: nostrTools.getPublicKey(account),
    tools: nostrTools,
    decrypt: async (peer, ciphertext) => nostrTools.nip44.v2.decrypt(
      ciphertext,
      nostrTools.nip44.v2.utils.getConversationKey(account, peer),
    ),
  });
  assert.equal(registry.devices[0].device_id, 'phone');
  assert.equal(registry.devices[0].pubkey, devicePubkey);
});

test('rejects a registry event without the account signature or decryptable payload', async () => {
  const account = nostrTools.generateSecretKey();
  const other = nostrTools.generateSecretKey();
  const event = registryEvent(other);
  const options = {
    ownerPubkey: nostrTools.getPublicKey(account),
    tools: nostrTools,
    decrypt: async () => { throw new Error('wrong account'); },
  };
  assert.equal(await verifyDeviceRegistryEvent(event, options), null);
  const tampered = { ...registryEvent(account), content: 'not-a-nip44-payload' };
  assert.equal(await verifyDeviceRegistryEvent(tampered, options), null);
});
