import {
  acceptDeviceMessage,
  createDeviceAnnouncement,
} from './device-pairing-v1.mjs';
import {
  createDeviceControlWrap,
  publishDeviceControlMessage,
  unwrapDeviceControlWrap,
} from './device-pairing-nip17.mjs';

const PLATFORMS = new Set<string>(['web', 'ios', 'android', 'electron']);
type PairingPlatform = 'web' | 'ios' | 'android' | 'electron';
type Device = { version: 1; device_id: string; pubkey: string; platform: PairingPlatform; name: string; capabilities: string[] };
type DeviceSigner = {
  getPublicKey(): string | Promise<string>;
  nip44?: { decrypt?(peer: string, ciphertext: string): string | Promise<string> };
};
type PairingTools = {
  getPublicKey(secret: Uint8Array): string;
  generateSecretKey(): Uint8Array;
  finalizeEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }, secret: Uint8Array): { id?: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string };
  verifyEvent(event: { id?: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }): boolean;
  nip44: { v2: { utils: { getConversationKey(secret: Uint8Array, peer: string): Uint8Array }; encrypt(plaintext: string, key: Uint8Array): string } };
};
type SecureStorage = {
  available?: boolean;
  isAvailable?: () => boolean | Promise<boolean>;
  get?: () => Promise<unknown> | unknown;
  set?: (secret: Uint8Array) => Promise<void> | void;
};
type ClientOptions = {
  platform?: PairingPlatform; name?: string; capabilities?: unknown; signer?: DeviceSigner; tools?: unknown;
  secureStorage?: SecureStorage; relays?: unknown; publish?: (relay: string, event: { kind: number }) => Promise<unknown> | unknown;
};

function text(value: unknown, max: number): string {
  const result = String(value ?? '').trim();
  return result && result.length <= max && !/[\u0000-\u001f]/.test(result) ? result : '';
}

function pubkey(value: unknown): string {
  const result = String(value ?? '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(result) ? result : '';
}

function secureRelays(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((relay: unknown) => String(relay ?? '').trim())
    .filter(relay => /^wss:\/\/[^\s]+$/i.test(relay)))];
}

function capabilities(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item: unknown) => text(item, 40))
    .filter(Boolean)
    .slice(0, 24);
}

function validSecret(value: unknown): Uint8Array | null {
  return value instanceof Uint8Array && value.length === 32 ? value : null;
}

async function storageAvailable(storage: SecureStorage | undefined): Promise<boolean> {
  if (!storage) return false;
  try {
    return typeof storage.isAvailable === 'function' ? Boolean(await storage.isAvailable()) : storage.available === true;
  } catch {
    return false;
  }
}

/**
 * Platform-neutral device pairing adapter.
 *
 * `secureStorage` is deliberately an injected capability. Its get/set methods
 * must operate on 32-byte Uint8Arrays; callers should back it with Keychain,
 * Android Keystore, an Electron safeStorage wrapper, or another OS-protected
 * store. If it is absent or unavailable, the adapter creates a session-only
 * identity and never writes the secret to ordinary browser storage.
 */
export class DevicePairingClient {
  readonly platform: PairingPlatform;
  readonly name: string;
  readonly deviceCapabilities: string[];
  readonly signer: DeviceSigner;
  readonly tools: PairingTools;
  readonly secureStorage: SecureStorage | undefined;
  readonly relays: string[];
  readonly publish: ClientOptions['publish'];
  device: Device | null;
  deviceSecret: Uint8Array | null;
  persistent: boolean;
  ensurePromise: Promise<Device> | null;

  constructor({
    platform = 'web',
    name = 'Bookstr device',
    capabilities: deviceCapabilities = ['library', 'webtorrent'],
    signer,
    tools,
    secureStorage,
    relays = [],
    publish,
  }: ClientOptions = {}) {
    const candidateTools = tools as Partial<PairingTools> | undefined;
    if (!PLATFORMS.has(platform)) throw new TypeError('platform must be web, ios, android, or electron');
    if (!signer || typeof signer.getPublicKey !== 'function') throw new TypeError('a Nostr signer is required');
    if (!candidateTools || typeof candidateTools.getPublicKey !== 'function' || typeof candidateTools.generateSecretKey !== 'function') {
      throw new TypeError('Nostr tools with key generation are required');
    }
    this.platform = platform;
    this.name = text(name, 80) || 'Bookstr device';
    this.deviceCapabilities = capabilities(deviceCapabilities);
    this.signer = signer;
    this.tools = candidateTools as PairingTools;
    this.secureStorage = secureStorage;
    this.relays = secureRelays(relays);
    this.publish = publish;
    this.device = null;
    this.deviceSecret = null;
    this.persistent = false;
    this.ensurePromise = null;
  }

  async ensureDevice(): Promise<Device> {
    if (this.device && this.deviceSecret) return this.device;
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = this.initializeDevice();
    try {
      return await this.ensurePromise;
    } finally {
      this.ensurePromise = null;
    }
  }

  async initializeDevice(): Promise<Device> {
    let storedSecret = null;
    const persistentStorage = await storageAvailable(this.secureStorage);
    const storage = this.secureStorage;
    if (persistentStorage && typeof storage?.get === 'function') {
      try {
        storedSecret = validSecret(await storage.get());
      } catch {
        storedSecret = null;
      }
    }
    let secret = storedSecret;
    if (!secret) secret = validSecret(this.tools.generateSecretKey());
    if (!secret) throw new Error('device key generation failed');
    const devicePubkey = pubkey(this.tools.getPublicKey(secret));
    if (!devicePubkey) throw new Error('device key generation returned an invalid public key');
    if (persistentStorage && !storedSecret && typeof storage?.set === 'function') {
      try {
        await storage.set(secret);
        this.persistent = true;
      } catch {
        this.persistent = false;
      }
    } else this.persistent = persistentStorage && Boolean(storedSecret);
    this.deviceSecret = secret;
    this.device = {
      version: 1,
      device_id: `bookstr-${this.platform}-${devicePubkey.slice(0, 16)}`,
      pubkey: devicePubkey,
      platform: this.platform,
      name: this.name,
      capabilities: [...this.deviceCapabilities],
    };
    return this.device;
  }

  async status() {
    const device = await this.ensureDevice();
    const accountPubkey = pubkey(await this.signer.getPublicKey());
    if (!accountPubkey) throw new Error('the Nostr signer returned an invalid public key');
    return {
      version: 1,
      deviceId: device.device_id,
      devicePubkey: device.pubkey,
      platform: device.platform,
      name: device.name,
      capabilities: [...device.capabilities],
      accountPubkey,
      persistent: this.persistent,
      relays: [...this.relays],
    };
  }

  async announce(options: { now?: unknown; ttl?: number } = {}) {
    return createDeviceAnnouncement(await this.ensureDevice(), options);
  }

  async createEnvelope(recipientPubkey: unknown, message: unknown, options: { now?: unknown; ttl?: number } = {}) {
    await this.ensureDevice();
    return createDeviceControlWrap(message, {
      ...options,
      recipientPubkey,
      deviceSecret: this.deviceSecret,
      tools: this.tools,
    });
  }

  async openEnvelope(wrapped: unknown, { senderPubkey, registry, now }: { senderPubkey?: unknown; registry?: unknown; now?: unknown } = {}) {
    const recipientSigner = {
      getPublicKey: () => this.signer.getPublicKey(),
      nip44: { decrypt: async (peer: string, ciphertext: string) => {
        const decrypt = this.signer.nip44?.decrypt;
        if (!decrypt) throw new TypeError('signer does not support NIP-44 decryption');
        return decrypt(peer, ciphertext);
      } },
    };
    const message = await unwrapDeviceControlWrap(wrapped, {
      senderPubkey,
      recipientSigner,
      tools: this.tools,
      now,
    });
    return message ? acceptDeviceMessage(registry, senderPubkey, message, { now }) : null;
  }

  async publishMessage(message: unknown, recipientPubkey: unknown, options: { relays?: unknown; publish?: ClientOptions['publish']; now?: unknown; ttl?: number } = {}) {
    await this.ensureDevice();
    const relays = secureRelays(options.relays || this.relays);
    const publish = options.publish || this.publish;
    return publishDeviceControlMessage(message, {
      ...options,
      relays,
      publish,
      recipientPubkey,
      deviceSecret: this.deviceSecret,
      tools: this.tools,
    });
  }
}

export function createWebPairingClient(options: Omit<ClientOptions, 'platform'> = {}) {
  const browserGlobal = globalThis as typeof globalThis & { nostr?: DeviceSigner; window?: Window & { nostr?: DeviceSigner } };
  return new DevicePairingClient({
    ...options,
    platform: 'web',
    signer: options.signer || browserGlobal.window?.nostr || browserGlobal.nostr,
  });
}
