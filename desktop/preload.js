"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const readerOpenCallbacks = new Set();
const progressCallbacks = new Set();
const acquisitionProgressCallbacks = new Set();
const downloadChangedCallbacks = new Set();
const kindleProgressCallbacks = new Set();
const settingsOpenCallbacks = new Set();
const paneOpenCallbacks = new Set();
const speechModelProgressCallbacks = new Set();
const ALLOWED_PANES = new Set(['reading', 'home', 'search', 'people', 'words']);
const PANE_SHORTCUTS = new Map([
    ['1', 'home'],
    ['2', 'reading'],
    ['3', 'search'],
    ['4', 'people'],
    ['5', 'words'],
]);
function isRecord(value) {
    return value !== null && typeof value === 'object';
}
function isDesktopPane(value) {
    return typeof value === 'string' && ALLOWED_PANES.has(value);
}
window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.shiftKey || (!event.metaKey && !event.ctrlKey))
        return;
    if (event.key === ',') {
        event.preventDefault();
        void electron_1.ipcRenderer.invoke('bookstr-desktop-open-settings');
        return;
    }
    const pane = PANE_SHORTCUTS.get(event.key);
    if (!pane)
        return;
    event.preventDefault();
    electron_1.ipcRenderer.send('bookstr-desktop-pane-shortcut', pane);
});
function normalizeProgressPayload(payload) {
    if (!isRecord(payload))
        return null;
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
electron_1.ipcRenderer.on('bookstr-desktop-open-reader', (_event, payload) => {
    for (const callback of readerOpenCallbacks) {
        try {
            callback(payload);
        }
        catch {
            // ignored: each reader window handles its own payload validation
        }
    }
});
electron_1.ipcRenderer.on('bookstr-desktop-reader-progress', (_event, payload) => {
    for (const callback of progressCallbacks) {
        try {
            callback(payload);
        }
        catch {
            // ignore
        }
    }
});
electron_1.ipcRenderer.on('bookstr-desktop-acquisition-progress', (_event, payload) => {
    for (const callback of acquisitionProgressCallbacks) {
        try {
            callback(payload);
        }
        catch {
            // ignore
        }
    }
});
electron_1.ipcRenderer.on('bookstr-desktop-downloads-changed', () => {
    for (const callback of downloadChangedCallbacks) {
        try {
            callback();
        }
        catch { /* a closed view must not stop the queue */ }
    }
});
electron_1.ipcRenderer.on('bookstr-desktop-kindle-progress', (_event, progressPayload) => {
    for (const callback of kindleProgressCallbacks) {
        try {
            callback(progressPayload);
        }
        catch { /* detached view */ }
    }
});
electron_1.ipcRenderer.on('bookstr-desktop-open-settings', () => {
    for (const callback of settingsOpenCallbacks) {
        try {
            callback();
        }
        catch {
            // ignore
        }
    }
});
electron_1.ipcRenderer.on('bookstr-desktop-open-pane', (_event, pane) => {
    if (!isDesktopPane(pane))
        return;
    for (const callback of paneOpenCallbacks) {
        try {
            callback(pane);
        }
        catch {
            // ignore
        }
    }
});
electron_1.ipcRenderer.on('bookstr-desktop-speech-model-progress', (_event, progressPayload) => {
    for (const callback of speechModelProgressCallbacks) {
        try {
            callback(progressPayload);
        }
        catch {
            // ignore
        }
    }
});
const desktopSigner = {
    status() {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-signer-status');
    },
    connectNip46(input) {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-signer-connect-nip46', input);
    },
    startNip46Qr() {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-signer-start-nip46-qr');
    },
    nip46QrStatus() {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-signer-nip46-qr-status');
    },
    cancelNip46Qr() {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-signer-cancel-nip46-qr');
    },
    setNsec(secret) {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-signer-set-nsec', secret);
    },
    disconnect() {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-signer-disconnect');
    },
    getPublicKey() {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-nostr-get-public-key');
    },
    signEvent(event) {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-nostr-sign-event', event);
    },
    nip44: {
        encrypt(pubkey, plaintext) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-nostr-nip44-encrypt', { pubkey, plaintext });
        },
        decrypt(pubkey, ciphertext) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-nostr-nip44-decrypt', { pubkey, ciphertext });
        },
    },
    nip19: {
        npubEncode(pubkey) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-nostr-nip19-npub', pubkey);
        },
    },
};
const desktopBridge = {
    catalog: { get: () => electron_1.ipcRenderer.invoke('bookstr-desktop-catalog-current') },
    version: 1,
    signer: desktopSigner,
    openReader(payload) {
        return electron_1.ipcRenderer
            .invoke('bookstr-desktop-open-reader', payload)
            .then(result => Boolean(isRecord(result) && result.ok))
            .catch(() => false);
    },
    focusLibrary() {
        return electron_1.ipcRenderer
            .invoke('bookstr-desktop-focus-library')
            .catch(() => false);
    },
    openPane(pane) {
        if (!ALLOWED_PANES.has(pane))
            return false;
        electron_1.ipcRenderer.send('bookstr-desktop-pane-shortcut', pane);
        return true;
    },
    openExternal(url) {
        return electron_1.ipcRenderer.invoke('bookstr-desktop-open-external', url);
    },
    platform() {
        return process.platform;
    },
    speechModels: {
        status() {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-speech-model-status');
        },
        install(id) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-speech-model-install', id);
        },
        remove(id) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-speech-model-remove', id);
        },
        onProgress(callback) {
            if (typeof callback !== 'function')
                return () => { };
            speechModelProgressCallbacks.add(callback);
            return () => speechModelProgressCallbacks.delete(callback);
        },
    },
    onProgress(callback) {
        if (typeof callback !== 'function')
            return () => { };
        progressCallbacks.add(callback);
        return () => progressCallbacks.delete(callback);
    },
    onOpenReader(callback) {
        if (typeof callback !== 'function')
            return () => { };
        readerOpenCallbacks.add(callback);
        return () => readerOpenCallbacks.delete(callback);
    },
    onOpenSettings(callback) {
        if (typeof callback !== 'function')
            return () => { };
        settingsOpenCallbacks.add(callback);
        return () => settingsOpenCallbacks.delete(callback);
    },
    onOpenPane(callback) {
        if (typeof callback !== 'function')
            return () => { };
        paneOpenCallbacks.add(callback);
        return () => paneOpenCallbacks.delete(callback);
    },
    reportProgress(payload) {
        const normalized = normalizeProgressPayload(payload);
        if (normalized?.md5) {
            electron_1.ipcRenderer.send('bookstr-desktop-report-progress', normalized);
        }
    },
    library: {
        search(request) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-search', request);
        },
        getBook(bookId) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-book', bookId);
        },
        metadata(bookId) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-metadata', bookId);
        },
        importBook(options) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-import', options);
        },
        acquire(record, options = {}) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-acquire', { record, ...options });
        },
        acquireLibgen(book, options = {}) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-acquire-libgen', { book, ...options });
        },
        onAcquisitionProgress(callback) {
            if (typeof callback !== 'function')
                return () => { };
            acquisitionProgressCallbacks.add(callback);
            return () => acquisitionProgressCallbacks.delete(callback);
        },
        downloads() {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-downloads');
        },
        enqueue(request) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-enqueue', request);
        },
        retryDownload(bookId) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-retry-download', bookId);
        },
        onDownloadsChanged(callback) {
            if (typeof callback !== 'function')
                return () => { };
            downloadChangedCallbacks.add(callback);
            return () => downloadChangedCallbacks.delete(callback);
        },
        linkedFolders() {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-linked-folders');
        },
        linkFolder(folder) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-link-folder', folder);
        },
        openReader(bookId) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-library-open-reader', bookId);
        },
    },
    kindle: {
        devices() { return electron_1.ipcRenderer.invoke('bookstr-desktop-kindle-devices'); },
        presence(id) { return electron_1.ipcRenderer.invoke('bookstr-desktop-kindle-presence', id); },
        preview(id, bookId) { return electron_1.ipcRenderer.invoke('bookstr-desktop-kindle-preview', id, bookId); },
        transfer(id, bookId) { return electron_1.ipcRenderer.invoke('bookstr-desktop-kindle-transfer', id, bookId); },
        onProgress(callback) {
            if (typeof callback !== 'function')
                return () => { };
            kindleProgressCallbacks.add(callback);
            return () => kindleProgressCallbacks.delete(callback);
        },
    },
    devices: {
        status() {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-device-status');
        },
        registry() {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-device-registry');
        },
        announce(options = {}) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-device-announce', options);
        },
        createEnvelope(request) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-device-create-envelope', request);
        },
        openEnvelope(request) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-device-open-envelope', request);
        },
        setRegistryEvent(event) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-device-set-registry-event', event);
        },
    },
    transfers: {
        setPreferences(preferences = {}) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-transfer-preferences', preferences);
        },
        status() {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-transfer-status');
        },
        seedPublic(bookId) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-transfer-seed-public', { bookId });
        },
        addPublic(request) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-transfer-add-public', request);
        },
        downloadPublic(request) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-transfer-download-public', request);
        },
        addPrivate(request) {
            return electron_1.ipcRenderer.invoke('bookstr-desktop-transfer-add-private', request);
        },
    },
};
electron_1.contextBridge.exposeInMainWorld('bookstrDesktop', desktopBridge);
//# sourceMappingURL=preload.js.map