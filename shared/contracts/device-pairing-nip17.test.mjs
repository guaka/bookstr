import assert from 'node:assert/strict';
import test from 'node:test';
import * as nostrTools from '../../web/vendor/nostr-tools.js';
import { createDeviceControlWrap, publishDeviceControlMessage, unwrapDeviceControlWrap } from './device-pairing-nip17.mjs';
import { createManifestRequest } from './device-pairing-v1.mjs';

const recipientSecret = nostrTools.generateSecretKey();
const senderSecret = nostrTools.generateSecretKey();
const recipientPubkey = nostrTools.getPublicKey(recipientSecret);
const senderPubkey = nostrTools.getPublicKey(senderSecret);
const tools = {
  generateSecretKey: nostrTools.generateSecretKey,
  getPublicKey: nostrTools.getPublicKey,
  finalizeEvent: nostrTools.finalizeEvent,
  verifyEvent: nostrTools.verifyEvent,
  nip44: nostrTools.nip44,
};

const recipientSigner = {
  getPublicKey: async () => recipientPubkey,
  nip44: {
    decrypt: async (peer, ciphertext) => nostrTools.nip44.v2.decrypt(ciphertext, nostrTools.nip44.v2.utils.getConversationKey(recipientSecret, peer)),
  },
};

test('creates and unwraps an encrypted device control message', async () => {
  const wrapped = await createDeviceControlWrap(createManifestRequest({ requestId: 'm-1' }), {
    deviceSecret: senderSecret,
    recipientPubkey,
    tools,
    now: 1000,
  });
  assert.equal(wrapped.kind, 1059);
  const message = await unwrapDeviceControlWrap(wrapped, { senderPubkey, recipientSigner, tools, now: 1000 });
  assert.deepEqual(message, { version: 1, type: 'bookstr.library.manifest.request', request_id: 'm-1', cursor: '', limit: 25 });
});

test('rejects expired, tampered, and misaddressed wraps', async () => {
  const wrapped = await createDeviceControlWrap(createManifestRequest({ requestId: 'm-2' }), {
    deviceSecret: senderSecret, recipientPubkey, tools, now: 1000, ttl: 60,
  });
  assert.equal(await unwrapDeviceControlWrap(wrapped, { senderPubkey, recipientSigner, tools, now: 1060 }), null);
  assert.equal(await unwrapDeviceControlWrap({ ...wrapped, tags: [['p', 'c'.repeat(64)], ...wrapped.tags.slice(1)] }, { senderPubkey, recipientSigner, tools, now: 1000 }), null);
  assert.equal(await unwrapDeviceControlWrap({ ...wrapped, content: `${wrapped.content}tampered` }, { senderPubkey, recipientSigner, tools, now: 1000 }), null);
});

test('publishes once to each secure relay and requires one acceptance', async () => {
  const calls = [];
  const result = await publishDeviceControlMessage(createManifestRequest({ requestId: 'm-3' }), {
    deviceSecret: senderSecret,
    recipientPubkey,
    tools,
    now: 1000,
    relays: ['wss://one.example', 'https://insecure.example', 'wss://two.example', 'wss://one.example'],
    publish: async (relay, wrap) => { calls.push([relay, wrap.kind]); return relay === 'wss://two.example'; },
  });
  assert.deepEqual(calls.map(call => call[0]), ['wss://one.example', 'wss://two.example']);
  assert.equal(result.wrap.kind, 1059);
});

