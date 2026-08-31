const {
  app,
  BrowserWindow,
  globalShortcut,
  dialog,
  Menu,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const QRCode = require('qrcode');
const { normalizeProgressPayload } = require('../web/desktop-progress');
const { proxyCatalogRequest } = require('./catalog-proxy');
const { proxyDictionaryRequest } = require('./dictionary-proxy');
const { appContentSecurityPolicy } = require('./security-policy');
const { SpeechModelStore } = require('./speech-model-store');
const { WebTorrentBridge, DEFAULT_DOWNLOAD_LIMIT, PUBLIC_UPLOAD_LIMIT } = require('./webtorrent-bridge');
const { LibraryStore } = require('./library-store');
const { LibraryImporter, hashFile, safeExtension } = require('./library-import');
const { localBookCover, localBookMetadata, safeCoverID } = require('./library-cover');
const { AcquisitionManager } = require('./acquisition-manager');
const { ElectronDevicePairing } = require('./device-pairing');

const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const WEB_ROOT = path.join(__dirname, '..', 'web');
const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon-macos.png');
const STATE_FILE = path.join(app.getPath('userData'), 'bookstr-desktop-state.json');
const speechModelStore = new SpeechModelStore(path.join(app.getPath('userData'), 'speech-models'));
const DESKTOP_NOSTR_STATE_KEY = 'desktopNostr';
const TORRENT_PREFERENCES_STATE_KEY = 'torrentPreferences';
const DESKTOP_NOSTR_SECRET_FIELD = 'secret';
const BOOKSTR_DESKTOP_RELEASES_URL = 'https://github.com/guaka/bookstr/releases';
const NOSTR_SIGNER_ENV_KEYS = [
  'BOOKSTR_DESKTOP_NSEC',
  'BOOKSTR_NSEC',
];
const APP_PROTOCOL = 'app';
const APP_HOST = 'bookstr';
const APP_ORIGIN = `${APP_PROTOCOL}://${APP_HOST}`;
const SESSION_PARTITION = 'persist:bookstr-desktop';
const ALLOWED_EXTERNAL_URL_PROTOCOLS = ['http:', 'https:', 'mailto:'];
const NOSTR_SIGNER_NOT_CONFIGURED_MESSAGE = 'Nostr desktop signer is not configured.';
const NIP46_CONNECTION_RELAYS = [
  'wss://relay.nomadwiki.org',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
];
const NIP46_PERMISSIONS = [
  'get_public_key',
  'nip44_encrypt',
  'nip44_decrypt',
  'sign_event:3',
  'sign_event:5',
  'sign_event:22242',
  'sign_event:30003',
  'sign_event:30078',
];
const DEFAULT_BOUNDS = {
  width: 1260,
  height: 900,
  x: undefined,
  y: undefined,
};
const LIBRARY_PANES = [
  { label: 'Home', pane: 'home', accelerator: 'CmdOrCtrl+1' },
  { label: 'Reading', pane: 'reading', accelerator: 'CmdOrCtrl+2' },
  { label: 'Search', pane: 'search', accelerator: 'CmdOrCtrl+3' },
  { label: 'People', pane: 'people', accelerator: 'CmdOrCtrl+4' },
  { label: 'Words', pane: 'words', accelerator: 'CmdOrCtrl+5' },
];
const DICTIONARY_PROXY_BASE_URL = process.env.NODE_ENV === 'test'
  ? process.env.BOOKSTR_DESKTOP_TEST_DICTIONARY_BASE_URL
  : undefined;

function timestampVersion(now = new Date()) {
  const part = value => String(value).padStart(2, '0');
  return `0.1-${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}`;
}

const DESKTOP_VERSION = process.env.BOOKSTR_DESKTOP_VERSION || timestampVersion();
const DESKTOP_APP_ID = 'app.bookstr.desktop';
if (process.platform === 'linux') {
  app.setDesktopName(`${DESKTOP_APP_ID}.desktop`);
}
if (process.platform === 'win32') {
  app.setAppUserModelId(DESKTOP_APP_ID);
}
app.setName('libstr');
app.setVersion(DESKTOP_VERSION);
app.setAboutPanelOptions({
  applicationName: 'libstr',
  applicationVersion: DESKTOP_VERSION,
  version: DESKTOP_VERSION,
});

function nip46ConnectionRelays() {
  if (process.env.NODE_ENV === 'test') {
    try {
      const testRelay = new URL(process.env.BOOKSTR_DESKTOP_TEST_NIP46_RELAY_URL || '');
      if (
        ['ws:', 'wss:'].includes(testRelay.protocol)
        && ['127.0.0.1', 'localhost', '::1'].includes(testRelay.hostname)
      ) {
        return [testRelay.toString()];
      }
    } catch {
      // Use the production relay set when the test override is absent or invalid.
    }
  }
  return NIP46_CONNECTION_RELAYS;
}

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=UTF-8'],
  ['.css', 'text/css; charset=UTF-8'],
  ['.js', 'application/javascript; charset=UTF-8'],
  ['.mjs', 'application/javascript; charset=UTF-8'],
  ['.json', 'application/json; charset=UTF-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=UTF-8'],
]);

let mainWindow;
let readerNavigationId = 0;
let cachedNostrTools = null;
let cachedNostrSignerSecret = null;
let cachedNostrSignerPublicKey = null;
let cachedNostrNip44EncryptMode = null;
let cachedNostrNip44DecryptMode = null;
let cachedNostrAuthMode = '';
let cachedNip46Signer = null;
let cachedNip46BunkerUrl = '';
let cachedNip46Pool = null;
let nip46QrSession = null;
let torrentBridge = null;
let libraryDataDir = '';
let libraryStore = null;
let libraryImporter = null;
let acquisitionManager = null;
let devicePairing = null;

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function ensureLibraryPath(value) {
  if (!libraryDataDir || typeof value !== 'string' || !value.trim() || value.includes('\0')) return '';
  const root = path.resolve(libraryDataDir);
  const candidate = path.resolve(value);
  const relative = path.relative(root, candidate);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? candidate
    : '';
}

function libraryRelativePath(filePath) {
  const candidate = ensureLibraryPath(filePath);
  if (!candidate) return '';
  return path.relative(path.resolve(libraryDataDir), candidate).replaceAll(path.sep, '/');
}

function getTorrentBridge() {
  if (!torrentBridge) {
    torrentBridge = new WebTorrentBridge({ dataDir: path.join(libraryDataDir, 'torrents') });
  }
  return torrentBridge;
}

function getLibraryStore() {
  if (!libraryStore) {
    libraryStore = new LibraryStore({
      dbPath: path.join(libraryDataDir, 'library.sqlite'),
      libraryRoot: libraryDataDir,
    });
  }
  return libraryStore;
}

function getLibraryImporter() {
  if (!libraryImporter) libraryImporter = new LibraryImporter({ libraryRoot: libraryDataDir });
  return libraryImporter;
}

function getAcquisitionManager() {
  if (!acquisitionManager) {
    acquisitionManager = new AcquisitionManager({
      store: getLibraryStore(),
      importer: getLibraryImporter(),
      torrentBridge: getTorrentBridge(),
      stagingRoot: path.join(libraryDataDir, '.staging'),
    });
  }
  return acquisitionManager;
}

function getDevicePairing() {
  if (!devicePairing) {
    devicePairing = new ElectronDevicePairing({
      loadState,
      saveState,
      safeStorage,
      loadTools: loadNostrTools,
      accountPublicKey: resolveNostrSignerPublicKey,
      decryptForAccount: async (pubkey, ciphertext) => {
        if (await resolveNostrAuthMode() === 'nip46') return (await resolveNip46Signer()).nip44Decrypt(pubkey, ciphertext);
        const tools = await loadNostrTools();
        return decryptWithNip44(tools, ciphertext, await resolveNostrSignerSecret(), pubkey);
      },
      loadRegistry: loadTrustedDeviceRegistry,
      relays: NIP46_CONNECTION_RELAYS,
    });
  }
  return devicePairing;
}

function insidePath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolveRegisteredLibraryFile(bookId) {
  const book = getLibraryStore().getBook(bookId);
  if (!book) throw new Error('Book is not present in the local library.');
  const registration = getLibraryStore().libraryFile(book.id);
  if (!registration) throw new Error('Book has no registered library file.');
  const lexicalPath = getLibraryImporter().resolveRelativePath(registration.relativePath);
  // Resolve symlinks before handing a path to the torrent client. A database
  // row is not permission to seed a file outside the library root.
  const [realRoot, realPath] = await Promise.all([
    fs.realpath(libraryDataDir),
    fs.realpath(lexicalPath),
  ]);
  if (!insidePath(realRoot, realPath)) throw new Error('Registered library file escaped the library root.');
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) throw new Error('Registered library path is not a regular file.');
  return { book, registration, filePath: realPath };
}

async function loadTrustedDeviceRegistry() {
  const state = await loadState();
  const storedEvent = state?.devicePairing?.registryEvent;
  if (!isRecord(storedEvent) || JSON.stringify(storedEvent).length > 64 * 1024) return { version: 1, devices: [] };
  const accountPubkey = normalizeHex(await resolveNostrSignerPublicKey());
  if (!accountPubkey) return { version: 1, devices: [] };
  const tools = await loadNostrTools();
  const { verifyDeviceRegistryEvent } = await import('../shared/contracts/device-registry-nip78.mjs');
  const registry = await verifyDeviceRegistryEvent(storedEvent, {
    ownerPubkey: accountPubkey,
    tools,
    decrypt: (peer, ciphertext) => decryptAccountPayload(peer, ciphertext, tools),
  });
  return registry || { version: 1, devices: [] };
}

async function decryptAccountPayload(peer, ciphertext, tools = null) {
  if (await resolveNostrAuthMode() === 'nip46') return (await resolveNip46Signer()).nip44Decrypt(peer, ciphertext);
  const nostrTools = tools || await loadNostrTools();
  return decryptWithNip44(nostrTools, ciphertext, await resolveNostrSignerSecret(), peer);
}

// Registry ingestion stays in the main process. It verifies the account
// signature and NIP-44 payload before persisting the event used by the loader;
// there is intentionally no renderer-facing registry mutation API.
async function ingestTrustedDeviceRegistryEvent(event) {
  if (!isRecord(event) || JSON.stringify(event).length > 64 * 1024) return false;
  const createdAt = Number(event.created_at);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) return false;
  const accountPubkey = normalizeHex(await resolveNostrSignerPublicKey());
  if (!accountPubkey) return false;
  const tools = await loadNostrTools();
  const { verifyDeviceRegistryEvent } = await import('../shared/contracts/device-registry-nip78.mjs');
  const registry = await verifyDeviceRegistryEvent(event, {
    ownerPubkey: accountPubkey,
    tools,
    decrypt: (peer, ciphertext) => decryptAccountPayload(peer, ciphertext, tools),
  });
  if (!registry) return false;
  const state = await loadState();
  const previousCreatedAt = Number(state?.devicePairing?.registryEvent?.created_at);
  if (Number.isSafeInteger(previousCreatedAt) && createdAt <= previousCreatedAt) return false;
  await saveState({
    devicePairing: {
      ...(isRecord(state.devicePairing) ? state.devicePairing : {}),
      registryEvent: event,
    },
  });
  return true;
}

function normalizeHex(value) {
  const raw = String(value || '').toLowerCase().trim();
  return /^[0-9a-f]{64}$/.test(raw) ? raw : '';
}

function normalizeNostrBytesOrHex(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let hex = '';
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  }
  return '';
}

async function loadNostrTools() {
  if (cachedNostrTools) {
    return cachedNostrTools;
  }
  const [pure, nip19, nip44, nip46, pool] = await Promise.all([
    import('nostr-tools/pure'),
    import('nostr-tools/nip19'),
    import('nostr-tools/nip44'),
    import('nostr-tools/nip46'),
    import('nostr-tools/pool'),
  ]);
  cachedNostrTools = {
    finalizeEvent: pure.finalizeEvent,
    generateSecretKey: pure.generateSecretKey,
    getPublicKey: pure.getPublicKey,
    verifyEvent: pure.verifyEvent,
    nip19,
    nip44,
    nip46,
    SimplePool: pool.SimplePool,
  };
  return cachedNostrTools;
}

function normalizeDesktopNostrSecret(raw, tools) {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    return '';
  }
  if (isRecord(tools?.nip19) && normalized.toLowerCase().startsWith('nsec')) {
    try {
      const decoded = tools.nip19.decode(normalized);
      if (decoded?.type === 'nsec') {
        return normalizeHex(normalizeNostrBytesOrHex(decoded.data));
      }
    } catch {
      return '';
    }
  }
  return normalizeHex(normalized);
}

function makeNip44EncryptCandidates(plaintext, secret, pubkey) {
  return [
    ['pt-secret-pub', [plaintext, secret, pubkey]],
    ['secret-pub-pt', [secret, pubkey, plaintext]],
  ];
}

function makeNip44DecryptCandidates(ciphertext, secret, pubkey) {
  return [
    ['cipher-secret-pub', [ciphertext, secret, pubkey]],
    ['secret-pub-cipher', [secret, pubkey, ciphertext]],
  ];
}

function resolveCandidateArgsByMode(candidates, modeName) {
  const found = candidates.find(([name]) => name === modeName);
  return found ? found[1] : null;
}

async function callNip44WithFallback(tools, methodName, candidates, cachedMode) {
  const orderedCandidates = [];
  const seen = new Set();
  const cachedArgs = cachedMode ? resolveCandidateArgsByMode(candidates, cachedMode) : null;
  if (cachedArgs) {
    seen.add(cachedMode);
    orderedCandidates.push([cachedMode, cachedArgs]);
  }
  for (const candidate of candidates) {
    if (seen.has(candidate[0])) {
      continue;
    }
    orderedCandidates.push(candidate);
  }
  let lastError = null;
  for (const [mode, args] of orderedCandidates) {
    try {
      const result = await tools.nip44[methodName](...args);
      if (typeof result === 'string' && result.length > 0) {
        return { mode, result };
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Failed to run nip44.${methodName}.`);
}

async function encryptWithNip44(tools, plaintext, secret, pubkey) {
  const conversationKey = tools.nip44.getConversationKey(hexToBytes(secret), pubkey);
  return tools.nip44.encrypt(plaintext, conversationKey);
}

async function decryptWithNip44(tools, ciphertext, secret, pubkey) {
  const conversationKey = tools.nip44.getConversationKey(hexToBytes(secret), pubkey);
  return tools.nip44.decrypt(ciphertext, conversationKey);
}

function hexToBytes(value) {
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

function resolveNostrSecretFromEnvironment(tools) {
  for (const key of NOSTR_SIGNER_ENV_KEYS) {
    const candidate = process.env[key];
    const secret = normalizeDesktopNostrSecret(candidate, tools);
    if (secret) {
      return secret;
    }
  }
  return '';
}

async function resolveNostrSecretFromState(tools) {
  if (!safeStorage.isEncryptionAvailable()) {
    return '';
  }
  const state = await loadState();
  const encodedSecret = state?.[DESKTOP_NOSTR_STATE_KEY]?.[DESKTOP_NOSTR_SECRET_FIELD];
  if (!encodedSecret || typeof encodedSecret !== 'string') {
    return '';
  }
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(encodedSecret, 'base64'));
    return normalizeDesktopNostrSecret(decrypted, tools);
  } catch {
    return '';
  }
}

async function resolveNostrSignerSecret() {
  if (cachedNostrSignerSecret) {
    return cachedNostrSignerSecret;
  }
  const tools = await loadNostrTools();
  const envSecret = resolveNostrSecretFromEnvironment(tools);
  if (envSecret) {
    cachedNostrSignerSecret = envSecret;
    return envSecret;
  }
  const stateSecret = await resolveNostrSecretFromState(tools);
  if (stateSecret) {
    cachedNostrSignerSecret = stateSecret;
    return stateSecret;
  }
  throw new Error(NOSTR_SIGNER_NOT_CONFIGURED_MESSAGE);
}

async function resolveNostrAuthMode() {
  if (cachedNostrAuthMode) return cachedNostrAuthMode;
  const tools = await loadNostrTools();
  if (resolveNostrSecretFromEnvironment(tools)) {
    cachedNostrAuthMode = 'nsec';
    return cachedNostrAuthMode;
  }
  const state = await loadState();
  const mode = state?.[DESKTOP_NOSTR_STATE_KEY]?.mode;
  cachedNostrAuthMode = mode === 'nip46' || mode === 'nsec' ? mode : '';
  return cachedNostrAuthMode;
}

function nip46SignerParams({ skipSwitchRelays = false } = {}) {
  return {
    skipSwitchRelays,
    onauth(url) {
      if (isExternalUrlAllowed(url)) void shell.openExternal(url);
    },
  };
}

async function resolveNip46Signer() {
  if (cachedNip46Signer) return cachedNip46Signer;
  const state = await loadState();
  const signerState = state?.[DESKTOP_NOSTR_STATE_KEY];
  if (signerState?.mode !== 'nip46' || typeof signerState.bunker !== 'string') {
    throw new Error(NOSTR_SIGNER_NOT_CONFIGURED_MESSAGE);
  }
  const tools = await loadNostrTools();
  const clientSecret = await resolveNostrSecretFromState(tools);
  const bunkerPointer = await tools.nip46.parseBunkerInput(signerState.bunker);
  if (!clientSecret || !bunkerPointer) {
    throw new Error(NOSTR_SIGNER_NOT_CONFIGURED_MESSAGE);
  }
  cachedNip46Signer = tools.nip46.BunkerSigner.fromBunker(
    hexToBytes(clientSecret),
    bunkerPointer,
    nip46SignerParams(),
  );
  cachedNip46BunkerUrl = signerState.bunker;
  return cachedNip46Signer;
}

function encryptedSecretForState(secret) {
  if (!safeStorage.isEncryptionAvailable()) return '';
  return safeStorage.encryptString(secret).toString('base64');
}

async function configureLocalNsec(rawSecret) {
  const tools = await loadNostrTools();
  const secret = normalizeDesktopNostrSecret(rawSecret, tools);
  if (!secret) throw new Error('Invalid nsec. Paste an nsec1… key or 64-character hex key.');
  if (cachedNip46Signer) await cachedNip46Signer.close();
  cachedNip46Signer = null;
  cachedNip46BunkerUrl = '';
  cachedNostrAuthMode = 'nsec';
  cachedNostrSignerSecret = secret;
  cachedNostrSignerPublicKey = tools.getPublicKey(hexToBytes(secret));
  const encryptedSecret = encryptedSecretForState(secret);
  await saveState({
    [DESKTOP_NOSTR_STATE_KEY]: {
      mode: encryptedSecret ? 'nsec' : '',
      secret: encryptedSecret,
      bunker: '',
      pubkey: cachedNostrSignerPublicKey,
    },
  });
  return desktopSignerStatus();
}

async function configureNip46(rawInput) {
  const input = String(rawInput || '').trim();
  const tools = await loadNostrTools();
  const bunkerPointer = await tools.nip46.parseBunkerInput(input);
  if (!bunkerPointer || bunkerPointer.relays.length === 0) {
    throw new Error('Paste a valid bunker:// connection or NIP-05 signer address.');
  }
  const clientSecretBytes = tools.generateSecretKey();
  const signer = tools.nip46.BunkerSigner.fromBunker(
    clientSecretBytes,
    bunkerPointer,
    nip46SignerParams(),
  );
  await signer.connect({ name: 'libstr Desktop', url: 'https://github.com/guaka/bookstr' });
  return activateNip46Signer(signer, clientSecretBytes);
}

async function activateNip46Signer(signer, clientSecretBytes, pool = null) {
  const tools = await loadNostrTools();
  const pubkey = normalizeHex(await signer.getPublicKey());
  if (!pubkey) {
    await signer.close();
    throw new Error('The remote signer returned an invalid public key.');
  }
  if (cachedNip46Signer) await cachedNip46Signer.close();
  if (cachedNip46Pool) cachedNip46Pool.pool.close(cachedNip46Pool.relays);
  const persistedPointer = { ...signer.bp, secret: null };
  const bunker = tools.nip46.toBunkerURL(persistedPointer);
  const clientSecret = Buffer.from(clientSecretBytes).toString('hex');
  const encryptedSecret = encryptedSecretForState(clientSecret);
  cachedNip46Signer = signer;
  cachedNip46Pool = pool ? { pool, relays: [...signer.bp.relays] } : null;
  cachedNip46BunkerUrl = bunker;
  cachedNostrAuthMode = 'nip46';
  cachedNostrSignerSecret = clientSecret;
  cachedNostrSignerPublicKey = pubkey;
  await saveState({
    [DESKTOP_NOSTR_STATE_KEY]: {
      mode: encryptedSecret ? 'nip46' : '',
      secret: encryptedSecret,
      bunker: encryptedSecret ? bunker : '',
      pubkey,
    },
  });
  return desktopSignerStatus();
}

async function startNip46QrSession() {
  if (nip46QrSession?.status !== 'connected') {
    nip46QrSession?.abortController?.abort();
    nip46QrSession?.pool?.close(nip46QrSession.relays || []);
  }
  const tools = await loadNostrTools();
  const pool = new tools.SimplePool();
  const relayCandidates = nip46ConnectionRelays();
  const relayResults = await Promise.allSettled(relayCandidates.map(async relay => {
    await pool.ensureRelay(relay);
    return relay;
  }));
  const connectedRelays = relayResults
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);
  if (connectedRelays.length === 0) {
    pool.close(relayCandidates);
    throw new Error('Could not connect to a NIP-46 relay. Check your network and try again.');
  }
  const clientSecretBytes = tools.generateSecretKey();
  const clientPubkey = tools.getPublicKey(clientSecretBytes);
  const secret = crypto.randomBytes(16).toString('hex');
  const uri = tools.nip46.createNostrConnectURI({
    clientPubkey,
    relays: connectedRelays,
    secret,
    perms: NIP46_PERMISSIONS,
    name: 'libstr Desktop',
    url: 'https://github.com/guaka/bookstr',
  });
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 280 });
  const abortController = new AbortController();
  const responseObserver = pool.subscribe(
    connectedRelays,
    { kinds: [24133], '#p': [clientPubkey], limit: 0 },
    {
      onevent() {
        if (nip46QrSession?.uri === uri) {
          nip46QrSession = { ...nip46QrSession, responseReceived: true };
        }
        console.info('[nip46] Remote signer response received.');
      },
      onclose() {},
    },
  );
  nip46QrSession = {
    status: 'waiting', uri, qrDataUrl, error: '', abortController, pool, relays: connectedRelays,
    responseObserver, responseReceived: false,
  };
  console.info(`[nip46] Waiting for approval on ${connectedRelays.join(', ')}.`);
  void tools.nip46.BunkerSigner.fromURI(
    clientSecretBytes,
    uri,
    { ...nip46SignerParams({ skipSwitchRelays: true }), pool },
    abortController.signal,
  ).then(async signer => {
    responseObserver.close();
    console.info('[nip46] Approval decrypted; requesting the account public key.');
    if (nip46QrSession?.uri === uri) {
      nip46QrSession = { ...nip46QrSession, status: 'authorizing', error: '' };
    }
    await activateNip46Signer(signer, clientSecretBytes, pool);
    console.info('[nip46] Remote signer activated and persisted.');
    if (nip46QrSession?.uri === uri) {
      nip46QrSession = { ...nip46QrSession, status: 'connected', error: '' };
    }
  }).catch(error => {
    responseObserver.close();
    pool.close(connectedRelays);
    console.error('[nip46] Connection failed:', error);
    if (nip46QrSession?.uri === uri) {
      nip46QrSession = {
        ...nip46QrSession,
        status: abortController.signal.aborted ? 'cancelled' : 'failed',
        error: abortController.signal.aborted ? '' : String(error?.message || error),
      };
    }
  });
  return { status: 'waiting', uri, qrDataUrl };
}

function nip46QrSessionStatus() {
  if (!nip46QrSession) return { status: 'idle', error: '' };
  return {
    status: nip46QrSession.status,
    error: nip46QrSession.error || '',
    relays: nip46QrSession.relays || [],
    responseReceived: Boolean(nip46QrSession.responseReceived),
  };
}

function cancelNip46QrSession() {
  if (nip46QrSession?.abortController) nip46QrSession.abortController.abort();
  nip46QrSession?.responseObserver?.close();
  if (nip46QrSession?.status !== 'connected') {
    nip46QrSession?.pool?.close(nip46QrSession.relays || []);
  }
  nip46QrSession = null;
  return true;
}

async function disconnectDesktopSigner() {
  cancelNip46QrSession();
  if (cachedNip46Signer) await cachedNip46Signer.close();
  if (cachedNip46Pool) cachedNip46Pool.pool.close(cachedNip46Pool.relays);
  cachedNip46Signer = null;
  cachedNip46Pool = null;
  cachedNip46BunkerUrl = '';
  cachedNostrAuthMode = '';
  cachedNostrSignerSecret = null;
  cachedNostrSignerPublicKey = null;
  await saveState({
    [DESKTOP_NOSTR_STATE_KEY]: { mode: '', secret: '', bunker: '', pubkey: '' },
  });
  return desktopSignerStatus();
}

async function desktopSignerStatus() {
  const mode = await resolveNostrAuthMode();
  let pubkey = cachedNostrSignerPublicKey || '';
  if (!pubkey && mode) {
    const state = await loadState();
    pubkey = normalizeHex(state?.[DESKTOP_NOSTR_STATE_KEY]?.pubkey || '');
  }
  return {
    mode,
    configured: Boolean(mode),
    pubkey,
    persistent: safeStorage.isEncryptionAvailable(),
  };
}

async function resolveNostrSignerPublicKey() {
  if (cachedNostrSignerPublicKey) {
    return cachedNostrSignerPublicKey;
  }
  if (await resolveNostrAuthMode() === 'nip46') {
    cachedNostrSignerPublicKey = normalizeHex(await (await resolveNip46Signer()).getPublicKey());
    return cachedNostrSignerPublicKey;
  }
  const tools = await loadNostrTools();
  const secret = await resolveNostrSignerSecret();
  const publicKey = tools.getPublicKey(hexToBytes(secret));
  cachedNostrSignerPublicKey = publicKey;
  return publicKey;
}

function normalizeNip44Payload(payload) {
  if (!isRecord(payload)) {
    return null;
  }
  const pubkey = normalizeHex(payload.pubkey);
  if (!pubkey) {
    return null;
  }
  return {
    pubkey,
    plaintext: String(payload.plaintext || ''),
    ciphertext: String(payload.ciphertext || ''),
  };
}

function normalizeNostrEventPayload(payload) {
  if (!isRecord(payload)) {
    return null;
  }
  const kind = Number(payload.kind);
  if (!Number.isInteger(kind)) {
    return null;
  }
  const createdAt = Number(payload.created_at);
  if (!Number.isFinite(createdAt)) {
    return null;
  }
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const content = String(payload.content || '');
  const event = {
    kind,
    created_at: Math.floor(createdAt),
    content,
    tags,
    pubkey: normalizeHex(payload.pubkey || ''),
  };
  if (typeof payload.id === 'string') {
    event.id = String(payload.id);
  }
  if (typeof payload.sig === 'string') {
    event.sig = String(payload.sig);
  }
  return event;
}

function safeJoin(base, route) {
  const normalized = path.posix.normalize(`/${route}`);
  const abs = path.normalize(path.join(base, normalized));
  if (!abs.startsWith(path.normalize(base + path.sep))) {
    return null;
  }
  return abs;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Reader payload must be an object.' };
  }
  const base64 = String(payload.base64 || '').trim();
  if (!isBase64Safe(base64)) {
    return { ok: false, error: 'Invalid reader payload.' };
  }
  return {
    ok: true,
    kind: String(payload.kind || '').toLowerCase() === 'pdf' ? 'pdf' : 'epub',
    base64,
    theme: String(payload.theme || 'paper').toLowerCase(),
    font: String(payload.font || 'arial').toLowerCase(),
    alignment: String(payload.alignment || 'justified').toLowerCase(),
    readUrl: String(payload.readUrl || ''),
    cfi: String(payload.cfi || ''),
    book: payload.book && typeof payload.book === 'object' ? payload.book : {},
  };
}

function resolveFile(pathname = '/') {
  let webPath = pathname;
  if (!webPath || webPath === '/') webPath = '/index.html';
  if (webPath.endsWith('/')) webPath += 'index.html';
  return safeJoin(WEB_ROOT, webPath);
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES.get(ext) || 'application/octet-stream';
}

function nonceInlineScripts(html, nonce) {
  return html.replace(/<script(?![^>]*\bsrc\s*=)([^>]*)>/gi, (tag, attributes) => {
    if (/\bnonce\s*=/.test(attributes)) return tag;
    return `<script nonce="${nonce}"${attributes}>`;
  });
}

function isLocalBookstrUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === `${APP_PROTOCOL}:` && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}

function normalizeReaderKey(payload) {
  const book = payload?.book || {};
  const md5 = String(book.md5 || '').trim().toLowerCase();
  const sourceUrl = String(payload.readUrl || book.readUrl || '').trim();
  if (md5) return `md5:${md5}`;
  if (sourceUrl) return `url:${sourceUrl}`;
  return `anonymous:${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

async function saveState(state) {
  if (!isRecord(state)) {
    return;
  }
  try {
    const existing = await loadState();
    const next = {
      ...existing,
      ...state,
    };
    if (isRecord(existing?.[DESKTOP_NOSTR_STATE_KEY]) && isRecord(state?.[DESKTOP_NOSTR_STATE_KEY])) {
      next[DESKTOP_NOSTR_STATE_KEY] = {
        ...existing[DESKTOP_NOSTR_STATE_KEY],
        ...state[DESKTOP_NOSTR_STATE_KEY],
      };
    }
    await fs.writeFile(STATE_FILE, JSON.stringify(next), 'utf8');
  } catch {
    // ignore
  }
}

async function torrentPreferences() {
  const state = await loadState();
  const saved = isRecord(state[TORRENT_PREFERENCES_STATE_KEY]) ? state[TORRENT_PREFERENCES_STATE_KEY] : {};
  return {
    autoDownload: saved.autoDownload !== false,
    autoSeed: saved.autoSeed !== false,
    downloadLimit: Number.isFinite(Number(saved.downloadLimit)) ? Number(saved.downloadLimit) : DEFAULT_DOWNLOAD_LIMIT,
    uploadLimit: Number.isFinite(Number(saved.uploadLimit)) ? Number(saved.uploadLimit) : PUBLIC_UPLOAD_LIMIT,
  };
}

function clampBounds(stored) {
  const width = Number(stored?.width);
  const height = Number(stored?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return DEFAULT_BOUNDS;
  }
  return {
    x: Number.isFinite(Number(stored.x)) ? Number(stored.x) : undefined,
    y: Number.isFinite(Number(stored.y)) ? Number(stored.y) : undefined,
    width: Math.max(980, Math.min(2400, width)),
    height: Math.max(680, Math.min(2000, height)),
  };
}

async function createLibraryWindow() {
  const state = await loadState();
  const bounds = clampBounds(state.windowBounds || {});
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 950,
    minHeight: 620,
    title: 'libstr',
    icon: APP_ICON_PATH,
    backgroundColor: '#f7f3ea',
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD_PATH,
      partition: SESSION_PARTITION,
    },
  });

  attachSecurity(mainWindow.webContents);
  mainWindow.on('page-title-updated', event => {
    event.preventDefault();
    mainWindow?.setTitle('libstr');
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  await mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  mainWindow.on('resize', async () => {
    if (!mainWindow || mainWindow.isMinimized() || mainWindow.isMaximized()) return;
    await saveState({ windowBounds: mainWindow.getBounds() });
  });

  mainWindow.on('close', () => {
    if (mainWindow?.isDestroyed()) return;
    saveState({ windowBounds: mainWindow.getBounds() });
  });
}

function attachSecurity(webContents) {
  webContents.on('before-input-event', (event, input) => {
    if ((input.meta || input.control) && !input.alt && (input.key === ',' || input.code === 'Comma')) {
      event.preventDefault();
      openLibrarySettings();
    }
  });
  webContents.on('will-navigate', (event, url) => {
    if (isLocalBookstrUrl(url)) return;
    event.preventDefault();
    if (!isExternalUrlAllowed(url)) return;
    void shell.openExternal(url);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalBookstrUrl(url)) {
      void webContents.loadURL(url);
      return { action: 'deny' };
    }
    if (!isExternalUrlAllowed(url)) {
      return { action: 'deny' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function ensureReaderWindowForPayload(payload) {
  const normalized = normalizePayload(payload);
  if (!normalized?.ok) {
    return normalized;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'libstr window is not available.' };
  }

  const requestedKind = normalized.kind;
  const key = normalizeReaderKey(normalized);
  const readerPath = requestedKind === 'pdf' ? 'pdf-reader.html' : 'reader.html';
  const readerURL = `${APP_ORIGIN}/${readerPath}`;
  const currentURL = mainWindow.webContents.getURL().split('?')[0];
  const sendPayload = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('bookstr-desktop-open-reader', normalized);
  };

  if (currentURL === readerURL) {
    sendPayload();
  } else {
    const navigationId = ++readerNavigationId;
    mainWindow.webContents.once('did-finish-load', () => {
      if (navigationId !== readerNavigationId) return;
      sendPayload();
    });
    void mainWindow.loadURL(readerURL);
  }
  focusLibraryWindow();
  return { ok: true, key, reused: currentURL === readerURL, kind: requestedKind };
}

function isBase64Safe(value) {
  return typeof value === 'string' && value.length > 64;
}

function mainWindowPathname() {
  if (!mainWindow || mainWindow.isDestroyed()) return '';
  try {
    return new URL(mainWindow.webContents.getURL()).pathname;
  } catch {
    return '';
  }
}

function focusLibraryWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  const currentPath = mainWindowPathname();
  if (currentPath === '/reader.html' || currentPath === '/pdf-reader.html') {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }
  mainWindow.show();
  mainWindow.focus();
  return true;
}

function openLibrarySettings() {
  if (!focusLibraryWindow()) return false;
  if (mainWindowPathname() === '/index.html') {
    mainWindow.webContents.send('bookstr-desktop-open-settings');
  } else {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('bookstr-desktop-open-settings');
    });
  }
  return true;
}

function openLibraryPane(pane) {
  if (!focusLibraryWindow()) return false;
  if (mainWindowPathname() === '/index.html') {
    mainWindow.webContents.send('bookstr-desktop-open-pane', pane);
  } else {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('bookstr-desktop-open-pane', pane);
    });
  }
  return true;
}

function isExternalUrlAllowed(url) {
  try {
    const parsed = new URL(url);
    return ALLOWED_EXTERNAL_URL_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
}

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const checkForUpdatesMenu = {
    label: 'Check for Updates',
    accelerator: 'CmdOrCtrl+Shift+U',
    click: () => {
      void shell.openExternal(BOOKSTR_DESKTOP_RELEASES_URL);
    },
  };
  const menuTemplate = [
    ...(isMac ? [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          {
            label: 'Settings…',
            accelerator: 'CommandOrControl+,',
            click: () => void openLibrarySettings(),
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
    ] : []),
    {
      label: 'libstr',
      submenu: [
        ...LIBRARY_PANES.map(({ label, pane, accelerator }) => ({
          label,
          accelerator,
          click: () => void openLibraryPane(pane),
        })),
        { type: 'separator' },
        {
          label: 'Show Library',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => void focusLibraryWindow(),
        },
        ...(!isMac ? [{
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          click: () => void openLibrarySettings(),
        }] : []),
        { type: 'separator' },
        checkForUpdatesMenu,
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

function setupIpcHandlers() {
  ipcMain.on('bookstr-desktop-pane-shortcut', (_event, pane) => {
    if (!LIBRARY_PANES.some(item => item.pane === pane)) return;
    openLibraryPane(pane);
  });

  ipcMain.handle('bookstr-desktop-open-reader', (_, payload) => {
    return ensureReaderWindowForPayload(payload);
  });

  ipcMain.on('bookstr-desktop-report-progress', (_, payload) => {
    const safe = normalizeProgressPayload(payload, 'main');
    if (!safe || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send('bookstr-desktop-reader-progress', safe);
  });

  ipcMain.handle('bookstr-desktop-focus-library', () => {
    return focusLibraryWindow();
  });

  ipcMain.handle('bookstr-desktop-open-settings', () => {
    return openLibrarySettings();
  });

  ipcMain.handle('bookstr-desktop-open-external', (_event, url) => {
    if (typeof url !== 'string' || !isExternalUrlAllowed(url)) {
      return false;
    }
    return shell.openExternal(url);
  });

  ipcMain.handle('bookstr-desktop-speech-model-status', () => speechModelStore.status());
  ipcMain.handle('bookstr-desktop-speech-model-install', (event, id) => {
    return speechModelStore.install(id, progress => {
      if (!event.sender.isDestroyed()) event.sender.send('bookstr-desktop-speech-model-progress', progress);
    });
  });
  ipcMain.handle('bookstr-desktop-speech-model-remove', (_event, id) => speechModelStore.remove(id));
  ipcMain.handle('bookstr-desktop-library-search', (_event, request) => {
    if (!isRecord(request)) throw new Error('Invalid library search request.');
    return getLibraryStore().search({
      query: String(request.query || ''),
      language: String(request.language || ''),
      limit: request.limit,
      offset: request.offset,
    });
  });
  ipcMain.handle('bookstr-desktop-library-book', (_event, bookId) => getLibraryStore().getBook(bookId));
  ipcMain.handle('bookstr-desktop-library-metadata', async (_event, bookId) => {
    const id = safeCoverID(bookId);
    if (!id) return null;
    try {
      const { filePath } = await resolveRegisteredLibraryFile(id);
      return await localBookMetadata({ bookId: id, bookPath: filePath });
    } catch {
      return null;
    }
  });
  ipcMain.handle('bookstr-desktop-library-import', async (_event, request) => {
    if (!isRecord(request)) throw new Error('Invalid library import request.');
    const selection = await dialog.showOpenDialog({
      title: 'Import book into Bookstr',
      defaultPath: libraryDataDir,
      properties: ['openFile'],
      filters: [{ name: 'Books', extensions: ['epub', 'pdf', 'fb2', 'txt'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (selection.canceled || !selection.filePaths?.[0]) return null;
    const expectedSha256 = /^[a-f0-9]{64}$/i.test(String(request.expectedSha256 || ''))
      ? String(request.expectedSha256).toLowerCase()
      : undefined;
    const imported = await getLibraryImporter().importFile(selection.filePaths[0], {
      extension: request.extension,
      expectedSha256,
    });
    const book = getLibraryStore().upsertBook({
      ...request,
      id: request.bookId || imported.sha256,
      sha256: imported.sha256,
      extension: imported.extension,
      filesize_bytes: imported.size,
      source: request.source || 'local-import',
    });
    getLibraryStore().registerLibraryFile({
      bookId: book.id,
      relativePath: imported.relativePath,
      sizeBytes: imported.size,
      sha256: imported.sha256,
    });
    getLibraryStore().setDownload({
      bookId: book.id,
      status: 'ready',
      bytes: imported.size,
      totalBytes: imported.size,
      source: 'local-import',
      relativePath: imported.relativePath,
    });
    return { book, imported: { sha256: imported.sha256, size: imported.size, extension: imported.extension } };
  });
  ipcMain.handle('bookstr-desktop-library-acquire', async (event, request) => {
    if (!isRecord(request) || !isRecord(request.record)) throw new Error('Invalid acquisition request.');
    const result = await getAcquisitionManager().acquire(request.record, {
      format: request.format,
      preferTorrent: request.preferTorrent !== false,
      includeRestricted: request.includeRestricted === true,
      onProgress: payload => {
        if (!event.sender.isDestroyed()) event.sender.send('bookstr-desktop-acquisition-progress', payload);
      },
    });
    return result;
  });
  ipcMain.handle('bookstr-desktop-library-acquire-libgen', async (event, request) => {
    if (!isRecord(request) || !isRecord(request.book)) throw new Error('Invalid LibGen torrent acquisition request.');
    const bookId = String(request.book.md5 || '').trim().toLowerCase();
    if (/^[a-f0-9]{32}$/.test(bookId)) {
      try {
        await resolveRegisteredLibraryFile(bookId);
        const localReader = getLibraryStore().openReader(bookId);
        if (localReader?.token) {
          return {
            book: getLibraryStore().getBook(bookId),
            source: 'local',
            url: `${APP_ORIGIN}/api/library-file/${localReader.token}`,
          };
        }
      } catch {
        // Missing or changed local files fall through to a fresh torrent fetch.
      }
    }
    const result = await getAcquisitionManager().acquireLibgen(request.book, {
      autoSeed: request.autoSeed !== false,
      onProgress: payload => {
        if (!event.sender.isDestroyed()) event.sender.send('bookstr-desktop-acquisition-progress', payload);
      },
    });
    const reader = getLibraryStore().openReader(result.book.id);
    if (!reader?.token) throw new Error('Downloaded torrent book could not be opened.');
    return { ...result, url: `${APP_ORIGIN}/api/library-file/${reader.token}` };
  });
  ipcMain.handle('bookstr-desktop-device-status', () => getDevicePairing().status());
  ipcMain.handle('bookstr-desktop-device-registry', () => loadTrustedDeviceRegistry());
  ipcMain.handle('bookstr-desktop-device-announce', (_event, options) => getDevicePairing().announce(isRecord(options) ? options : {}));
  ipcMain.handle('bookstr-desktop-device-create-envelope', (_event, request) => {
    if (!isRecord(request) || !request.recipientPubkey || !isRecord(request.message)) throw new Error('Invalid device envelope request.');
    return getDevicePairing().createEnvelope(request.recipientPubkey, request.message, { ttl: request.ttl });
  });
  ipcMain.handle('bookstr-desktop-device-open-envelope', (_event, request) => {
    if (!isRecord(request) || !isRecord(request.wrapped) || !request.senderPubkey) throw new Error('Invalid device envelope response.');
    return getDevicePairing().openEnvelope(request.wrapped, { senderPubkey: request.senderPubkey });
  });
  ipcMain.handle('bookstr-desktop-device-set-registry-event', (_event, event) => {
    return ingestTrustedDeviceRegistryEvent(event);
  });
  ipcMain.handle('bookstr-desktop-library-downloads', () => getLibraryStore().downloads());
  ipcMain.handle('bookstr-desktop-library-set-download', (_event, download) => getLibraryStore().setDownload(download));
  ipcMain.handle('bookstr-desktop-library-linked-folders', () => getLibraryStore().linkedFolders());
  ipcMain.handle('bookstr-desktop-library-link-folder', (_event, folder) => getLibraryStore().linkFolder(folder));
  ipcMain.handle('bookstr-desktop-library-open-reader', (_event, bookId) => getLibraryStore().openReader(bookId));

  ipcMain.handle('bookstr-desktop-transfer-status', async () => {
    return getTorrentBridge().active();
  });
  ipcMain.handle('bookstr-desktop-transfer-preferences', async (_event, request) => {
    const current = await torrentPreferences();
    if (!isRecord(request)) return current;
    const next = {
      autoDownload: typeof request.autoDownload === 'boolean' ? request.autoDownload : current.autoDownload,
      autoSeed: typeof request.autoSeed === 'boolean' ? request.autoSeed : current.autoSeed,
      downloadLimit: request.downloadLimit === undefined ? current.downloadLimit : Number(request.downloadLimit),
      uploadLimit: request.uploadLimit === undefined ? current.uploadLimit : Number(request.uploadLimit),
    };
    const limits = await getTorrentBridge().setLimits(next);
    next.downloadLimit = limits.downloadLimit;
    next.uploadLimit = limits.uploadLimit;
    await saveState({ [TORRENT_PREFERENCES_STATE_KEY]: next });
    if (!next.autoSeed) await getTorrentBridge().stopSeeding();
    else void getAcquisitionManager().resumeLibgenSeeds({ autoSeed: true }).catch(error => {
      console.warn('Could not resume LibGen torrent seeding:', error);
    });
    return next;
  });
  ipcMain.handle('bookstr-desktop-transfer-seed-public', async (_event, request) => {
    if (!isRecord(request) || Object.keys(request).length !== 1 || typeof request.bookId !== 'string' || !request.bookId.trim()) {
      throw new Error('Public seed requests accept only a bookId.');
    }
    const { book, registration, filePath } = await resolveRegisteredLibraryFile(request.bookId);
    const storedDigest = normalizeHex(book.sha256);
    if (!storedDigest || book.public_seed_allowed !== true
      || !['public_domain', 'open_license'].includes(String(book.rights_status || '').toLowerCase())
      || String(book.redistribution || '').toLowerCase() !== 'allowed') {
      throw new Error('This edition is not eligible for public seeding.');
    }
    // Hash after resolving the registered path and immediately before handing
    // it to WebTorrent. Renderer-provided digest, size, and extension are not
    // part of this trust decision.
    const { sha256: digest, size } = await hashFile(filePath);
    if (digest !== storedDigest || (registration.sha256 && normalizeHex(registration.sha256) !== digest)) {
      throw new Error('Registered library file checksum does not match the stored edition.');
    }
    const fileExtension = path.extname(filePath).slice(1).toLowerCase();
    if (!['epub', 'pdf', 'fb2'].includes(fileExtension)) {
      throw new Error('Only EPUB, PDF, and FB2 files may be publicly seeded.');
    }
    const storedExtension = String(book.extension || '').trim().toLowerCase().replace(/^\./, '');
    if (storedExtension && storedExtension !== fileExtension) {
      throw new Error('Registered library file extension does not match the stored edition.');
    }
    const extension = safeExtension(fileExtension);
    const result = await getTorrentBridge().seedPublic(filePath, {
      sha256: digest,
      extension,
      size,
      publicSeedAllowed: true,
      bookId: book.id,
    });
    return result.summary || null;
  });
  ipcMain.handle('bookstr-desktop-transfer-add-public', async (_event, request) => {
    if (!isRecord(request) || !request.torrentId) throw new Error('Invalid public transfer request.');
    const downloadPath = request.path ? ensureLibraryPath(request.path) : '';
    if (request.path && !downloadPath) throw new Error('Download path must be inside the Bookstr library.');
    const torrent = await getTorrentBridge().addPublic(String(request.torrentId), { path: downloadPath || undefined });
    return { infoHash: String(torrent.infoHash || '') };
  });
  ipcMain.handle('bookstr-desktop-transfer-download-public', async (_event, request) => {
    if (!isRecord(request) || !request.torrentId || !request.bookId) {
      throw new Error('Invalid public torrent download request.');
    }
    if (isRecord(request.book)) {
      getLibraryStore().upsertBook({
        ...request.book,
        id: request.book.id || request.book.md5 || request.bookId,
        sha256: request.book.sha256 || request.sha256 || request.book.blossomSha256,
      });
    }
    const book = getLibraryStore().getBook(request.bookId);
    const digest = normalizeHex(request.sha256 || book?.sha256);
    if (!book || !digest || book.sha256.toLowerCase() !== digest) {
      throw new Error('Public torrent download requires a matching library book digest.');
    }
    const rawTorrentId = String(request.torrentId);
    const torrentId = /^magnet:|^https?:/i.test(rawTorrentId)
      ? rawTorrentId
      : Buffer.from(rawTorrentId, 'base64');
    const torrent = await getTorrentBridge().downloadPublic(torrentId, {
      path: libraryDataDir,
      bookId: book.id,
    });
    const file = Array.isArray(torrent.files) && torrent.files.length === 1 ? torrent.files[0] : null;
    const relativePath = libraryRelativePath(file?.path);
    if (!relativePath) throw new Error('Public torrent did not produce a safe library file.');
    const stat = await fs.stat(path.join(libraryDataDir, relativePath));
    if (!stat.isFile() || stat.size !== Number(book.filesize_bytes || stat.size)) {
      throw new Error('Downloaded torrent file size does not match the catalog.');
    }
    const fileDigest = crypto.createHash('sha256').update(await fs.readFile(path.join(libraryDataDir, relativePath)).then(bytes => bytes)).digest('hex');
    if (fileDigest !== digest) throw new Error('Downloaded torrent file SHA-256 does not match the catalog.');
    getLibraryStore().registerLibraryFile({ bookId: book.id, relativePath, size: stat.size, sha256: fileDigest });
    const reader = getLibraryStore().openReader(book.id);
    if (!reader?.token) throw new Error('Downloaded book could not be opened.');
    if (request.autoSeed === false) await getTorrentBridge().remove(torrent);
    return { url: `${APP_ORIGIN}/api/library-file/${reader.token}`, infoHash: String(torrent.infoHash || '') };
  });
  ipcMain.handle('bookstr-desktop-transfer-add-private', async (_event, request) => {
    if (!isRecord(request) || !request.torrentId) throw new Error('Invalid private transfer request.');
    const downloadPath = request.path ? ensureLibraryPath(request.path) : '';
    if (request.path && !downloadPath) throw new Error('Download path must be inside the Bookstr library.');
    // Private torrents have no public discovery. The peer address is supplied
    // by the authenticated device-transfer handoff and validated again by the
    // bridge before WebTorrent is allowed to connect.
    const torrent = await getTorrentBridge().addPrivate(String(request.torrentId), {
      path: downloadPath || undefined,
      peer: request.peer,
    });
    return { infoHash: String(torrent.infoHash || '') };
  });

  ipcMain.handle('bookstr-desktop-nostr-get-public-key', () => {
    return resolveNostrSignerPublicKey();
  });
  ipcMain.handle('bookstr-desktop-nostr-sign-event', (_event, event) => {
    const payload = normalizeNostrEventPayload(event);
    if (!payload) {
      throw new Error('Invalid Nostr event payload.');
    }
    return (async () => {
      if (await resolveNostrAuthMode() === 'nip46') {
        return (await resolveNip46Signer()).signEvent(payload);
      }
      const tools = await loadNostrTools();
      const secret = await resolveNostrSignerSecret();
      return tools.finalizeEvent(payload, hexToBytes(secret));
    })();
  });
  ipcMain.handle('bookstr-desktop-nostr-nip44-encrypt', (_event, request) => {
    const payload = normalizeNip44Payload(request);
    if (!payload) {
      throw new Error('Invalid NIP-44 encryption payload.');
    }
    return (async () => {
      if (await resolveNostrAuthMode() === 'nip46') {
        return (await resolveNip46Signer()).nip44Encrypt(payload.pubkey, payload.plaintext);
      }
      const tools = await loadNostrTools();
      const secret = await resolveNostrSignerSecret();
      return encryptWithNip44(tools, payload.plaintext, secret, payload.pubkey);
    })();
  });
  ipcMain.handle('bookstr-desktop-nostr-nip44-decrypt', (_event, request) => {
    const payload = normalizeNip44Payload(request);
    if (!payload || !payload.ciphertext) {
      throw new Error('Invalid NIP-44 decryption payload.');
    }
    return (async () => {
      if (await resolveNostrAuthMode() === 'nip46') {
        return (await resolveNip46Signer()).nip44Decrypt(payload.pubkey, payload.ciphertext);
      }
      const tools = await loadNostrTools();
      const secret = await resolveNostrSignerSecret();
      return decryptWithNip44(tools, payload.ciphertext, secret, payload.pubkey);
    })();
  });
  ipcMain.handle('bookstr-desktop-nostr-nip19-npub', (_event, _pubkey) => {
    const pubkey = normalizeHex(_pubkey);
    if (!pubkey) {
      throw new Error('Invalid pubkey.');
    }
    return (async () => {
      const tools = await loadNostrTools();
      return tools.nip19.npubEncode(pubkey);
    })();
  });
  ipcMain.handle('bookstr-desktop-signer-status', () => desktopSignerStatus());
  ipcMain.handle('bookstr-desktop-signer-connect-nip46', (_event, input) => configureNip46(input));
  ipcMain.handle('bookstr-desktop-signer-start-nip46-qr', () => startNip46QrSession());
  ipcMain.handle('bookstr-desktop-signer-nip46-qr-status', () => nip46QrSessionStatus());
  ipcMain.handle('bookstr-desktop-signer-cancel-nip46-qr', () => cancelNip46QrSession());
  ipcMain.handle('bookstr-desktop-signer-set-nsec', (_event, secret) => configureLocalNsec(secret));
  ipcMain.handle('bookstr-desktop-signer-disconnect', () => disconnectDesktopSigner());
}

function setupProtocol(targetSession) {
  targetSession.protocol.handle(APP_PROTOCOL, async (request) => {
    const parsed = new URL(request.url);
    const libraryCoverMatch = parsed.pathname.match(/^\/api\/library-cover\/([a-f0-9]{32}(?:[a-f0-9]{32})?)$/i);
    if (parsed.host === APP_HOST && libraryCoverMatch) {
      const bookId = safeCoverID(libraryCoverMatch[1]);
      try {
        const { filePath } = await resolveRegisteredLibraryFile(bookId);
        const cover = await localBookCover({
          bookId,
          bookPath: filePath,
          cacheDir: path.join(libraryDataDir, 'covers'),
        });
        if (!cover) return new Response('Not found', { status: 404 });
        return new Response(cover.bytes, {
          status: 200,
          headers: {
            'Content-Type': cover.mime,
            'Cache-Control': 'private, max-age=86400',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }
    const libraryFileMatch = parsed.pathname.match(/^\/api\/library-file\/([A-Za-z0-9_-]{32,})$/);
    if (parsed.host === APP_HOST && libraryFileMatch) {
      const entry = getLibraryStore().resolveReaderToken(libraryFileMatch[1]);
      if (!entry) return new Response('Not found', { status: 404 });
      const file = await fs.readFile(entry.path);
      return new Response(file, { headers: { 'Content-Type': MIME_TYPES.get(path.extname(entry.path).toLowerCase()) || 'application/octet-stream' } });
    }
    const catalogResponse = await proxyCatalogRequest(request, net.fetch);
    if (catalogResponse) return catalogResponse;
    if (parsed.host !== APP_HOST) {
      return new Response('Unknown host', { status: 404 });
    }
    const proxiedDictionary = await proxyDictionaryRequest(request, net.fetch, DICTIONARY_PROXY_BASE_URL);
    if (proxiedDictionary) return proxiedDictionary;
    const filePath = resolveFile(parsed.pathname);
    if (!filePath) {
      return new Response('Blocked', { status: 403 });
    }
    const file = await fs.readFile(filePath);
    const isHtml = path.extname(filePath).toLowerCase() === '.html';
    const nonce = isHtml ? crypto.randomBytes(16).toString('base64') : '';
    const body = isHtml ? nonceInlineScripts(file.toString('utf8'), nonce) : file;
    return new Response(body, {
      headers: {
        'Content-Type': mimeType(filePath),
        'Content-Security-Policy': appContentSecurityPolicy(nonce),
      },
      status: 200,
    });
  });
}

async function bootstrap() {
  protocol.registerSchemesAsPrivileged([{
    scheme: APP_PROTOCOL,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  }]);
  await app.whenReady();
  libraryDataDir = path.join(app.getPath('userData'), 'library');
  await fs.mkdir(path.join(libraryDataDir, 'torrents'), { recursive: true });
  if (process.platform === 'darwin') {
    app.dock.setIcon(APP_ICON_PATH);
  }
  if (process.platform === 'darwin') {
    app.dock.setIcon(APP_ICON_PATH);
  }
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('Safe storage unavailable; local desktop Nostr secrets cannot be persisted.');
  }
  setupProtocol(session.fromPartition(SESSION_PARTITION));
  setupIpcHandlers();
  setupApplicationMenu();
  if (!globalShortcut.register('CommandOrControl+,', () => openLibrarySettings())) {
    console.warn('Could not register the Settings keyboard shortcut.');
  }
  await createLibraryWindow();
  const preferences = await torrentPreferences();
  await getTorrentBridge().setLimits(preferences);
  void getAcquisitionManager().resumeLibgenSeeds({ autoSeed: preferences.autoSeed }).catch(error => {
    console.warn('Could not resume LibGen torrent transfers:', error);
  });
}

app.on('will-quit', () => {
  void torrentBridge?.stop();
  try { libraryStore?.close(); } catch { /* best effort during shutdown */ }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createLibraryWindow();
  }
});

void bootstrap();
