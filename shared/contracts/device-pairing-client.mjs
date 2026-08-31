import {
  acceptDeviceMessage,
  createDeviceAnnouncement,
} from './device-pairing-v1.mjs';
import {
  createDeviceControlWrap,
  publishDeviceControlMessage,
  unwrapDeviceControlWrap,
} from './device-pairing-nip17.mjs';

const PLATFORMS = new Set(['web', 'ios', 'android', 'electron']);

function text(value, max) {
  const result = String(value ?? '').trim();
  return result && result.length <= max && !/[\u0000-\u001f]/.test(result) ? result : '';
}

function pubkey(value) {
  const result = String(value ?? '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(result) ? result : '';
}

function secureRelays(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(relay => String(relay ?? '').trim())
    .filter(relay => /^wss:\/\/[^\s]+$/i.test(relay)))];
}

function capabilities(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => text(item, 40))
    .filter(Boolean)
    .slice(0, 24);
}

function validSecret(value) {
  return value instanceof Uint8Array && value.length === 32 ? value : null;
}

async function storageAvailable(storage) {
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
  constructor({
    platform = 'web',
    name = 'Bookstr device',
    capabilities: deviceCapabilities = ['library', 'webtorrent'],
    signer,
    tools,
    secureStorage,
    relays = [],
    publish,
  } = {}) {
    if (!PLATFORMS.has(platform)) throw new TypeError('platform must be web, ios, android, or electron');
    if (!signer || typeof signer.getPublicKey !== 'function') throw new TypeError('a Nostr signer is required');
    if (!tools || typeof tools.getPublicKey !== 'function' || typeof tools.generateSecretKey !== 'function') {
      throw new TypeError('Nostr tools with key generation are required');
    }
    this.platform = platform;
    this.name = text(name, 80) || 'Bookstr device';
    this.deviceCapabilities = capabilities(deviceCapabilities);
    this.signer = signer;
    this.tools = tools;
    this.secureStorage = secureStorage;
    this.relays = secureRelays(relays);
    this.publish = publish;
    this.device = null;
    this.deviceSecret = null;
    this.persistent = false;
    this.ensurePromise = null;
  }

  async ensureDevice() {
    if (this.device && this.deviceSecret) return this.device;
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = this.initializeDevice();
    try {
      return await this.ensurePromise;
    } finally {
      this.ensurePromise = null;
    }
  }

  async initializeDevice() {
    let storedSecret = null;
    const persistentStorage = await storageAvailable(this.secureStorage);
    if (persistentStorage && typeof this.secureStorage.get === 'function') {
      try {
        storedSecret = validSecret(await this.secureStorage.get());
      } catch {
        storedSecret = null;
      }
    }
    let secret = storedSecret;
    if (!secret) secret = validSecret(this.tools.generateSecretKey());
    if (!secret) throw new Error('device key generation failed');
    const devicePubkey = pubkey(this.tools.getPublicKey(secret));
    if (!devicePubkey) throw new Error('device key generation returned an invalid public key');
    if (persistentStorage && !storedSecret && typeof this.secureStorage.set === 'function') {
      try {
        await this.secureStorage.set(secret);
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

  async announce(options = {}) {
    return createDeviceAnnouncement(await this.ensureDevice(), options);
  }

  async createEnvelope(recipientPubkey, message, options = {}) {
    await this.ensureDevice();
    return createDeviceControlWrap(message, {
      ...options,
      recipientPubkey,
      deviceSecret: this.deviceSecret,
      tools: this.tools,
    });
  }

  async openEnvelope(wrapped, { senderPubkey, registry, now } = {}) {
    const recipientSigner = {
      getPublicKey: () => this.signer.getPublicKey(),
      nip44: { decrypt: (peer, ciphertext) => this.signer.nip44?.decrypt(peer, ciphertext) },
    };
    const message = await unwrapDeviceControlWrap(wrapped, {
      senderPubkey,
      recipientSigner,
      tools: this.tools,
      now,
    });
    return message ? acceptDeviceMessage(registry, senderPubkey, message, { now }) : null;
  }

  async publishMessage(message, recipientPubkey, options = {}) {
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

export function createWebPairingClient(options = {}) {
  return new DevicePairingClient({
    ...options,
    platform: 'web',
    signer: options.signer || globalThis.window?.nostr || globalThis.nostr,
  });
}
