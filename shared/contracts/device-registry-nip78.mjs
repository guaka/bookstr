import { normalizeDeviceRegistry } from './device-transfer-v1.mjs';

export const DEVICE_REGISTRY_KIND_V1 = 30078;
export const DEVICE_REGISTRY_D_TAG_V1 = 'app.bookstr.devices.v1';

function pubkey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function registryTag(event) {
  return Array.isArray(event?.tags)
    && event.tags.some(tag => Array.isArray(tag) && tag[0] === 'd' && tag[1] === DEVICE_REGISTRY_D_TAG_V1);
}

/**
 * Verify the account-owned NIP-78 registry event and decrypt its content.
 * The caller supplies the account signer and Nostr implementation so this
 * contract remains usable by Electron, web, iOS, and Android hosts.
 */
export async function verifyDeviceRegistryEvent(event, { ownerPubkey, tools, decrypt } = {}) {
  const owner = pubkey(ownerPubkey);
  if (!owner || !event || typeof event !== 'object' || event.kind !== DEVICE_REGISTRY_KIND_V1
    || pubkey(event.pubkey) !== owner || !registryTag(event)
    || typeof event.content !== 'string' || typeof decrypt !== 'function'
    || typeof tools?.verifyEvent !== 'function') return null;
  try {
    if (!tools.verifyEvent(event)) return null;
  } catch {
    return null;
  }
  let decoded;
  try {
    decoded = JSON.parse(await decrypt(owner, event.content));
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object' || decoded.owner_pubkey && pubkey(decoded.owner_pubkey) !== owner) return null;
  return normalizeDeviceRegistry(decoded);
}
