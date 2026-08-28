const {
  app,
  BrowserWindow,
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
const { proxyBlossomRequest } = require('./blossom-proxy');
const { proxyCatalogRequest } = require('./catalog-proxy');
const { proxyDictionaryRequest } = require('./dictionary-proxy');
const { appContentSecurityPolicy } = require('./security-policy');

const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const WEB_ROOT = path.join(__dirname, '..', 'web');
const APP_ICON_PATH = process.platform === 'darwin'
  ? path.join(__dirname, 'assets', 'icon-macos.png')
  : path.join(WEB_ROOT, 'public', 'apple-touch-icon.png');
const STATE_FILE = path.join(app.getPath('userData'), 'bookstr-desktop-state.json');
const DESKTOP_NOSTR_STATE_KEY = 'desktopNostr';
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
  'sign_event:24242',
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
];
const DICTIONARY_PROXY_BASE_URL = process.env.NODE_ENV === 'test'
  ? process.env.BOOKSTR_DESKTOP_TEST_DICTIONARY_BASE_URL
  : undefined;
const BLOSSOM_PROXY_BASE_URL = process.env.NODE_ENV === 'test'
  ? process.env.BOOKSTR_DESKTOP_TEST_BLOSSOM_BASE_URL
  : undefined;

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
const readerWindows = new Map();
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

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
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
  await signer.connect({ name: 'Bookstr Desktop', url: 'https://github.com/guaka/bookstr' });
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
    name: 'Bookstr Desktop',
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
    title: 'Bookstr',
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
  mainWindow.once('ready-to-show', () => mainWindow.show());
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
  webContents.on('will-navigate', (event, url) => {
    if (isLocalBookstrUrl(url)) return;
    event.preventDefault();
    if (!isExternalUrlAllowed(url)) return;
    void shell.openExternal(url);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalBookstrUrl(url)) {
      return { action: 'allow' };
    }
    if (!isExternalUrlAllowed(url)) {
      return { action: 'deny' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createReaderWindow(kind) {
  const window = new BrowserWindow({
    width: 1180,
    height: 860,
    title: 'Bookstr Reader',
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
  attachSecurity(window.webContents);

  if (kind === 'pdf') {
    void window.loadURL(`${APP_ORIGIN}/pdf-reader.html`);
  } else {
    void window.loadURL(`${APP_ORIGIN}/reader.html`);
  }
  window.once('ready-to-show', () => window.show());
  return window;
}

function ensureReaderWindowForPayload(payload) {
  const normalized = normalizePayload(payload);
  if (!normalized?.ok) {
    return normalized;
  }
  const requestedKind = normalized.kind;
  const key = normalizeReaderKey(normalized);
  const existing = readerWindows.get(key);
  if (existing && existing.isDestroyed()) {
    readerWindows.delete(key);
  }
  const reusable = existing && !existing.isDestroyed();
  if (reusable) {
    existing.webContents.send('bookstr-desktop-open-reader', normalized);
    existing.focus();
    return { ok: true, key, reused: true, kind: requestedKind };
  }

  const readerWindow = createReaderWindow(requestedKind);
  readerWindows.set(key, readerWindow);
  readerWindow.webContents.on('did-finish-load', () => {
    readerWindow.webContents.send('bookstr-desktop-open-reader', normalized);
  });
  readerWindow.on('closed', () => {
    readerWindows.delete(key);
  });
  readerWindow.focus();
  return { ok: true, key, reused: false, kind: requestedKind };
}

function isBase64Safe(value) {
  return typeof value === 'string' && value.length > 64;
}

function clampProgress(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(1, numericValue));
}

function normalizeProgressPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const md5 = String(payload.md5 || payload.bookId || '').trim().toLowerCase();
  if (!md5) {
    return null;
  }
  return {
    md5,
    readUrl: String(payload.readUrl || ''),
    progression: clampProgress(payload.progression),
    furthestProgression: clampProgress(payload.furthestProgression),
    cfi: String(payload.cfi || ''),
    title: String(payload.title || ''),
    authors: String(payload.authors || ''),
    year: String(payload.year || ''),
    extension: String(payload.extension || 'epub'),
    language: String(payload.language || ''),
    source: String(payload.source || ''),
    sourceNativeId: String(payload.sourceNativeId || ''),
    sourceUrl: String(payload.sourceUrl || ''),
    blossomUrl: String(payload.blossomUrl || ''),
    blossomSha256: String(payload.blossomSha256 || ''),
	rights_status: String(payload.rights_status || payload.rightsStatus || 'unknown'),
	license: String(payload.license || payload.rights || ''),
	license_url: String(payload.license_url || payload.licenseUrl || ''),
	rights_source: String(payload.rights_source || payload.rightsSource || ''),
  };
}

function focusLibraryWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  return true;
}

function openLibrarySettings() {
  if (!focusLibraryWindow()) return false;
  mainWindow.webContents.send('bookstr-desktop-open-settings');
  return true;
}

function openLibraryPane(pane) {
  if (!focusLibraryWindow()) return false;
  mainWindow.webContents.send('bookstr-desktop-open-pane', pane);
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
      label: 'Bookstr',
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
    const safe = normalizeProgressPayload(payload);
    if (!safe || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send('bookstr-desktop-reader-progress', safe);
  });

  ipcMain.handle('bookstr-desktop-focus-library', () => {
    return focusLibraryWindow();
  });

  ipcMain.handle('bookstr-desktop-open-external', (_event, url) => {
    if (typeof url !== 'string' || !isExternalUrlAllowed(url)) {
      return false;
    }
    return shell.openExternal(url);
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
    const blossomResponse = await proxyBlossomRequest(request, net.fetch, BLOSSOM_PROXY_BASE_URL);
    if (blossomResponse) return blossomResponse;
    const catalogResponse = await proxyCatalogRequest(request, net.fetch);
    if (catalogResponse) return catalogResponse;
    const parsed = new URL(request.url);
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
  await createLibraryWindow();
}

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
