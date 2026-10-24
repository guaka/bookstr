/** Values shared with the renderer are treated as untrusted until validated there. */
export type DesktopPane = 'reading' | 'home' | 'search' | 'people' | 'words';

export interface DesktopProgressInput {
  md5?: unknown;
  bookId?: unknown;
  readUrl?: unknown;
  progression?: unknown;
  furthestProgression?: unknown;
  cfi?: unknown;
  title?: unknown;
  authors?: unknown;
  year?: unknown;
  extension?: unknown;
  source?: unknown;
  sourceNativeId?: unknown;
  sourceUrl?: unknown;
  blossomUrl?: unknown;
  blossomSha256?: unknown;
  rights_status?: unknown;
  rightsStatus?: unknown;
  license?: unknown;
  rights?: unknown;
  license_url?: unknown;
  licenseUrl?: unknown;
  rights_source?: unknown;
  rightsSource?: unknown;
}

export interface DesktopProgress {
  md5: string;
  readUrl: string;
  progression: number;
  cfi: string;
  title: string;
  authors: string;
  year: string;
  extension: string;
  source: string;
  sourceNativeId: string;
  sourceUrl: string;
  blossomUrl: string;
  blossomSha256: string;
  rights_status: string;
  license: string;
  license_url: string;
  rights_source: string;
  furthestProgression: number;
}

export type Unsubscribe = () => void;
export type DesktopCallback<T = unknown> = (payload: T) => void;
export type DesktopOptions = Readonly<Record<string, unknown>>;

export interface DesktopSignerBridge {
  status(): Promise<unknown>;
  connectNip46(input: unknown): Promise<unknown>;
  startNip46Qr(): Promise<unknown>;
  nip46QrStatus(): Promise<unknown>;
  cancelNip46Qr(): Promise<unknown>;
  setNsec(secret: string): Promise<unknown>;
  disconnect(): Promise<unknown>;
  getPublicKey(): Promise<unknown>;
  signEvent(event: unknown): Promise<unknown>;
  nip44: {
    encrypt(pubkey: string, plaintext: string): Promise<unknown>;
    decrypt(pubkey: string, ciphertext: string): Promise<unknown>;
  };
  nip19: { npubEncode(pubkey: string): Promise<unknown> };
}

export interface DesktopBridge {
  catalog: { get(): Promise<unknown> };
  version: 1;
  signer: DesktopSignerBridge;
  openReader(payload: unknown): Promise<boolean>;
  focusLibrary(): Promise<boolean>;
  openPane(pane: DesktopPane): boolean;
  openExternal(url: string): Promise<unknown>;
  platform(): NodeJS.Platform;
  speechModels: {
    status(): Promise<unknown>;
    install(id: string): Promise<unknown>;
    remove(id: string): Promise<unknown>;
    onProgress(callback: DesktopCallback): Unsubscribe;
  };
  onProgress(callback: DesktopCallback): Unsubscribe;
  onOpenReader(callback: DesktopCallback): Unsubscribe;
  onOpenSettings(callback: () => void): Unsubscribe;
  onOpenPane(callback: (pane: DesktopPane) => void): Unsubscribe;
  reportProgress(payload: DesktopProgressInput): void;
  library: {
    search(request: DesktopOptions): Promise<unknown>;
    getBook(bookId: string): Promise<unknown>;
    metadata(bookId: string): Promise<unknown>;
    importBook(options: DesktopOptions): Promise<unknown>;
    acquire(record: unknown, options?: DesktopOptions): Promise<unknown>;
    acquireLibgen(book: unknown, options?: DesktopOptions): Promise<unknown>;
    onAcquisitionProgress(callback: DesktopCallback): Unsubscribe;
    downloads(): Promise<unknown>;
    enqueue(request: DesktopOptions): Promise<unknown>;
    retryDownload(bookId: string): Promise<unknown>;
    onDownloadsChanged(callback: () => void): Unsubscribe;
    linkedFolders(): Promise<unknown>;
    linkFolder(folder?: unknown): Promise<unknown>;
    openReader(bookId: string): Promise<unknown>;
  };
  kindle: {
    devices(): Promise<unknown>;
    presence(id: string): Promise<unknown>;
    preview(id: string, bookId?: string): Promise<unknown>;
    transfer(id: string, bookId?: string): Promise<unknown>;
    onProgress(callback: DesktopCallback): Unsubscribe;
  };
  devices: {
    status(): Promise<unknown>;
    registry(): Promise<unknown>;
    announce(options?: DesktopOptions): Promise<unknown>;
    createEnvelope(request: DesktopOptions): Promise<unknown>;
    openEnvelope(request: DesktopOptions): Promise<unknown>;
    setRegistryEvent(event: DesktopOptions): Promise<unknown>;
  };
  transfers: {
    setPreferences(preferences?: DesktopOptions): Promise<unknown>;
    status(): Promise<unknown>;
    seedPublic(bookId: string): Promise<unknown>;
    addPublic(request: DesktopOptions): Promise<unknown>;
    downloadPublic(request: DesktopOptions): Promise<unknown>;
    addPrivate(request: DesktopOptions): Promise<unknown>;
  };
}

declare global {
  interface Window {
    bookstrDesktop?: DesktopBridge;
  }
}
