import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuthorizedDevice, normalizeDeviceRegistry, normalizeTransferMessage } from './device-transfer-v1.mjs';

const key = 'a'.repeat(64);
const hash = 'b'.repeat(64);
const infohash = 'c'.repeat(40);

test('device registry is bounded, normalized, and revocable', () => {
  const registry = normalizeDeviceRegistry({ devices: [{ device_id: 'laptop', pubkey: key, platform: 'electron', name: 'Laptop' }] });
  assert.equal(registry.version, 1);
  assert.equal(isAuthorizedDevice(registry, key), true);
  registry.devices[0].revoked_at = 123;
  assert.equal(isAuthorizedDevice(registry, key), false);
});
test('private transfer messages carry hashes and no filesystem paths', () => {
  const page = normalizeTransferMessage({
    type: 'bookstr.library.manifest.page', request_id: 'r1', entries: [{ id: 'book', title: 'Title', sha256: hash, path: '/secret' }],
  });
  assert.equal(page.version, 1);
  assert.equal(page.entries[0].sha256, hash);
  assert.equal(Object.hasOwn(page.entries[0], 'path'), false);
  const offer = normalizeTransferMessage({ type: 'bookstr.transfer.offer', request_id: 'r1', sha256: hash, infohash, expires_at: 9, ice: ['candidate'] });
  assert.equal(offer.infohash, infohash);
  assert.deepEqual(normalizeTransferMessage({ type: 'unknown' }), null);
});
