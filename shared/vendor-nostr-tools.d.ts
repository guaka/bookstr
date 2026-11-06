declare module '*vendor/nostr-tools.js' {
  export type SignedEvent = {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  };

  export function generateSecretKey(): Uint8Array;
  export function getPublicKey(secret: Uint8Array): string;
  export function finalizeEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }, secret: Uint8Array): SignedEvent;
  export function verifyEvent(event: SignedEvent): boolean;
  export const nip44: {
    v2: {
      utils: { getConversationKey(secret: Uint8Array, peer: string): Uint8Array };
      encrypt(plaintext: string, key: Uint8Array): string;
      decrypt(ciphertext: string, key: Uint8Array): Promise<string>;
    };
  };
}
