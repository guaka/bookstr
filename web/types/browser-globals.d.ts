interface MigratedNostrSigner {
  getPublicKey(): Promise<string> | string;
  signEvent(event: MigratedNostrEvent): Promise<MigratedNostrEvent>;
  nip44: {
    encrypt(peerPubkey: string, plaintext: string): Promise<string> | string;
    decrypt(peerPubkey: string, ciphertext: string): Promise<string> | string;
  };
}

interface MigratedDesktopBridge {
  catalog?: { get(): Promise<unknown> };
  version?: 1;
  signer?: {
    status(): Promise<unknown>;
    connectNip46(input: unknown): Promise<unknown>;
    startNip46Qr(): Promise<unknown>;
    nip46QrStatus(): Promise<unknown>;
    cancelNip46Qr(): Promise<unknown>;
    setNsec(secret: string): Promise<unknown>;
    disconnect(): Promise<unknown>;
    getPublicKey(): Promise<string>;
    signEvent(event: unknown): Promise<MigratedNostrEvent>;
    nip44: { encrypt(pubkey: string, plaintext: string): Promise<string>; decrypt(pubkey: string, ciphertext: string): Promise<string> };
    nip19: { npubEncode(pubkey: string): Promise<unknown> };
  };
  openReader(payload: unknown): Promise<boolean>;
  speechModels: {
    status(): Promise<unknown>;
    install(id: string): Promise<unknown>;
    remove(id: string): Promise<unknown>;
    onProgress(callback: (payload: unknown) => void): () => void;
  };
  onOpenSettings?(callback: () => void): () => void;
  onOpenPane?(callback: (pane: 'reading' | 'home' | 'search' | 'people' | 'words') => void): () => void;
  onProgress(callback: (payload: unknown) => void): () => void;
  library: {
    search(request: Readonly<Record<string, unknown>>): Promise<unknown>;
    getBook(bookId: string): Promise<BrowserBook | null>;
    metadata(bookId: string): Promise<BrowserBook | null>;
    importBook(options: Readonly<Record<string, unknown>>): Promise<unknown>;
    acquire(record: unknown, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
    acquireLibgen(book: unknown, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
    onAcquisitionProgress(callback: (payload: unknown) => void): () => void;
    downloads(): Promise<BrowserDownloadRow[]>;
    enqueue(request: Readonly<Record<string, unknown>>): Promise<BrowserDownloadRow>;
    removeDownload(bookId: string): Promise<boolean>;
    retryDownload(bookId: string): Promise<unknown>;
    onDownloadsChanged(callback: () => void): () => void;
    linkedFolders(): Promise<unknown>;
    linkFolder(folder?: unknown): Promise<unknown>;
    openReader(bookId: string): Promise<unknown>;
  };
  kindle: {
    devices(): Promise<BrowserKindleDevice[]>;
    presence(id: string): Promise<{ deviceId: string; bookIds: string[] }>;
    preview(id: string, bookId?: string): Promise<unknown>;
    transfer(id: string, bookId?: string | string[]): Promise<BrowserKindleTransferResult>;
    onProgress(callback: (payload: import('../src/desktop-kindle.js').KindleTransferProgress) => void): () => void;
  };
  transfers: {
    setPreferences(preferences?: Readonly<Record<string, unknown>> | null): Promise<unknown>;
    status(): Promise<BrowserTransferStatus[]>;
    seedPublic(bookId: string): Promise<unknown>;
    addPublic(request: Readonly<Record<string, unknown>>): Promise<unknown>;
    downloadPublic(request: Readonly<Record<string, unknown>>): Promise<unknown>;
    addPrivate(request: Readonly<Record<string, unknown>>): Promise<unknown>;
  };
  devices: {
    status(): Promise<unknown>;
    registry(): Promise<unknown>;
    announce(options?: Readonly<Record<string, unknown>>): Promise<unknown>;
    createEnvelope(request: Readonly<Record<string, unknown>>): Promise<unknown>;
    openEnvelope(request: Readonly<Record<string, unknown>>): Promise<unknown>;
    setRegistryEvent(event: Readonly<Record<string, unknown>>): Promise<unknown>;
  };
  onOpenReader?(callback: (payload: unknown) => void): (() => void) | void;
  reportProgress?(payload: unknown): void;
}

interface DictionarySqlRuntime {
  Database: new (data?: Uint8Array) => {
    exec(sql: string): unknown;
    prepare(sql: string): {
      bind(values: unknown[]): void;
      step(): boolean;
      get(): unknown[];
      getAsObject(): Record<string, unknown>;
      free(): void;
    };
    close(): void;
  };
}

declare const BookMetadata: import('../src/book-metadata.js').BookMetadataApi;
declare const BookstrDesktopKindle: import('../src/desktop-kindle.js').DesktopKindleApi;
declare const BookstrDesktopProgress: import('../src/desktop-progress.js').DesktopProgressApi;
declare const BookstrFavoriteReferences: import('../src/favorite-references.js').FavoriteReferencesApi;
declare const BookstrNostrProgress: import('../src/nostr-progress.js').NostrProgressApi;
declare const BookstrSpeechSettings: import('../src/speech-settings.js').SpeechSettingsApi;
declare const BookstrTypography: import('../src/reader-typography.js').ReaderTypographyApi;
declare const BookstrVocabularyWire: {
  parsePayload(value: unknown, fallbackUpdatedAt?: number): Record<string, unknown> | null;
  parseLegacyPayload(value: unknown, fallbackUpdatedAt?: number): Record<string, unknown> | null;
};
declare const CoverAssets: import('../src/cover-assets.js').CoverAssetsApi;
declare const PassageResults: import('../src/passage-results.js').PassageResultsApi;
declare const NostrSocial: import('../src/nostr-social.js').NostrSocialApi;
declare const BookstrNostrConstants: {
  readonly version: number;
  readonly kinds: { readonly progress: number; readonly favorites: number; readonly blossomAuthorization: number };
  readonly dTags: { readonly favorites: string; readonly collectionIndex: string };
  readonly prefixes: { readonly progress: string; readonly favoritesChunk: string; readonly collectionChunk: string; readonly vocabulary: string; readonly snippet: string };
};
declare const initSqlJs: (options: { locateFile(file: string): string }) => Promise<DictionarySqlRuntime>;
declare const JSZip: typeof import('jszip');
declare const ePub: typeof import('epubjs').default;

interface Window {
  nostr?: MigratedNostrSigner;
  bookstrDesktop?: MigratedDesktopBridge;
  parent?: Window;
  applyReaderSettings?: (settings?: Record<string, unknown>) => void;
  loadPdf: (options: { base64: string; bookTitle?: string; filename?: string; theme?: string; book?: Record<string, unknown>; readUrl?: string; initialCfi?: string }) => Promise<void>;
  BookstrSpeech?: import('../src/reader-speech.js').SpeechApi;
  ePub?: typeof import('epubjs').default;
  setReaderTypography?: (font: unknown, alignment: unknown, padding: unknown) => void;
}

declare var nostr: MigratedNostrSigner | undefined;
declare var __bookstrGetDocument: ((data: unknown) => { promise: Promise<import('*vendor/pdfjs/pdf.mjs').PDFDocumentProxy> }) | undefined;
declare var __bookstrCreateObjectURL: ((value: Blob) => string) | undefined;
declare var __bookstrRevokeObjectURL: ((value: string) => void) | undefined;
declare var PdfReaderTest: unknown;
