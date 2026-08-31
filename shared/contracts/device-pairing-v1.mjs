import { isAuthorizedDevice, normalizeDeviceRegistry, normalizeTransferMessage } from './device-transfer-v1.mjs';

function nowSeconds(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? Math.floor(result) : Math.floor(Date.now() / 1000);
}

function randomID(prefix) {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(bytes);
  const suffix = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function normalizedDevice(device, timestamp) {
  const registry = normalizeDeviceRegistry({ devices: [device] });
  const result = registry.devices[0];
  if (!result) throw new TypeError('device is invalid');
  return {
    ...result,
    created_at: result.created_at || timestamp,
    last_seen: result.last_seen || timestamp,
    revoked_at: 0,
  };
}

export function registerDevice(registry, device, { now } = {}) {
  const timestamp = nowSeconds(now);
  const current = normalizeDeviceRegistry(registry);
  const next = normalizedDevice(device, timestamp);
  const devices = current.devices.filter(candidate => candidate.device_id !== next.device_id);
  devices.push(next);
  return normalizeDeviceRegistry({ version: 1, devices: devices.slice(-64) });
}

export function touchDevice(registry, deviceId, { now } = {}) {
  const timestamp = nowSeconds(now);
  const current = normalizeDeviceRegistry(registry);
  return normalizeDeviceRegistry({
    version: 1,
    devices: current.devices.map(device => device.device_id === String(deviceId || '').trim()
      ? { ...device, last_seen: timestamp }
      : device),
  });
}

export function revokeDevice(registry, deviceId, { now } = {}) {
  const timestamp = nowSeconds(now);
  const current = normalizeDeviceRegistry(registry);
  return normalizeDeviceRegistry({
    version: 1,
    devices: current.devices.map(device => device.device_id === String(deviceId || '').trim()
      ? { ...device, revoked_at: timestamp }
      : device),
  });
}

export function createDeviceAnnouncement(device, { now, ttl = 120 } = {}) {
  const timestamp = nowSeconds(now);
  const normalized = normalizedDevice(device, timestamp);
  const lifetime = Math.max(30, Math.min(600, Number(ttl) || 120));
  return normalizeTransferMessage({
    version: 1,
    type: 'bookstr.device.announce',
    device_id: normalized.device_id,
    expires_at: timestamp + lifetime,
  });
}

export function createManifestRequest({ requestId = randomID('manifest'), cursor = '', limit = 25 } = {}) {
  return normalizeTransferMessage({ version: 1, type: 'bookstr.library.manifest.request', request_id: requestId, cursor, limit });
}

export function createTransferRequest({ sha256, size = 0, private: isPrivate = true, requestId = randomID('transfer') } = {}) {
  return normalizeTransferMessage({ version: 1, type: 'bookstr.transfer.request', request_id: requestId, sha256, size, private: isPrivate });
}

export function acceptDeviceMessage(registry, senderPubkey, message, { now } = {}) {
  const normalizedRegistry = normalizeDeviceRegistry(registry);
  if (!isAuthorizedDevice(normalizedRegistry, senderPubkey)) return null;
  const normalized = normalizeTransferMessage(message);
  if (!normalized) return null;
  const sender = normalizedRegistry.devices.find(device => device.pubkey === String(senderPubkey || '').trim().toLowerCase() && !device.revoked_at);
  if (!sender) return null;
  if (normalized.type === 'bookstr.device.announce' && normalized.device_id !== sender.device_id) return null;
  const timestamp = nowSeconds(now);
  if (normalized.type === 'bookstr.device.announce' && normalized.expires_at <= timestamp) return null;
  if (normalized.type === 'bookstr.transfer.offer' && normalized.expires_at <= timestamp) return null;
  return normalized;
}
