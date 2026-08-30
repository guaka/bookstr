'use strict';

let contractsPromise;
function contracts() {
  contractsPromise ||= import('../shared/contracts/device-pairing-v1.mjs');
  return contractsPromise;
}

let nip17Promise;
function nip17() {
  nip17Promise ||= import('../shared/contracts/device-pairing-nip17.mjs');
  return nip17Promise;
}

function encodedSecret(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const secret = Buffer.from(value, 'base64');
    return secret.length === 32 ? new Uint8Array(secret) : null;
  } catch {
    return null;
  }
}

function secretValue(value) {
  return Buffer.from(value).toString('base64');
}

function decryptStoredSecret(encoded, safeStorage) {
  if (typeof encoded !== 'string' || !encoded) return null;
  try {
    const plaintext = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    return encodedSecret(plaintext);
  } catch {
    return null;
  }
}

class ElectronDevicePairing {
  constructor({ loadState, saveState, safeStorage, loadTools, accountPublicKey, decryptForAccount, loadRegistry, clock, relays = [] } = {}) {
    if (typeof loadState !== 'function' || typeof saveState !== 'function') throw new TypeError('loadState and saveState are required');
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') throw new TypeError('safeStorage is required');
    if (typeof loadTools !== 'function') throw new TypeError('loadTools is required');
    if (typeof accountPublicKey !== 'function' || typeof decryptForAccount !== 'function') throw new TypeError('account signer callbacks are required');
    this.loadState = loadState;
    this.saveState = saveState;
    this.safeStorage = safeStorage;
    this.loadTools = loadTools;
    this.accountPublicKey = accountPublicKey;
    this.decryptForAccount = decryptForAccount;
    // The registry is deliberately supplied by the main process.  Renderer
    // payloads must never be able to authorize a sender by providing their
    // own view of the account's device registry.
    this.loadRegistry = typeof loadRegistry === 'function' ? loadRegistry : async () => ({ version: 1, devices: [] });
    this.clock = typeof clock === 'function' ? clock : () => Math.floor(Date.now() / 1000);
    this.relays = [...new Set(relays.map(relay => String(relay || '').trim()).filter(relay => /^wss:\/\/[^\s]+$/i.test(relay)))];
    this.device = null;
    this.deviceSecret = null;
  }

  async ensureDevice() {
    if (this.device && this.deviceSecret) return this.device;
    const tools = await this.loadTools();
    const state = await this.loadState();
    const stored = state?.devicePairing;
    const storedSecret = this.safeStorage.isEncryptionAvailable() ? decryptStoredSecret(stored?.secret, this.safeStorage) : null;
    let secret = storedSecret;
    if (!secret) secret = tools.generateSecretKey();
    if (!(secret instanceof Uint8Array) || secret.length !== 32) throw new Error('device key generation failed');
    const pubkey = String(tools.getPublicKey(secret) || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(pubkey)) throw new Error('device key generation returned an invalid public key');
    const deviceId = String(stored?.device_id || `electron-${pubkey.slice(0, 16)}`).trim().slice(0, 128) || `electron-${pubkey.slice(0, 16)}`;
    this.deviceSecret = secret;
    this.device = {
      device_id: deviceId,
      pubkey,
      platform: 'electron',
      name: String(stored?.name || 'Bookstr desktop').trim().slice(0, 80),
      capabilities: ['library', 'webtorrent'],
    };
    if (!storedSecret && this.safeStorage.isEncryptionAvailable()) {
      try {
        const devicePairing = {
          version: 1,
          device_id: deviceId,
          pubkey,
          secret: this.safeStorage.encryptString(secretValue(secret)).toString('base64'),
          name: this.device.name,
        };
        if (stored?.registry && typeof stored.registry === 'object') devicePairing.registry = stored.registry;
        await this.saveState({ devicePairing });
      } catch {
        // Keep the key for this session but never persist it in plaintext.
      }
    }
    return this.device;
  }

  async status() {
    const device = await this.ensureDevice();
    return {
      version: 1,
      deviceId: device.device_id,
      devicePubkey: device.pubkey,
      platform: device.platform,
      name: device.name,
      capabilities: [...device.capabilities],
      accountPubkey: String(await this.accountPublicKey() || '').toLowerCase(),
      persistent: this.safeStorage.isEncryptionAvailable() && Boolean((await this.loadState())?.devicePairing?.secret),
      relays: [...this.relays],
    };
  }

  async announce(options = {}) {
    const { createDeviceAnnouncement } = await contracts();
    return createDeviceAnnouncement(await this.ensureDevice(), { ...options, now: this.clock() });
  }

  async createEnvelope(recipientPubkey, message, options = {}) {
    const { createDeviceControlWrap } = await nip17();
    return createDeviceControlWrap(message, {
      ...options,
      recipientPubkey,
      deviceSecret: this.deviceSecret || (await this.ensureDevice(), this.deviceSecret),
      tools: await this.loadTools(),
      now: this.clock(),
    });
  }

  async openEnvelope(wrapped, { senderPubkey } = {}) {
    const [{ unwrapDeviceControlWrap }, { acceptDeviceMessage }] = await Promise.all([nip17(), contracts()]);
    const registry = await this.loadRegistry();
    const now = this.clock();
    const recipientSigner = {
      getPublicKey: this.accountPublicKey,
      nip44: { decrypt: this.decryptForAccount },
    };
    const message = await unwrapDeviceControlWrap(wrapped, {
      senderPubkey,
      recipientSigner,
      tools: await this.loadTools(),
      now,
    });
    return message ? acceptDeviceMessage(registry, senderPubkey, message, { now }) : null;
  }
}

module.exports = { ElectronDevicePairing };
