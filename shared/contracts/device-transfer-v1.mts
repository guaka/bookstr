const DEVICE_PLATFORMS = new Set<string>(['electron', 'web', 'ios', 'android']);
const MESSAGE_TYPES = new Set<string>([
  'bookstr.device.announce',
  'bookstr.library.manifest.request',
  'bookstr.library.manifest.page',
  'bookstr.transfer.request',
  'bookstr.transfer.offer',
  'bookstr.transfer.answer',
]);

type JsonRecord = Record<string, unknown>;
type ManifestEntry = { id: string; title: string; authors: string; language: string; format: string; sha256: string; size: number; rights_status: string };
export type TransferMessage =
  | { version: 1; type: 'bookstr.device.announce'; device_id: string; expires_at: number }
  | { version: 1; type: 'bookstr.library.manifest.request'; request_id: string; cursor: string; limit: number }
  | { version: 1; type: 'bookstr.library.manifest.page'; request_id: string; next_cursor: string; entries: ManifestEntry[] }
  | { version: 1; type: 'bookstr.transfer.request'; request_id: string; sha256: string; size: number; private: boolean }
  | { version: 1; type: 'bookstr.transfer.offer'; request_id: string; sha256: string; infohash: string; expires_at: number; ice: string[] }
  | { version: 1; type: 'bookstr.transfer.answer'; request_id: string; infohash: string; ice: string[] };
type RegistryDevice = { device_id: string; pubkey: string; platform: string; name: string; capabilities: string[]; created_at: number; last_seen: number; revoked_at: number };
type DeviceRegistry = { version: 1; devices: RegistryDevice[] };

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, max = 512): string {
  const result = String(value ?? '').trim();
  return result && result.length <= max && !/[\u0000-\u001f]/.test(result) ? result : '';
}

function digest(value: unknown, length: number): string {
  const result = text(value, length).toLowerCase();
  return new RegExp(`^[a-f0-9]{${length}}$`).test(result) ? result : '';
}

function unix(value: unknown): number {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : 0;
}

export function normalizeDeviceRegistry(value: unknown = {}): DeviceRegistry {
  const source = record(value);
  const devices = Array.isArray(source.devices) ? source.devices : [];
  return {
    version: 1,
    devices: devices.map((entry: unknown) => {
      const device = record(entry);
      const platform = typeof device.platform === 'string' && DEVICE_PLATFORMS.has(device.platform) ? device.platform : 'web';
      return {
      device_id: text(device.device_id, 128),
      pubkey: digest(device.pubkey, 64),
      platform,
      name: text(device.name, 80),
      capabilities: Array.isArray(device.capabilities) ? device.capabilities.map((item: unknown) => text(item, 40)).filter(Boolean).slice(0, 24) : [],
      created_at: unix(device.created_at),
      last_seen: unix(device.last_seen),
      revoked_at: unix(device.revoked_at),
      };
    }).filter(device => device.device_id && device.pubkey).slice(0, 64),
  };
}

export function normalizeTransferMessage<T extends TransferMessage['type']>(value: { type: T } & Record<string, unknown>): Extract<TransferMessage, { type: T }> | null;
export function normalizeTransferMessage(value?: unknown): TransferMessage | null;
export function normalizeTransferMessage(value: unknown = {}): TransferMessage | null {
  const source = record(value);
  const type = text(source.type, 80);
  if (!MESSAGE_TYPES.has(type)) return null;
  const message: JsonRecord = { version: 1, type };
  if (type === 'bookstr.device.announce') {
    message.device_id = text(source.device_id, 128);
    message.expires_at = unix(source.expires_at);
  } else if (type === 'bookstr.library.manifest.request') {
    message.request_id = text(source.request_id, 128);
    message.cursor = text(source.cursor, 256);
    message.limit = Math.max(1, Math.min(100, Number(source.limit) || 25));
  } else if (type === 'bookstr.library.manifest.page') {
    message.request_id = text(source.request_id, 128);
    message.next_cursor = text(source.next_cursor, 256);
    message.entries = (Array.isArray(source.entries) ? source.entries : []).map((value: unknown) => {
      const entry = record(value);
      return {
        id: text(entry.id, 256), title: text(entry.title, 400), authors: text(entry.authors, 400),
        language: text(entry.language, 32), format: text(entry.format, 16), sha256: digest(entry.sha256, 64),
        size: Number.isSafeInteger(Number(entry.size)) && Number(entry.size) >= 0 ? Number(entry.size) : 0,
        rights_status: text(entry.rights_status, 32) || 'unknown',
      };
    }).filter(entry => entry.id && entry.sha256).slice(0, 100);
  } else if (type === 'bookstr.transfer.request') {
    message.request_id = text(source.request_id, 128);
    message.sha256 = digest(source.sha256, 64);
    message.size = Number.isSafeInteger(Number(source.size)) && Number(source.size) >= 0 ? Number(source.size) : 0;
    message.private = source.private === true;
  } else if (type === 'bookstr.transfer.offer') {
    message.request_id = text(source.request_id, 128);
    message.sha256 = digest(source.sha256, 64);
    message.infohash = digest(source.infohash, 40);
    message.expires_at = unix(source.expires_at);
    message.ice = Array.isArray(source.ice) ? source.ice.map(candidate => text(candidate, 2000)).filter(Boolean).slice(0, 32) : [];
  } else if (type === 'bookstr.transfer.answer') {
    message.request_id = text(source.request_id, 128);
    message.infohash = digest(source.infohash, 40);
    message.ice = Array.isArray(source.ice) ? source.ice.map(candidate => text(candidate, 2000)).filter(Boolean).slice(0, 32) : [];
  }
  const valid = type === 'bookstr.device.announce'
    ? Boolean(message.device_id && message.expires_at)
    : type === 'bookstr.library.manifest.request'
      ? Boolean(message.request_id)
      : type === 'bookstr.library.manifest.page'
        ? Boolean(message.request_id)
        : type === 'bookstr.transfer.request'
          ? Boolean(message.request_id && message.sha256)
          : type === 'bookstr.transfer.offer'
            ? Boolean(message.request_id && message.sha256 && message.infohash && message.expires_at)
            : Boolean(message.request_id && message.infohash);
  return valid ? message as TransferMessage : null;
}

export function isAuthorizedDevice(registry: unknown, pubkey: unknown): boolean {
  const key = digest(pubkey, 64);
  return Boolean(key && normalizeDeviceRegistry(registry).devices.some(device => device.pubkey === key && !device.revoked_at));
}
