declare module '*shared/contracts/device-pairing-v1.mjs' {
  export function createDeviceAnnouncement(device: unknown, options?: { now?: number; ttl?: number }): unknown;
  export function acceptDeviceMessage(registry: unknown, senderPubkey: string | undefined, message: unknown, options?: { now?: number }): unknown;
}

declare module '*shared/contracts/device-pairing-nip17.mjs' {
  export function createDeviceControlWrap(message: unknown, options: {
    deviceSecret: Uint8Array;
    recipientPubkey: string;
    tools: Record<string, unknown>;
    now?: number;
    [key: string]: unknown;
  }): Promise<unknown>;
  export function unwrapDeviceControlWrap(wrapped: unknown, options: {
    senderPubkey?: string;
    recipientSigner: { getPublicKey: () => Promise<string> | string; nip44: { decrypt: (pubkey: string, ciphertext: string) => Promise<string> } };
    tools: Record<string, unknown>;
    now?: number;
  }): Promise<unknown>;
}

declare module '*shared/catalog/acquisition.mjs' {
  export interface AcquisitionCandidate {
    url?: string;
    sha256?: string;
    availability?: string;
    private?: boolean;
    torrent?: string;
    source_id?: string;
    size?: number;
    extension?: string;
    format?: string;
    [key: string]: unknown;
  }
  export interface NormalizedProviderRecord {
    provider: string;
    recordId: string;
    providerDescriptor?: { homepage?: string };
    [key: string]: unknown;
  }
  export function normalizeProviderRecord(value?: unknown): NormalizedProviderRecord;
  export function listAcquisitions(record: unknown, options?: { format?: string; preferTorrent?: boolean; includeRestricted?: boolean }): AcquisitionCandidate[];
  export function selectAcquisition(record: unknown, options?: { format?: string; preferTorrent?: boolean; includeRestricted?: boolean }): AcquisitionCandidate | null;
  export function providerBookFields(record: unknown): Record<string, unknown> & { id: string };
}
