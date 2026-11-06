type CatalogService = { nip05?: string; pubkey: string; relays: readonly string[] };
type BookRecord = Record<string, unknown>;
type TraceHandler = (detail: Record<string, unknown>) => void;
type RelayPublisher = (relay: string, event: MigratedNostrEvent) => Promise<boolean> | boolean;
type ResponseListener = { ready: Promise<void>; result: Promise<Record<string, unknown>>; arm(): void; close(): void };
type ListenerArguments = {
  requestID: string;
  service: CatalogService;
  senderPubkey: string;
  signer: MigratedNostrSigner;
  tools: MigratedNostrTools;
  onTrace?: TraceHandler;
};
type LibVaultOptions = {
  signer?: MigratedNostrSigner;
  fetchImpl?: typeof fetch;
  service?: CatalogService;
  loadTools?: () => Promise<MigratedNostrTools>;
  publish?: RelayPublisher;
  listen?: (options: ListenerArguments) => ResponseListener;
  onTrace?: TraceHandler;
  WebSocketImpl?: new(url: string) => RelaySocket;
  readyTimeoutMs?: number;
  responseTimeoutMs?: number;
  offset?: number;
  formats?: string[];
  languages?: string[];
  limit?: number | string;
};
type RelaySocket = {
  addEventListener(type: 'open', callback: () => void): void;
  addEventListener(type: 'message', callback: (message: MessageEvent<string>) => void): void;
  addEventListener(type: 'error', callback: () => void, options?: { once?: boolean }): void;
  send(message: string): void;
  close(): void;
};
type RelayPacket = unknown[];

export const LIBCAT_SERVICE = Object.freeze({
  nip05: 'Libcat', pubkey: '83503e3e82744479362b04881a8f240bd6d838b78430035868f1c0826ec3876f',
  relays: Object.freeze(['wss://relay.nomadwiki.org']),
});

function configuredCatalogService(service: CatalogService): CatalogService {
  if (!service || !validHex(service.pubkey, 64) || !Array.isArray(service.relays) || !service.relays.length ||
      service.relays.some((relay: string) => typeof relay !== 'string' || !/^wss:\/\/[^\s]+$/.test(relay))) {
    throw new Error('Invalid Libcat service configuration');
  }
  return { nip05: 'Libcat', pubkey: service.pubkey.toLowerCase(), relays: [...new Set(service.relays)] };
}

export async function searchLibcat(query: string, searchType = 'all', options: LibVaultOptions = {}): Promise<Record<string, unknown>> {
  return searchLibVault(query, searchType, { ...options, limit: options.limit ?? 50, service: options.service || (await globalThis.window?.bookstrDesktop?.catalog?.get() as CatalogService | undefined) || LIBCAT_SERVICE });
}

export async function resolveLibcatBook(book: BookRecord, options: LibVaultOptions = {}): Promise<BookRecord> {
  return resolveLibVaultBook(book, { ...options, service: options.service || (await globalThis.window?.bookstrDesktop?.catalog?.get() as CatalogService | undefined) || LIBCAT_SERVICE });
}

const LIBVAULT_NIP05 = 'books@blossom.bfr.ee';
const LIBVAULT_NIP05_URL = 'https://blossom.bfr.ee/.well-known/nostr.json?name=books';
const LIBVAULT_FETCH_TYPE = 'libvault.fetch';
const LIBVAULT_RESOLVE_TYPE = 'libvault.resolve';
const LIBVAULT_RESOLVE_RESPONSE_TYPE = 'libvault.resolve.result';
const LIBVAULT_SEARCH_TYPE = 'libvault.search';
const LIBVAULT_SEARCH_RESPONSE_TYPE = 'libvault.search.result';
const LIBVAULT_FAVORITES_TYPE = 'libvault.favorites.sync';
const DEFAULT_RELAY = 'wss://relay.nomadwiki.org';
const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;
const GIFT_WRAP_TTL_SECONDS = 10 * 60;

function validHex(value: unknown, length: number): boolean {
  return new RegExp(`^[a-f0-9]{${length}}$`, 'i').test(String(value || ''));
}

function normalizeIsbn(value: unknown): string {
  const isbn = String(value || '').replace(/[^0-9X]/gi, '').toUpperCase();
  return isbn.length === 10 || isbn.length === 13 ? isbn : '';
}

function randomPastTimestamp(nowSeconds = Math.floor(Date.now() / 1000)): number {
  return Math.round(nowSeconds - Math.random() * TWO_DAYS_SECONDS);
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function eventHash(event: MigratedNostrEvent): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is required for NIP-17');
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return bytesToHex(new Uint8Array(digest));
}

export function libvaultBookRef(book: BookRecord): Record<string, unknown> {
  const md5 = String(book?.md5 || '').toLowerCase();
  const isbn = normalizeIsbn(book?.isbn);
  return {
    ...(validHex(md5, 32) ? { md5 } : {}),
    ...(isbn ? { isbn } : {}),
    title: String(book?.title || '').trim(),
    author: String(book?.authors || book?.author || '').trim(),
    source: String(book?.source || '').trim(),
    source_id: String(book?.sourceNativeId || book?.source_native_id || book?.sourceId || '').trim(),
    url: String(book?.sourceUrl || book?.catalogUrl || '').trim(),
  };
}

export async function resolveLibVaultService(fetchImpl: typeof fetch = fetch): Promise<CatalogService> {
  let response: Response;
  try {
    response = await fetchImpl(LIBVAULT_NIP05_URL, { headers: { Accept: 'application/json' } });
  } catch (error) {
    const detail = error as { message?: unknown } | null | undefined;
    throw new Error(`Could not resolve ${LIBVAULT_NIP05}: ${detail?.message || error}`, { cause: error });
  }
  if (!response.ok) throw new Error(`Could not resolve ${LIBVAULT_NIP05} (${response.status})`);
  const document: { names?: Record<string, unknown>; relays?: Record<string, unknown> } = await response.json();
  const pubkey = String(document?.names?.books || '').toLowerCase();
  if (!validHex(pubkey, 64)) throw new Error(`${LIBVAULT_NIP05} has an invalid Nostr key`);
  const advertised = Array.isArray(document?.relays?.[pubkey]) ? document.relays[pubkey] : [];
  const relays = [...new Set(advertised
    .map((relay: unknown) => String(relay).replace(/^wss:/i, 'wss:'))
    .filter((relay: string) => /^wss:\/\//.test(relay)))];
  return { nip05: LIBVAULT_NIP05, pubkey, relays: relays.length ? relays : [DEFAULT_RELAY] };
}

export async function sendLibVaultFetchRequest(book: BookRecord, options: LibVaultOptions = {}) {
  const signer = options.signer || globalThis.window?.nostr;
  if (!signer?.getPublicKey || !signer?.signEvent || !signer?.nip44?.encrypt) {
    throw new Error('A Nostr signer with NIP-44 support is required');
  }
  const service = await resolveLibVaultService(options.fetchImpl || fetch);
  const senderPubkey = String(await signer.getPublicKey()).toLowerCase();
  if (!validHex(senderPubkey, 64)) throw new Error('The Nostr signer returned an invalid public key');

  const id = requestId();
  const tools = await (options.loadTools || (() => import('./vendor/nostr-tools.js')))();
  const wrap = await createPrivateRequestWrap(
    { type: LIBVAULT_FETCH_TYPE, request_id: id, book: libvaultBookRef(book) },
    id, service, senderPubkey, signer, tools,
  );

  const publish = options.publish;
  if (typeof publish !== 'function') throw new Error('No Nostr relay publisher is available');
  const accepted = await Promise.all(service.relays.map(relay => publish(relay, wrap)));
  if (!accepted.some(Boolean)) throw new Error('No relay accepted the private LibVault fetch request');
  return { requestId: id, service, wrap };
}

export async function sendLibVaultFavoritesSync(favorites: unknown, options: LibVaultOptions = {}) {
  const signer = options.signer || globalThis.window?.nostr;
  if (!signer?.getPublicKey || !signer?.signEvent || !signer?.nip44?.encrypt) {
    throw new Error('A Nostr signer with NIP-44 support is required');
  }
  const md5s = [...new Set((Array.isArray(favorites) ? favorites : [])
    .map(item => String(item?.md5 || item || '').toLowerCase())
    .filter(md5 => validHex(md5, 32)))];
  if (md5s.length > 5000) throw new Error('Too many favorites to sync with LibVault');
  const service = await resolveLibVaultService(options.fetchImpl || fetch);
  const senderPubkey = String(await signer.getPublicKey()).toLowerCase();
  if (!validHex(senderPubkey, 64)) throw new Error('The Nostr signer returned an invalid public key');
  const id = requestId();
  const tools = await (options.loadTools || (() => import('./vendor/nostr-tools.js')))();
  const wrap = await createPrivateRequestWrap({
    type: LIBVAULT_FAVORITES_TYPE,
    request_id: id,
    favorites: md5s,
  }, id, service, senderPubkey, signer, tools);
  if (typeof options.publish !== 'function') throw new Error('No Nostr relay publisher is available');
  const accepted = await Promise.all(service.relays.map(relay => (options.publish as RelayPublisher)(relay, wrap)));
  if (!accepted.some(Boolean)) throw new Error('No relay accepted the private favorites sync');
  return { requestId: id, service, wrap };
}

async function createPrivateRequestWrap(payload: Record<string, unknown>, _id: string, service: CatalogService, senderPubkey: string, signer: MigratedNostrSigner, tools: MigratedNostrTools): Promise<MigratedNostrEvent> {
  const expiresAt = Math.floor(Date.now() / 1000) + GIFT_WRAP_TTL_SECONDS;
  const rumor: MigratedNostrEvent = {
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 14,
    tags: [['p', service.pubkey]],
    content: JSON.stringify(payload),
  };
  rumor.id = await eventHash(rumor);

  const seal = await signer.signEvent({
    kind: 13,
    created_at: randomPastTimestamp(),
    tags: [],
    content: await signer.nip44.encrypt(service.pubkey, JSON.stringify(rumor)),
  });

  const ephemeralKey = tools.generateSecretKey();
  const conversationKey = tools.nip44.v2.utils.getConversationKey(ephemeralKey, service.pubkey);
  return tools.finalizeEvent({
    kind: 1059,
    created_at: randomPastTimestamp(),
    tags: [['p', service.pubkey], ['expiration', String(expiresAt)]],
    content: tools.nip44.v2.encrypt(JSON.stringify(seal), conversationKey),
  }, ephemeralKey);

}

function hasTag(tags: unknown, name: string, value: string): boolean {
  return Array.isArray(tags) && tags.some(tag => Array.isArray(tag) && tag[0] === name && tag[1] === value);
}

export async function unwrapLibVaultResponse(wrapped: MigratedNostrEvent & { pubkey: string }, service: CatalogService, senderPubkey: string, signer: MigratedNostrSigner, tools: MigratedNostrTools): Promise<Record<string, unknown> | null> {
  if (!wrapped || wrapped.kind !== 1059 || !hasTag(wrapped.tags, 'p', senderPubkey) || !tools.verifyEvent(wrapped)) return null;
  const seal = JSON.parse(await signer.nip44.decrypt(wrapped.pubkey, wrapped.content));
  if (seal.kind !== 13 || seal.pubkey !== service.pubkey || !tools.verifyEvent(seal)) return null;
  const rumor = JSON.parse(await signer.nip44.decrypt(service.pubkey, seal.content));
  if (rumor.kind !== 14 || rumor.pubkey !== service.pubkey || !hasTag(rumor.tags, 'p', senderPubkey)) return null;
  if (rumor.id !== await eventHash(rumor)) return null;
  return JSON.parse(rumor.content);
}

function listenForSearchResponse(requestID: string, service: CatalogService, senderPubkey: string, signer: MigratedNostrSigner, tools: MigratedNostrTools, options: LibVaultOptions = {}): ResponseListener {
  return listenForResponse(requestID, service, senderPubkey, signer, tools, {
    ...options,
    responseType: LIBVAULT_SEARCH_RESPONSE_TYPE,
    operation: 'search',
  });
}

function listenForResolveResponse(requestID: string, service: CatalogService, senderPubkey: string, signer: MigratedNostrSigner, tools: MigratedNostrTools, options: LibVaultOptions = {}): ResponseListener {
  return listenForResponse(requestID, service, senderPubkey, signer, tools, {
    ...options,
    responseType: LIBVAULT_RESOLVE_RESPONSE_TYPE,
    operation: 'resolve',
  });
}

function listenForResponse(requestID: string, service: CatalogService, senderPubkey: string, signer: MigratedNostrSigner, tools: MigratedNostrTools, options: LibVaultOptions & { responseType: string; operation: string } ): ResponseListener {
  const WebSocketImpl = (options.WebSocketImpl !== undefined ? options.WebSocketImpl : globalThis.WebSocket) as new(url: string) => RelaySocket;
  if (typeof WebSocketImpl !== 'function') {
    throw new Error(`WebSocket support is required for private ${options.operation || 'request'}`);
  }
  const sockets: RelaySocket[] = [];
  const pendingPackets: Array<[RelayPacket, string]> = [];
  let armed = false;
  let settled = false;
  let readyResolved = false;
  let readyResolve!: () => void;
  let readyReject!: (reason?: unknown) => void;
  let resultResolve!: (value: Record<string, unknown>) => void;
  let resultReject!: (reason?: unknown) => void;
  let resultTimer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const result = new Promise<Record<string, unknown>>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  const subscription = `bookstr-search-${requestID.slice(0, 16)}`;
  let unavailable = service.relays.length;

  const handlePacket = (packet: RelayPacket, relay: string) => {
    if (settled) return;
    void unwrapLibVaultResponse(packet[2] as MigratedNostrEvent & { pubkey: string }, service, senderPubkey, signer, tools).then(response => {
      if (!response || response.type !== options.responseType || response.request_id !== requestID || settled) return;
      settled = true;
      options.onTrace?.({ direction: 'received', relay, event: packet[2], payload: response });
      resultResolve(response);
      close();
    }).catch(() => {});
  };
  const flushPending = () => {
    if (!armed || !readyResolved) return;
    for (const [packet, relay] of pendingPackets.splice(0)) handlePacket(packet, relay);
  };

  const close = () => {
    clearTimeout(resultTimer);
    for (const socket of sockets) {
      try { socket.send(JSON.stringify(['CLOSE', subscription])); } catch {}
      try { socket.close(); } catch {}
    }
  };
  const failReady = () => {
    unavailable -= 1;
    if (!readyResolved && unavailable <= 0) readyReject(new Error('Could not subscribe for a private LibVault response'));
  };
  for (const relay of service.relays) {
    let live = false;
    const socket = new WebSocketImpl(relay);
    sockets.push(socket);
    socket.addEventListener('open', () => socket.send(JSON.stringify(['REQ', subscription, {
      kinds: [1059], '#p': [senderPubkey], limit: 1,
    }])));
    socket.addEventListener('message', message => {
      let packet: RelayPacket;
      try { packet = JSON.parse(message.data) as RelayPacket; } catch { return; }
      if (packet?.[0] === 'EOSE' && packet[1] === subscription) {
        live = true;
        if (!readyResolved) {
          readyResolved = true;
          readyResolve();
        }
        flushPending();
        return;
      }
      if (settled || packet?.[0] !== 'EVENT' || packet[1] !== subscription) return;
      if (!armed || !live) pendingPackets.push([packet, relay]);
      else handlePacket(packet, relay);
    });
    socket.addEventListener('error', failReady, { once: true });
  }
  const readyTimer = setTimeout(() => {
    if (!readyResolved) readyReject(new Error(`Private LibVault ${options.operation} relay timed out`));
  }, options.readyTimeoutMs || 8000);
  ready.finally(() => clearTimeout(readyTimer)).catch(() => {});
  return {
    ready,
    result,
    arm() {
      armed = true;
      flushPending();
      resultTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resultReject(new Error(`Private LibVault ${options.operation} response timed out`));
        close();
      }, options.responseTimeoutMs || 20000);
    },
    close,
  };
}

export async function resolveLibVaultBook(book: BookRecord, options: LibVaultOptions = {}): Promise<BookRecord> {
  const signer = options.signer || globalThis.window?.nostr;
  if (!signer?.getPublicKey || !signer?.signEvent || !signer?.nip44?.encrypt || !signer?.nip44?.decrypt) {
    throw new Error('A Nostr signer with NIP-44 support is required');
  }
  const publish = options.publish;
  if (typeof publish !== 'function' && !options.listen) throw new Error('No Nostr relay publisher is available');
  const service = options.service ? configuredCatalogService(options.service) : await resolveLibVaultService(options.fetchImpl || fetch);
  const senderPubkey = String(await signer.getPublicKey()).toLowerCase();
  if (!validHex(senderPubkey, 64)) throw new Error('The Nostr signer returned an invalid public key');
  const tools = await (options.loadTools || (() => import('./vendor/nostr-tools.js')))();
  const id = requestId();
  const listener = options.listen
    ? options.listen({ requestID: id, service, senderPubkey, signer, tools, onTrace: options.onTrace })
    : listenForResolveResponse(id, service, senderPubkey, signer, tools, options);
  const resultPromise = Promise.resolve(listener.result);
  resultPromise.catch(() => {});
  try {
    await listener.ready;
    if (typeof publish !== 'function') throw new Error('No Nostr relay publisher is available');
    const payload = { type: LIBVAULT_RESOLVE_TYPE, request_id: id, book: libvaultBookRef(book) };
    const wrap = await createPrivateRequestWrap(payload, id, service, senderPubkey, signer, tools);
    const recipient = tools.nip19?.npubEncode?.(service.pubkey) || service.pubkey;
    try { options.onTrace?.({ direction: 'sent', recipient, recipientNip05: service.nip05, relays: service.relays, event: wrap, payload }); } catch {}
    listener.arm();
    const accepted = await Promise.all(service.relays.map(relay => publish(relay, wrap)));
    if (!accepted.some(Boolean)) throw new Error('No relay accepted the private LibVault resolve request');
    const response = await resultPromise;
    if (response?.type !== LIBVAULT_RESOLVE_RESPONSE_TYPE || response?.request_id !== id) {
      throw new Error('Private LibVault resolve response was invalid');
    }
    if (response.status !== 'ready') throw new Error((response.error || 'Private LibVault resolve failed') as string);
    const resolved = response.book as BookRecord;
    const resolvedMD5 = String(resolved?.md5 || '').toLowerCase();
    const libgenId = Number(resolved?.id || resolved?.libgen_id || 0);
    if (!validHex(resolvedMD5, 32) || !Number.isSafeInteger(libgenId) || libgenId <= 0) {
      throw new Error('LibVault did not return usable LibGen torrent metadata');
    }
    return resolved;
  } finally {
    listener.close();
  }
}

export async function searchLibVault(query: string, searchType = 'all', options: LibVaultOptions = {}): Promise<Record<string, unknown>> {
  const signer = options.signer || globalThis.window?.nostr;
  if (!signer?.getPublicKey || !signer?.signEvent || !signer?.nip44?.encrypt || !signer?.nip44?.decrypt) {
    throw new Error('A Nostr signer with NIP-44 support is required');
  }
  const publish = options.publish;
  if (typeof publish !== 'function' && !options.listen) throw new Error('No Nostr relay publisher is available');
  const service = options.service ? configuredCatalogService(options.service) : await resolveLibVaultService(options.fetchImpl || fetch);
  const senderPubkey = String(await signer.getPublicKey()).toLowerCase();
  if (!validHex(senderPubkey, 64)) throw new Error('The Nostr signer returned an invalid public key');
  const tools = await (options.loadTools || (() => import('./vendor/nostr-tools.js')))();
  const id = requestId();
  let receivedTraced = false;
  const trace: TraceHandler = detail => {
    if (detail?.direction === 'received') receivedTraced = true;
    try { options.onTrace?.(detail); } catch {}
  };
  const listener = options.listen
    ? options.listen({ requestID: id, service, senderPubkey, signer, tools, onTrace: trace })
    : listenForSearchResponse(id, service, senderPubkey, signer, tools, { ...options, onTrace: trace });
  const resultPromise = Promise.resolve(listener.result);
  resultPromise.catch(() => {});
  try {
    await listener.ready;
    if (typeof publish !== 'function') throw new Error('No Nostr relay publisher is available');
    const payload = {
      type: LIBVAULT_SEARCH_TYPE,
      request_id: id,
      query: String(query || '').trim(),
      search_type: String(searchType || 'all').toLowerCase(),
      ...(options.service || options.offset !== undefined ? { offset: Number.isSafeInteger(options.offset) && options.offset! >= 0 ? options.offset : 0 } : {}),
      ...(Array.isArray(options.formats) ? { formats: options.formats } : {}),
      ...(Array.isArray(options.languages) ? { languages: options.languages } : {}),
      limit: Number.isFinite(Number(options.limit)) && options.limit !== '' && options.limit != null
        ? Math.min(200, Math.max(1, Number(options.limit)))
        : 200,
    };
    const wrap = await createPrivateRequestWrap(payload, id, service, senderPubkey, signer, tools);
    const recipient = tools.nip19?.npubEncode?.(service.pubkey) || service.pubkey;
    trace({ direction: 'sent', recipient, recipientNip05: service.nip05, relays: service.relays, event: wrap, payload });
    listener.arm();
    const accepted = await Promise.all(service.relays.map(relay => publish(relay, wrap)));
    if (!accepted.some(Boolean)) throw new Error('No relay accepted the private LibVault search');
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      resultPromise,
      new Promise<Record<string, unknown>>((_, reject) => {
        responseTimer = setTimeout(
          () => reject(new Error('Private LibVault search response timed out')),
          options.responseTimeoutMs || 20000,
        );
      }),
    ]).finally(() => clearTimeout(responseTimer));
    if (response?.type !== LIBVAULT_SEARCH_RESPONSE_TYPE || (response?.request_id && response.request_id !== id)) {
      throw new Error('Private LibVault search response timed out');
    }
    if (!receivedTraced) trace({ direction: 'received', payload: response });
    if (response.status !== 'ready') throw new Error((response.error || 'Private LibVault search failed') as string);
    return response;
  } finally {
    listener.close();
  }
}

export {
  LIBVAULT_NIP05, LIBVAULT_NIP05_URL, LIBVAULT_FETCH_TYPE,
  LIBVAULT_RESOLVE_TYPE, LIBVAULT_RESOLVE_RESPONSE_TYPE,
  LIBVAULT_SEARCH_TYPE, LIBVAULT_SEARCH_RESPONSE_TYPE, LIBVAULT_FAVORITES_TYPE,
};
