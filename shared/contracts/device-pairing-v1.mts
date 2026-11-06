import { isAuthorizedDevice, normalizeDeviceRegistry, normalizeTransferMessage } from './device-transfer-v1.mjs';
import type { TransferMessage } from './device-transfer-v1.mjs';

type DeviceOptions = { now?: unknown };

function nowSeconds(value: unknown): number {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? Math.floor(result) : Math.floor(Date.now() / 1000);
}

function randomID(prefix: string): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(bytes);
  const suffix = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function normalizedDevice(device: unknown, timestamp: number) {
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

export function registerDevice(registry: unknown, device: unknown, { now }: DeviceOptions = {}) {
  const timestamp = nowSeconds(now);
  const current = normalizeDeviceRegistry(registry);
  const next = normalizedDevice(device, timestamp);
  const devices = current.devices.filter(candidate => candidate.device_id !== next.device_id);
  devices.push(next);
  return normalizeDeviceRegistry({ version: 1, devices: devices.slice(-64) });
}

export function touchDevice(registry: unknown, deviceId: unknown, { now }: DeviceOptions = {}) {
  const timestamp = nowSeconds(now);
  const current = normalizeDeviceRegistry(registry);
  return normalizeDeviceRegistry({
    version: 1,
    devices: current.devices.map(device => device.device_id === String(deviceId || '').trim()
      ? { ...device, last_seen: timestamp }
      : device),
  });
}

export function revokeDevice(registry: unknown, deviceId: unknown, { now }: DeviceOptions = {}) {
  const timestamp = nowSeconds(now);
  const current = normalizeDeviceRegistry(registry);
  return normalizeDeviceRegistry({
    version: 1,
    devices: current.devices.map(device => device.device_id === String(deviceId || '').trim()
      ? { ...device, revoked_at: timestamp }
      : device),
  });
}

export function createDeviceAnnouncement(device: unknown, { now, ttl = 120 }: DeviceOptions & { ttl?: number } = {}): Extract<TransferMessage, { type: 'bookstr.device.announce' }> {
  const timestamp = nowSeconds(now);
  const normalized = normalizedDevice(device, timestamp);
  const lifetime = Math.max(30, Math.min(600, Number(ttl) || 120));
  return normalizeTransferMessage({
    version: 1,
    type: 'bookstr.device.announce',
    device_id: normalized.device_id,
    expires_at: timestamp + lifetime,
  }) as Extract<TransferMessage, { type: 'bookstr.device.announce' }>;
}

export function createManifestRequest({ requestId = randomID('manifest'), cursor = '', limit = 25 }: { requestId?: string; cursor?: string; limit?: number } = {}): Extract<TransferMessage, { type: 'bookstr.library.manifest.request' }> {
  return normalizeTransferMessage({ version: 1, type: 'bookstr.library.manifest.request', request_id: requestId, cursor, limit }) as Extract<TransferMessage, { type: 'bookstr.library.manifest.request' }>;
}

export function createTransferRequest({ sha256, size = 0, private: isPrivate = true, requestId = randomID('transfer') }: { sha256?: string; size?: number; private?: boolean; requestId?: string } = {}): Extract<TransferMessage, { type: 'bookstr.transfer.request' }> | null {
  return normalizeTransferMessage({ version: 1, type: 'bookstr.transfer.request', request_id: requestId, sha256, size, private: isPrivate }) as Extract<TransferMessage, { type: 'bookstr.transfer.request' }> | null;
}

export function acceptDeviceMessage(registry: unknown, senderPubkey: unknown, message: unknown, { now }: DeviceOptions = {}) {
  const normalizedRegistry = normalizeDeviceRegistry(registry);
  if (!isAuthorizedDevice(normalizedRegistry, senderPubkey)) return null;
  const normalized = normalizeTransferMessage(message);
  if (!normalized) return null;
  const sender = normalizedRegistry.devices.find(device => device.pubkey === String(senderPubkey || '').trim().toLowerCase() && !device.revoked_at);
  if (!sender) return null;
  if (normalized.type === 'bookstr.device.announce' && normalized.device_id !== sender.device_id) return null;
  const timestamp = nowSeconds(now);
  if (normalized.type === 'bookstr.device.announce' && Number(normalized.expires_at) <= timestamp) return null;
  if (normalized.type === 'bookstr.transfer.offer' && Number(normalized.expires_at) <= timestamp) return null;
  return normalized;
}
