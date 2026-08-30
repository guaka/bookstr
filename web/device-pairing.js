import { DevicePairingClient } from './shared/contracts/device-pairing-client.mjs';

export { DevicePairingClient };

/**
 * Build the browser/WebView pairing client using the active NIP-07 signer.
 * Native shells can pass their signer, tools, relay publisher, and secure
 * storage explicitly; no secret is read from localStorage or IndexedDB.
 */
export async function createWebPairing(options = {}) {
  const signer = options.signer || globalThis.window?.nostr || globalThis.nostr;
  const tools = options.tools || await import('./vendor/nostr-tools.js');
  return new DevicePairingClient({ ...options, platform: 'web', signer, tools });
}

