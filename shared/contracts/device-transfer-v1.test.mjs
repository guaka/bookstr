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

test('normalizes every supported message shape and rejects malformed fields', () => {
  const registry = normalizeDeviceRegistry({ devices: [
    { device_id: ' phone ', pubkey: key.toUpperCase(), platform: 'unsupported', name: ' Phone ', capabilities: ['library', '', 'x'.repeat(41)], created_at: '2', last_seen: -1 },
    { device_id: '', pubkey: key },
  ] });
  assert.deepEqual(registry.devices, [{ device_id: 'phone', pubkey: key, platform: 'web', name: 'Phone', capabilities: ['library'], created_at: 2, last_seen: 0, revoked_at: 0 }]);
  assert.equal(isAuthorizedDevice({}, key), false);
  assert.equal(isAuthorizedDevice(registry, 'bad'), false);
  assert.deepEqual(normalizeTransferMessage({ type: 'bookstr.library.manifest.request', request_id: 'r', cursor: 'next', limit: 0 }), {
    version: 1, type: 'bookstr.library.manifest.request', request_id: 'r', cursor: 'next', limit: 25,
  });
  assert.deepEqual(normalizeTransferMessage({ type: 'bookstr.library.manifest.page', request_id: 'r', next_cursor: 'next', entries: [
    { id: 'b', title: 'T', authors: 'A', language: 'en', format: 'epub', sha256: hash, size: '4', rights_status: 'open_license' },
    { id: 'bad', sha256: 'nope' },
  ] }), {
    version: 1, type: 'bookstr.library.manifest.page', request_id: 'r', next_cursor: 'next', entries: [{ id: 'b', title: 'T', authors: 'A', language: 'en', format: 'epub', sha256: hash, size: 4, rights_status: 'open_license' }],
  });
  assert.deepEqual(normalizeTransferMessage({ type: 'bookstr.transfer.request', request_id: 'r', sha256: hash, size: -1, private: false }), {
    version: 1, type: 'bookstr.transfer.request', request_id: 'r', sha256: hash, size: 0, private: false,
  });
  assert.deepEqual(normalizeTransferMessage({ type: 'bookstr.transfer.answer', request_id: 'r', infohash, ice: ['answer', '', 'x'.repeat(2001)] }), {
    version: 1, type: 'bookstr.transfer.answer', request_id: 'r', infohash, ice: ['answer'],
  });
  for (const value of [null, [], { type: 'bookstr.transfer.request', request_id: 'r', sha256: 'bad' }, { type: 'bookstr.device.announce', device_id: 'phone', expires_at: 0 }, { type: 'bookstr.transfer.offer', request_id: 'r', sha256: hash, infohash, expires_at: 0 }]) {
    assert.equal(normalizeTransferMessage(value), null);
  }
});
