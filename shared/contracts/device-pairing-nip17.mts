import { normalizeTransferMessage } from './device-transfer-v1.mjs';

const DEVICE_WRAP_KIND = 1059;
const DEVICE_SEAL_KIND = 13;
const DEVICE_RUMOR_KIND = 14;
const DEFAULT_TTL_SECONDS = 10 * 60;

type NostrEvent = { id?: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string };
type NostrTools = {
  getPublicKey(secret: Uint8Array): string;
  finalizeEvent(event: Omit<NostrEvent, 'id' | 'pubkey'> & { pubkey?: string }, secret: Uint8Array): NostrEvent;
  generateSecretKey(): Uint8Array;
  verifyEvent(event: NostrEvent): boolean;
  nip44: {
    v2: {
      utils: { getConversationKey(secret: Uint8Array, pubkey: string): Uint8Array };
      encrypt(plaintext: string, key: Uint8Array): string;
    };
  };
};
type Signer = { getPublicKey(): string | Promise<string>; nip44: { decrypt(pubkey: string, ciphertext: string): Promise<string> } };
type PairingOptions = { deviceSecret?: unknown; recipientPubkey?: unknown; tools?: NostrTools; now?: unknown; ttl?: number };

function hex(value: unknown, length: number): string {
  const result = String(value || '').trim().toLowerCase();
  return new RegExp(`^[a-f0-9]{${length}}$`).test(result) ? result : '';
}

function timestamp(value: unknown): number {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? Math.floor(result) : Math.floor(Date.now() / 1000);
}

async function eventHash(event: NostrEvent): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is required for device pairing');
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function expiration(event: NostrEvent): number {
  const tag = event.tags.find(item => item[0] === 'expiration');
  const value = Number(tag?.[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function randomPast(timestampValue: number): number {
  return Math.max(1, timestampValue - 1 - Math.floor(Math.random() * 60));
}

export async function createDeviceControlWrap(message: unknown, { deviceSecret, recipientPubkey, tools, now, ttl = DEFAULT_TTL_SECONDS }: PairingOptions = {}): Promise<NostrEvent> {
  if (!tools?.getPublicKey || !tools?.finalizeEvent || !tools?.generateSecretKey || !tools?.nip44?.v2) throw new TypeError('Nostr tools with NIP-44 v2 are required');
  if (!(deviceSecret instanceof Uint8Array) || deviceSecret.length !== 32) throw new TypeError('deviceSecret must be 32 bytes');
  const recipient = hex(recipientPubkey, 64);
  if (!recipient) throw new TypeError('recipientPubkey must be a 64-character hex key');
  const normalized = normalizeTransferMessage(message);
  if (!normalized) throw new TypeError('message is not a valid device transfer message');
  const createdAt = timestamp(now);
  const devicePubkey = hex(tools.getPublicKey(deviceSecret), 64);
  if (!devicePubkey) throw new TypeError('deviceSecret produced an invalid public key');
  const rumor: NostrEvent = {
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

type UnwrapOptions = { senderPubkey?: unknown; recipientSigner?: Signer; tools?: Pick<NostrTools, 'verifyEvent'>; now?: unknown };

export async function unwrapDeviceControlWrap(wrapped: unknown, { senderPubkey, recipientSigner, tools, now }: UnwrapOptions = {}) {
  const wrappedRecord = wrapped && typeof wrapped === 'object' ? wrapped as NostrEvent : null;
  if (!wrappedRecord || wrappedRecord.kind !== DEVICE_WRAP_KIND || !tools?.verifyEvent || !recipientSigner?.getPublicKey || !recipientSigner?.nip44?.decrypt) return null;
  if (!tools.verifyEvent(wrappedRecord)) return null;
  const sender = hex(senderPubkey, 64);
  const recipient = hex(await recipientSigner.getPublicKey(), 64);
  if (!sender || !recipient || !Array.isArray(wrappedRecord.tags) || !wrappedRecord.tags.some(tag => Array.isArray(tag) && tag[0] === 'p' && tag[1] === recipient)) return null;
  const expiresAt = expiration(wrappedRecord);
  if (!expiresAt || expiresAt <= timestamp(now)) return null;
  let seal;
  try {
    seal = JSON.parse(await recipientSigner.nip44.decrypt(wrappedRecord.pubkey, wrappedRecord.content));
  } catch {
    return null;
  }
  if (!seal || typeof seal !== 'object' || (seal as NostrEvent).kind !== DEVICE_SEAL_KIND || !tools.verifyEvent(seal as NostrEvent) || (seal as NostrEvent).pubkey !== sender) return null;
  let rumor;
  try {
    rumor = JSON.parse(await recipientSigner.nip44.decrypt((seal as NostrEvent).pubkey, (seal as NostrEvent).content));
  } catch {
    return null;
  }
  if (!rumor || typeof rumor !== 'object') return null;
  const rumorEvent = rumor as NostrEvent;
  if (rumorEvent.kind !== DEVICE_RUMOR_KIND || rumorEvent.pubkey !== sender || !Array.isArray(rumorEvent.tags) || !rumorEvent.tags.some(tag => Array.isArray(tag) && tag[0] === 'p' && tag[1] === recipient)) return null;
  if (rumorEvent.id !== await eventHash(rumorEvent)) return null;
  return normalizeTransferMessage(JSON.parse(rumorEvent.content));
}

export async function publishDeviceControlMessage(message: unknown, options: PairingOptions & { relays?: unknown; publish?: (relay: string, event: NostrEvent) => Promise<unknown> | unknown } = {}) {
  const relays = [...new Set((Array.isArray(options.relays) ? options.relays : []).map(relay => String(relay || '').trim()).filter(relay => /^wss:\/\/[^\s]+$/i.test(relay)))];
  const publish = options.publish;
  if (!relays.length || typeof publish !== 'function') throw new TypeError('secure relay list and publish callback are required');
  const wrap = await createDeviceControlWrap(message, options);
  const accepted = await Promise.all(relays.map(relay => publish(relay, wrap)));
  if (!accepted.some(Boolean)) throw new Error('no relay accepted the device message');
  return { wrap, relays };
}

export const DEVICE_WRAP_KIND_V1 = DEVICE_WRAP_KIND;
