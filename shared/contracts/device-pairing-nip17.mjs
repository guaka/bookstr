import { normalizeTransferMessage } from './device-transfer-v1.mjs';

const DEVICE_WRAP_KIND = 1059;
const DEVICE_SEAL_KIND = 13;
const DEVICE_RUMOR_KIND = 14;
const DEFAULT_TTL_SECONDS = 10 * 60;

function hex(value, length) {
  const result = String(value || '').trim().toLowerCase();
  return new RegExp(`^[a-f0-9]{${length}}$`).test(result) ? result : '';
}

function timestamp(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? Math.floor(result) : Math.floor(Date.now() / 1000);
}

async function eventHash(event) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is required for device pairing');
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function expiration(event) {
  const tag = Array.isArray(event?.tags) && event.tags.find(item => Array.isArray(item) && item[0] === 'expiration');
  const value = Number(tag?.[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function randomPast(timestampValue) {
  return Math.max(1, timestampValue - 1 - Math.floor(Math.random() * 60));
}

export async function createDeviceControlWrap(message, { deviceSecret, recipientPubkey, tools, now, ttl = DEFAULT_TTL_SECONDS } = {}) {
  if (!tools?.getPublicKey || !tools?.finalizeEvent || !tools?.generateSecretKey || !tools?.nip44?.v2) throw new TypeError('Nostr tools with NIP-44 v2 are required');
  if (!(deviceSecret instanceof Uint8Array) || deviceSecret.length !== 32) throw new TypeError('deviceSecret must be 32 bytes');
  const recipient = hex(recipientPubkey, 64);
  if (!recipient) throw new TypeError('recipientPubkey must be a 64-character hex key');
  const normalized = normalizeTransferMessage(message);
  if (!normalized) throw new TypeError('message is not a valid device transfer message');
  const createdAt = timestamp(now);
  const devicePubkey = hex(tools.getPublicKey(deviceSecret), 64);
  if (!devicePubkey) throw new TypeError('deviceSecret produced an invalid public key');
  const rumor = {
    pubkey: devicePubkey,
    created_at: createdAt,
    kind: DEVICE_RUMOR_KIND,
    tags: [['p', recipient]],
    content: JSON.stringify(normalized),
  };
  rumor.id = await eventHash(rumor);
  const deviceConversationKey = tools.nip44.v2.utils.getConversationKey(deviceSecret, recipient);
  const seal = tools.finalizeEvent({
    kind: DEVICE_SEAL_KIND,
    created_at: randomPast(createdAt),
    tags: [],
    content: tools.nip44.v2.encrypt(JSON.stringify(rumor), deviceConversationKey),
  }, deviceSecret);
  const ephemeralSecret = tools.generateSecretKey();
  const wrapConversationKey = tools.nip44.v2.utils.getConversationKey(ephemeralSecret, recipient);
  const lifetime = Math.max(60, Math.min(3600, Number(ttl) || DEFAULT_TTL_SECONDS));
  return tools.finalizeEvent({
    kind: DEVICE_WRAP_KIND,
    created_at: randomPast(createdAt),
    tags: [['p', recipient], ['expiration', String(createdAt + lifetime)]],
    content: tools.nip44.v2.encrypt(JSON.stringify(seal), wrapConversationKey),
  }, ephemeralSecret);
}

export async function unwrapDeviceControlWrap(wrapped, { senderPubkey, recipientSigner, tools, now } = {}) {
  if (!wrapped || wrapped.kind !== DEVICE_WRAP_KIND || !tools?.verifyEvent || !recipientSigner?.getPublicKey || !recipientSigner?.nip44?.decrypt) return null;
  if (!tools.verifyEvent(wrapped)) return null;
  const sender = hex(senderPubkey, 64);
  const recipient = hex(await recipientSigner.getPublicKey(), 64);
  if (!sender || !recipient || !Array.isArray(wrapped.tags) || !wrapped.tags.some(tag => Array.isArray(tag) && tag[0] === 'p' && tag[1] === recipient)) return null;
  const expiresAt = expiration(wrapped);
  if (!expiresAt || expiresAt <= timestamp(now)) return null;
  let seal;
  try {
    seal = JSON.parse(await recipientSigner.nip44.decrypt(wrapped.pubkey, wrapped.content));
  } catch {
    return null;
  }
  if (!seal || seal.kind !== DEVICE_SEAL_KIND || !tools.verifyEvent(seal) || seal.pubkey !== sender) return null;
  let rumor;
  try {
    rumor = JSON.parse(await recipientSigner.nip44.decrypt(seal.pubkey, seal.content));
  } catch {
    return null;
  }
  if (!rumor || rumor.kind !== DEVICE_RUMOR_KIND || rumor.pubkey !== sender || !Array.isArray(rumor.tags) || !rumor.tags.some(tag => Array.isArray(tag) && tag[0] === 'p' && tag[1] === recipient)) return null;
  if (rumor.id !== await eventHash(rumor)) return null;
  return normalizeTransferMessage(JSON.parse(rumor.content));
}

export async function publishDeviceControlMessage(message, options = {}) {
  const relays = [...new Set((Array.isArray(options.relays) ? options.relays : []).map(relay => String(relay || '').trim()).filter(relay => /^wss:\/\/[^\s]+$/i.test(relay)))];
  if (!relays.length || typeof options.publish !== 'function') throw new TypeError('secure relay list and publish callback are required');
  const wrap = await createDeviceControlWrap(message, options);
  const accepted = await Promise.all(relays.map(relay => options.publish(relay, wrap)));
  if (!accepted.some(Boolean)) throw new Error('no relay accepted the device message');
  return { wrap, relays };
}

export const DEVICE_WRAP_KIND_V1 = DEVICE_WRAP_KIND;

