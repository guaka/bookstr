import { normalizeDeviceRegistry } from './device-transfer-v1.mjs';

export const DEVICE_REGISTRY_KIND_V1 = 30078;
export const DEVICE_REGISTRY_D_TAG_V1 = 'app.bookstr.devices.v1';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function pubkey(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function registryTag(event: JsonRecord): boolean {
  return Array.isArray(event.tags)
    && event.tags.some((tag: unknown) => Array.isArray(tag) && tag[0] === 'd' && tag[1] === DEVICE_REGISTRY_D_TAG_V1);
}

type RegistryTools = { verifyEvent(event: JsonRecord): boolean };
type RegistryOptions = {
  ownerPubkey?: unknown;
  tools?: RegistryTools;
  decrypt?: (owner: string, content: string) => Promise<string> | string;
};

/**
 * Verify the account-owned NIP-78 registry event and decrypt its content.
 * The caller supplies the account signer and Nostr implementation so this
 * contract remains usable by Electron, web, iOS, and Android hosts.
 */
export async function verifyDeviceRegistryEvent(value: unknown, { ownerPubkey, tools, decrypt }: RegistryOptions = {}) {
  const event = record(value);
  const owner = pubkey(ownerPubkey);
  if (!owner || !event || event.kind !== DEVICE_REGISTRY_KIND_V1
    || pubkey(event.pubkey) !== owner || !registryTag(event)
    || typeof event.content !== 'string' || typeof decrypt !== 'function'
    || typeof tools?.verifyEvent !== 'function') return null;
  try {
    if (!tools.verifyEvent(event)) return null;
  } catch {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(await decrypt(owner, event.content));
  } catch {
    return null;
  }
  const decodedRecord = record(decoded);
  if (!decodedRecord || decodedRecord.owner_pubkey && pubkey(decodedRecord.owner_pubkey) !== owner) return null;
  return normalizeDeviceRegistry(decodedRecord);
}
