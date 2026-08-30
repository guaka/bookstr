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

test('pairing builders normalize defaults and reject untrusted control messages', () => {
  assert.equal(createDeviceAnnouncement(device, { now: 100, ttl: 2 }).expires_at, 130);
  assert.equal(createDeviceAnnouncement(device, { now: 100, ttl: 1000 }).expires_at, 700);
  assert.equal(createManifestRequest({ requestId: 'm', cursor: '  ', limit: -2 }).limit, 1);
  assert.equal(createTransferRequest({ requestId: 't', sha256: 'bad' }), null);
  const registry = revokeDevice(registerDevice({}, device, { now: 10 }), 'phone', { now: 20 });
  assert.equal(acceptDeviceMessage(registry, key, createManifestRequest({ requestId: 'm' }), { now: 21 }), null);
  assert.equal(acceptDeviceMessage(registerDevice({}, device, { now: 10 }), key, { type: 'unknown' }, { now: 21 }), null);
});

test('pairing builders generate safe request ids and current timestamps by default', () => {
  const manifest = createManifestRequest();
  assert.match(manifest.request_id, /^manifest-[a-f0-9]{24}$/);
  const transfer = createTransferRequest({ sha256: 'd'.repeat(64), private: false });
  assert.match(transfer.request_id, /^transfer-[a-f0-9]{24}$/);
  assert.equal(transfer.private, false);
  const announcement = createDeviceAnnouncement(device);
  assert.equal(announcement.device_id, 'phone');
  assert.ok(announcement.expires_at >= Math.floor(Date.now() / 1000) + 30);
});
