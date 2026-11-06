declare module '*shared/contracts/device-registry-nip78.mjs' {
  export interface DeviceRegistry {
    version: number;
    devices: Record<string, unknown>[];
  }
  export function verifyDeviceRegistryEvent(event: unknown, options: {
    ownerPubkey: string;
    tools: { verifyEvent: typeof import('nostr-tools/pure', { with: { 'resolution-mode': 'import' } }).verifyEvent };
    decrypt(peer: string, ciphertext: string): Promise<string>;
  }): Promise<DeviceRegistry | null>;
}
