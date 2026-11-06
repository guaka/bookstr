type MigratedNostrEvent = {
  id?: string;
  pubkey?: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
};

type MigratedNostrTools = {
  generateSecretKey(): Uint8Array;
  finalizeEvent(event: MigratedNostrEvent, secretKey: Uint8Array): MigratedNostrEvent;
  verifyEvent(event: MigratedNostrEvent): boolean;
  nip19?: { npubEncode?(pubkey: string): string };
  nip44: {
    v2: {
      utils: { getConversationKey(secretKey: Uint8Array, pubkey: string): Uint8Array };
      encrypt(plaintext: string, conversationKey: Uint8Array): string;
    };
  };
};

declare module '*vendor/nostr-tools.js' {
  export const generateSecretKey: MigratedNostrTools['generateSecretKey'];
  export const finalizeEvent: MigratedNostrTools['finalizeEvent'];
  export const verifyEvent: MigratedNostrTools['verifyEvent'];
  export const nip19: NonNullable<MigratedNostrTools['nip19']>;
  export const nip44: MigratedNostrTools['nip44'];
}

declare module '*shared/contracts/device-pairing-client.mjs' {
  export class DevicePairingClient {
    constructor(options?: {
      platform?: 'web' | 'ios' | 'android' | 'electron';
      name?: string;
      capabilities?: unknown;
      signer?: { getPublicKey(): string | Promise<string>; nip44?: { decrypt?(peer: string, ciphertext: string): string | Promise<string> } };
      tools?: unknown;
      secureStorage?: { available?: boolean; isAvailable?: () => boolean | Promise<boolean>; get?: () => Promise<unknown> | unknown; set?: (secret: Uint8Array) => Promise<void> | void };
      relays?: unknown;
      publish?: (relay: string, event: {kind: number}) => Promise<unknown> | unknown;
    });
  }
}

declare module '*vendor/pdfjs/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export type PDFDocumentProxy = {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
    destroy(): Promise<void>;
  };
  export type PDFPageProxy = {
    getTextContent(): Promise<{ items?: { str?: string }[] }>;
    getViewport(options: { scale: number }): { width: number; height: number };
    render(options: {
      canvasContext: CanvasRenderingContext2D | null;
      viewport: { width: number; height: number };
      transform: number[] | null;
    }): { promise: Promise<void> };
  };
  export function getDocument(data: unknown): { promise: Promise<PDFDocumentProxy> };
}
