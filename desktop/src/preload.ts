import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopBridge,
  DesktopPane,
  DesktopProgress,
  DesktopProgressInput,
} from './desktop-bridge';

type PayloadCallback = (payload: unknown) => void;

const readerOpenCallbacks = new Set<PayloadCallback>();
const progressCallbacks = new Set<PayloadCallback>();
const acquisitionProgressCallbacks = new Set<PayloadCallback>();
const downloadChangedCallbacks = new Set<() => void>();
const kindleProgressCallbacks = new Set<PayloadCallback>();
const settingsOpenCallbacks = new Set<() => void>();
const paneOpenCallbacks = new Set<(pane: DesktopPane) => void>();
const speechModelProgressCallbacks = new Set<PayloadCallback>();
const ALLOWED_PANES = new Set<string>(['reading', 'home', 'search', 'people', 'words']);
const PANE_SHORTCUTS = new Map<string, DesktopPane>([
  ['1', 'home'],
  ['2', 'reading'],
  ['3', 'search'],
  ['4', 'people'],
  ['5', 'words'],
]);

interface UnknownRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object';
}

function isDesktopPane(value: unknown): value is DesktopPane {
  return typeof value === 'string' && ALLOWED_PANES.has(value);
}

window.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.altKey || event.shiftKey || (!event.metaKey && !event.ctrlKey)) return;
  if (event.key === ',') {
    event.preventDefault();
    void ipcRenderer.invoke('bookstr-desktop-open-settings');
    return;
  }
  const pane = PANE_SHORTCUTS.get(event.key);
  if (!pane) return;
  event.preventDefault();
  ipcRenderer.send('bookstr-desktop-pane-shortcut', pane);
});

function normalizeProgressPayload(payload: unknown): DesktopProgress | null {
  if (!isRecord(payload)) return null;
  const progression = Number(payload.progression);
  const furthest = Number(payload.furthestProgression);
  return {
    md5: String(payload.md5 || payload.bookId || '').toLowerCase(),
    readUrl: String(payload.readUrl || ''),
    progression: Number.isFinite(progression) ? Math.max(0, Math.min(1, progression)) : 0,
    cfi: String(payload.cfi || ''),
    title: String(payload.title || ''),
    authors: String(payload.authors || ''),
    year: String(payload.year || ''),
    extension: String(payload.extension || 'epub').toLowerCase(),
    source: String(payload.source || ''),
    sourceNativeId: String(payload.sourceNativeId || ''),
    sourceUrl: String(payload.sourceUrl || ''),
    blossomUrl: String(payload.blossomUrl || ''),
    blossomSha256: String(payload.blossomSha256 || ''),
    rights_status: String(payload.rights_status || payload.rightsStatus || 'unknown'),
    license: String(payload.license || payload.rights || ''),
    license_url: String(payload.license_url || payload.licenseUrl || ''),
    rights_source: String(payload.rights_source || payload.rightsSource || ''),
    furthestProgression: Number.isFinite(furthest) ? Math.max(0, Math.min(1, furthest)) : 0,
  };
}

ipcRenderer.on('bookstr-desktop-open-reader', (_event, payload: unknown) => {
  for (const callback of readerOpenCallbacks) {
    try {
      callback(payload);
    } catch {
      // ignored: each reader window handles its own payload validation
    }
  }
});

ipcRenderer.on('bookstr-desktop-reader-progress', (_event, payload: unknown) => {
  for (const callback of progressCallbacks) {
    try {
      callback(payload);
    } catch {
      // ignore
    }
  }
});

ipcRenderer.on('bookstr-desktop-acquisition-progress', (_event, payload: unknown) => {
  for (const callback of acquisitionProgressCallbacks) {
    try {
      callback(payload);
    } catch {
      // ignore
    }
  }
});

ipcRenderer.on('bookstr-desktop-downloads-changed', () => {
  for (const callback of downloadChangedCallbacks) {
    try { callback(); } catch { /* a closed view must not stop the queue */ }
  }
});

ipcRenderer.on('bookstr-desktop-kindle-progress', (_event, progressPayload: unknown) => {
  for (const callback of kindleProgressCallbacks) {
    try { callback(progressPayload); } catch { /* detached view */ }
  }
});

ipcRenderer.on('bookstr-desktop-open-settings', () => {
  for (const callback of settingsOpenCallbacks) {
    try {
      callback();
    } catch {
      // ignore
    }
  }
});

ipcRenderer.on('bookstr-desktop-open-pane', (_event, pane: unknown) => {
  if (!isDesktopPane(pane)) return;
  for (const callback of paneOpenCallbacks) {
    try {
      callback(pane);
    } catch {
      // ignore
    }
  }
});

ipcRenderer.on('bookstr-desktop-speech-model-progress', (_event, progressPayload: unknown) => {
  for (const callback of speechModelProgressCallbacks) {
    try {
      callback(progressPayload);
    } catch {
      // ignore
    }
  }
});

const desktopSigner: DesktopBridge['signer'] = {
  status() {
    return ipcRenderer.invoke('bookstr-desktop-signer-status');
  },
  connectNip46(input) {
    return ipcRenderer.invoke('bookstr-desktop-signer-connect-nip46', input);
  },
  startNip46Qr() {
    return ipcRenderer.invoke('bookstr-desktop-signer-start-nip46-qr');
  },
  nip46QrStatus() {
    return ipcRenderer.invoke('bookstr-desktop-signer-nip46-qr-status');
  },
  cancelNip46Qr() {
    return ipcRenderer.invoke('bookstr-desktop-signer-cancel-nip46-qr');
  },
  setNsec(secret) {
    return ipcRenderer.invoke('bookstr-desktop-signer-set-nsec', secret);
  },
  disconnect() {
    return ipcRenderer.invoke('bookstr-desktop-signer-disconnect');
  },
  getPublicKey() {
    return ipcRenderer.invoke('bookstr-desktop-nostr-get-public-key');
  },
  signEvent(event) {
    return ipcRenderer.invoke('bookstr-desktop-nostr-sign-event', event);
  },
  nip44: {
    encrypt(pubkey, plaintext) {
      return ipcRenderer.invoke('bookstr-desktop-nostr-nip44-encrypt', { pubkey, plaintext });
    },
    decrypt(pubkey, ciphertext) {
      return ipcRenderer.invoke('bookstr-desktop-nostr-nip44-decrypt', { pubkey, ciphertext });
    },
  },
  nip19: {
    npubEncode(pubkey) {
      return ipcRenderer.invoke('bookstr-desktop-nostr-nip19-npub', pubkey);
    },
  },
};

const desktopBridge: DesktopBridge = {
  catalog: { get: () => ipcRenderer.invoke('bookstr-desktop-catalog-current') },
  version: 1,
  signer: desktopSigner,
  openReader(payload) {
    return ipcRenderer
      .invoke('bookstr-desktop-open-reader', payload)
      .then(result => Boolean(isRecord(result) && result.ok))
      .catch(() => false);
  },
  focusLibrary() {
    return ipcRenderer
      .invoke('bookstr-desktop-focus-library')
      .catch(() => false);
  },
  openPane(pane) {
    if (!ALLOWED_PANES.has(pane)) return false;
    ipcRenderer.send('bookstr-desktop-pane-shortcut', pane);
    return true;
  },
  openExternal(url) {
    return ipcRenderer.invoke('bookstr-desktop-open-external', url);
  },
  platform() {
    return process.platform;
  },
  speechModels: {
    status() {
      return ipcRenderer.invoke('bookstr-desktop-speech-model-status');
    },
    install(id) {
      return ipcRenderer.invoke('bookstr-desktop-speech-model-install', id);
    },
    remove(id) {
      return ipcRenderer.invoke('bookstr-desktop-speech-model-remove', id);
    },
    onProgress(callback) {
      if (typeof callback !== 'function') return () => {};
      speechModelProgressCallbacks.add(callback);
      return () => speechModelProgressCallbacks.delete(callback);
    },
  },
  onProgress(callback) {
    if (typeof callback !== 'function') return () => {};
    progressCallbacks.add(callback);
    return () => progressCallbacks.delete(callback);
  },
  onOpenReader(callback) {
    if (typeof callback !== 'function') return () => {};
    readerOpenCallbacks.add(callback);
    return () => readerOpenCallbacks.delete(callback);
  },
  onOpenSettings(callback) {
    if (typeof callback !== 'function') return () => {};
    settingsOpenCallbacks.add(callback);
    return () => settingsOpenCallbacks.delete(callback);
  },
  onOpenPane(callback) {
    if (typeof callback !== 'function') return () => {};
    paneOpenCallbacks.add(callback);
    return () => paneOpenCallbacks.delete(callback);
  },
  reportProgress(payload: DesktopProgressInput) {
    const normalized = normalizeProgressPayload(payload);
    if (normalized?.md5) {
      ipcRenderer.send('bookstr-desktop-report-progress', normalized);
    }
  },
  library: {
    search(request) {
      return ipcRenderer.invoke('bookstr-desktop-library-search', request);
    },
    getBook(bookId) {
      return ipcRenderer.invoke('bookstr-desktop-library-book', bookId);
    },
    metadata(bookId) {
      return ipcRenderer.invoke('bookstr-desktop-library-metadata', bookId);
    },
    importBook(options) {
      return ipcRenderer.invoke('bookstr-desktop-library-import', options);
    },
    acquire(record, options = {}) {
      return ipcRenderer.invoke('bookstr-desktop-library-acquire', { record, ...options });
    },
    acquireLibgen(book, options = {}) {
      return ipcRenderer.invoke('bookstr-desktop-library-acquire-libgen', { book, ...options });
    },
    onAcquisitionProgress(callback) {
      if (typeof callback !== 'function') return () => {};
      acquisitionProgressCallbacks.add(callback);
      return () => acquisitionProgressCallbacks.delete(callback);
    },
    downloads() {
      return ipcRenderer.invoke('bookstr-desktop-library-downloads');
    },
    enqueue(request) {
      return ipcRenderer.invoke('bookstr-desktop-library-enqueue', request);
    },
    retryDownload(bookId) {
      return ipcRenderer.invoke('bookstr-desktop-library-retry-download', bookId);
    },
    onDownloadsChanged(callback) {
      if (typeof callback !== 'function') return () => {};
      downloadChangedCallbacks.add(callback);
      return () => downloadChangedCallbacks.delete(callback);
    },
    linkedFolders() {
      return ipcRenderer.invoke('bookstr-desktop-library-linked-folders');
    },
    linkFolder(folder) {
      return ipcRenderer.invoke('bookstr-desktop-library-link-folder', folder);
    },
    openReader(bookId) {
      return ipcRenderer.invoke('bookstr-desktop-library-open-reader', bookId);
    },
  },
  kindle: {
    devices() { return ipcRenderer.invoke('bookstr-desktop-kindle-devices'); },
    preview(id, bookId) { return ipcRenderer.invoke('bookstr-desktop-kindle-preview', id, bookId); },
    transfer(id, bookId) { return ipcRenderer.invoke('bookstr-desktop-kindle-transfer', id, bookId); },
    onProgress(callback) {
      if (typeof callback !== 'function') return () => {};
      kindleProgressCallbacks.add(callback);
      return () => kindleProgressCallbacks.delete(callback);
    },
  },
  devices: {
    status() {
      return ipcRenderer.invoke('bookstr-desktop-device-status');
    },
    registry() {
      return ipcRenderer.invoke('bookstr-desktop-device-registry');
    },
    announce(options = {}) {
      return ipcRenderer.invoke('bookstr-desktop-device-announce', options);
    },
    createEnvelope(request) {
      return ipcRenderer.invoke('bookstr-desktop-device-create-envelope', request);
    },
    openEnvelope(request) {
      return ipcRenderer.invoke('bookstr-desktop-device-open-envelope', request);
    },
    setRegistryEvent(event) {
      return ipcRenderer.invoke('bookstr-desktop-device-set-registry-event', event);
    },
  },
  transfers: {
    setPreferences(preferences = {}) {
      return ipcRenderer.invoke('bookstr-desktop-transfer-preferences', preferences);
    },
    status() {
      return ipcRenderer.invoke('bookstr-desktop-transfer-status');
    },
    seedPublic(bookId) {
      return ipcRenderer.invoke('bookstr-desktop-transfer-seed-public', { bookId });
    },
    addPublic(request) {
      return ipcRenderer.invoke('bookstr-desktop-transfer-add-public', request);
    },
    downloadPublic(request) {
      return ipcRenderer.invoke('bookstr-desktop-transfer-download-public', request);
    },
    addPrivate(request) {
      return ipcRenderer.invoke('bookstr-desktop-transfer-add-private', request);
    },
  },
};

contextBridge.exposeInMainWorld('bookstrDesktop', desktopBridge);
