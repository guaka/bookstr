import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptDeviceMessage,
  createDeviceAnnouncement,
  createManifestRequest,
  createTransferRequest,
  registerDevice,
  revokeDevice,
  touchDevice,
} from './device-pairing-v1.mjs';

const key = 'a'.repeat(64);
const device = { device_id: 'phone', pubkey: key, platform: 'ios', name: 'Phone' };

test('device registration is replaceable, touchable, and revocable', () => {
  let registry = registerDevice({}, device, { now: 100 });
  assert.equal(registry.devices[0].created_at, 100);
  registry = registerDevice(registry, { ...device, name: 'New phone' }, { now: 110 });
  assert.equal(registry.devices.length, 1);
  assert.equal(registry.devices[0].name, 'New phone');
  registry = touchDevice(registry, 'phone', { now: 120 });
  assert.equal(registry.devices[0].last_seen, 120);
  registry = revokeDevice(registry, 'phone', { now: 130 });
  assert.equal(registry.devices[0].revoked_at, 130);
});

test('pairing builders produce bounded transfer messages', () => {
  assert.deepEqual(createDeviceAnnouncement(device, { now: 100, ttl: 60 }), {
    version: 1, type: 'bookstr.device.announce', device_id: 'phone', expires_at: 160,
  });
  assert.equal(createManifestRequest({ requestId: 'm-1', limit: 500 }).limit, 100);
  assert.equal(createTransferRequest({ requestId: 't-1', sha256: 'b'.repeat(64) }).private, true);
});

test('only authorized, unexpired devices may deliver control messages', () => {
  const registry = registerDevice({}, device, { now: 100 });
  const request = createManifestRequest({ requestId: 'm-2' });
  assert.equal(acceptDeviceMessage(registry, key, request, { now: 100 }).request_id, 'm-2');
  assert.equal(acceptDeviceMessage(registry, 'c'.repeat(64), request, { now: 100 }), null);
  const expired = createDeviceAnnouncement(device, { now: 100, ttl: 30 });
  assert.equal(acceptDeviceMessage(registry, key, expired, { now: 130 }), null);
  assert.equal(acceptDeviceMessage(registry, key, { ...expired, expires_at: 200, device_id: 'other' }, { now: 100 }), null);
});
