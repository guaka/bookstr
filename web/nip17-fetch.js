const LIBVAULT_NIP05 = 'books@blossom.bfr.ee';
const LIBVAULT_NIP05_URL = 'https://blossom.bfr.ee/.well-known/nostr.json?name=books';
const LIBVAULT_FETCH_TYPE = 'libvault.fetch';
const LIBVAULT_SEARCH_TYPE = 'libvault.search';
const LIBVAULT_SEARCH_RESPONSE_TYPE = 'libvault.search.result';
const DEFAULT_RELAY = 'wss://relay.nomadwiki.org';
const LIBVAULT_API = 'https://lib.b.bfr.ee/api';
const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;
const GIFT_WRAP_TTL_SECONDS = 10 * 60;

function validHex(value, length) {
  return new RegExp(`^[a-f0-9]{${length}}$`, 'i').test(String(value || ''));
}

function normalizeIsbn(value) {
  const isbn = String(value || '').replace(/[^0-9X]/gi, '').toUpperCase();
  return isbn.length === 10 || isbn.length === 13 ? isbn : '';
}

function randomPastTimestamp(nowSeconds = Math.floor(Date.now() / 1000)) {
  return Math.round(nowSeconds - Math.random() * TWO_DAYS_SECONDS);
}

function requestId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function eventHash(event) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is required for NIP-17');
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return bytesToHex(new Uint8Array(digest));
}

export function libvaultBookRef(book) {
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

export async function resolveLibVaultService(fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(LIBVAULT_NIP05_URL, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new Error(`Could not resolve ${LIBVAULT_NIP05}: ${error?.message || error}`, { cause: error });
  }
  if (!response.ok) throw new Error(`Could not resolve ${LIBVAULT_NIP05} (${response.status})`);
  const document = await response.json();
  const pubkey = String(document?.names?.books || '').toLowerCase();
  if (!validHex(pubkey, 64)) throw new Error(`${LIBVAULT_NIP05} has an invalid Nostr key`);
  const advertised = Array.isArray(document?.relays?.[pubkey]) ? document.relays[pubkey] : [];
  const relays = [...new Set(advertised
    .map(relay => String(relay).replace(/^wss:/i, 'wss:'))
    .filter(relay => /^wss:\/\//.test(relay)))];
  return { nip05: LIBVAULT_NIP05, pubkey, relays: relays.length ? relays : [DEFAULT_RELAY] };
}

export async function sendLibVaultFetchRequest(book, options = {}) {
  const signer = options.signer || globalThis.window?.nostr;
  if (!signer?.getPublicKey || !signer?.signEvent || !signer?.nip44?.encrypt) {
    throw new Error('NIP-07 with NIP-44 support is required');
  }
  const service = await resolveLibVaultService(options.fetchImpl || fetch);
  const senderPubkey = String(await signer.getPublicKey()).toLowerCase();
  if (!validHex(senderPubkey, 64)) throw new Error('The NIP-07 signer returned an invalid public key');

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

async function createPrivateRequestWrap(payload, id, service, senderPubkey, signer, tools) {
  const expiresAt = Math.floor(Date.now() / 1000) + GIFT_WRAP_TTL_SECONDS;
  const rumor = {
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

function hasTag(tags, name, value) {
  return Array.isArray(tags) && tags.some(tag => Array.isArray(tag) && tag[0] === name && tag[1] === value);
}

export async function unwrapLibVaultResponse(wrapped, service, senderPubkey, signer, tools) {
  if (!wrapped || wrapped.kind !== 1059 || !hasTag(wrapped.tags, 'p', senderPubkey) || !tools.verifyEvent(wrapped)) return null;
  const seal = JSON.parse(await signer.nip44.decrypt(wrapped.pubkey, wrapped.content));
  if (seal.kind !== 13 || seal.pubkey !== service.pubkey || !tools.verifyEvent(seal)) return null;
  const rumor = JSON.parse(await signer.nip44.decrypt(service.pubkey, seal.content));
  if (rumor.kind !== 14 || rumor.pubkey !== service.pubkey || !hasTag(rumor.tags, 'p', senderPubkey)) return null;
  if (rumor.id !== await eventHash(rumor)) return null;
  return JSON.parse(rumor.content);
}

function listenForSearchResponse(requestID, service, senderPubkey, signer, tools, options = {}) {
  const WebSocketImpl = options.WebSocketImpl !== undefined ? options.WebSocketImpl : globalThis.WebSocket;
  if (typeof WebSocketImpl !== 'function') throw new Error('WebSocket support is required for private search');
  const sockets = [];
  const pendingPackets = [];
  let armed = false;
  let settled = false;
  let readyResolved = false;
  let readyResolve, readyReject, resultResolve, resultReject, resultTimer;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const result = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  const subscription = `bookstr-search-${requestID.slice(0, 16)}`;
  let unavailable = service.relays.length;

  const handlePacket = (packet, relay) => {
    if (settled) return;
    void unwrapLibVaultResponse(packet[2], service, senderPubkey, signer, tools).then(response => {
      if (!response || response.type !== LIBVAULT_SEARCH_RESPONSE_TYPE || response.request_id !== requestID || settled) return;
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
      let packet;
      try { packet = JSON.parse(message.data); } catch { return; }
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
    if (!readyResolved) readyReject(new Error('Private LibVault search relay timed out'));
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
        resultReject(new Error('Private LibVault search response timed out'));
        close();
      }, options.responseTimeoutMs || 20000);
    },
    close,
  };
}

export async function searchLibVault(query, searchType = 'all', options = {}) {
  const signer = options.signer || globalThis.window?.nostr;
  if (!signer?.getPublicKey || !signer?.signEvent || !signer?.nip44?.encrypt || !signer?.nip44?.decrypt) {
    throw new Error('NIP-07 with NIP-44 support is required');
  }
  const publish = options.publish;
  if (typeof publish !== 'function' && !options.listen) throw new Error('No Nostr relay publisher is available');
  const service = await resolveLibVaultService(options.fetchImpl || fetch);
  const senderPubkey = String(await signer.getPublicKey()).toLowerCase();
  if (!validHex(senderPubkey, 64)) throw new Error('The NIP-07 signer returned an invalid public key');
  const tools = await (options.loadTools || (() => import('./vendor/nostr-tools.js')))();
  const id = requestId();
  let receivedTraced = false;
  const trace = detail => {
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
    let responseTimer;
    const response = await Promise.race([
      resultPromise,
      new Promise((_, reject) => {
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
    if (response.status !== 'ready') throw new Error(response.error || 'Private LibVault search failed');
    return response;
  } finally {
    listener.close();
  }
}

function wait(milliseconds, signal) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function monitorLibVaultFetch(md5, options = {}) {
  const normalized = String(md5 || '').toLowerCase();
  if (!validHex(normalized, 32)) throw new Error('A LibVault MD5 is required to monitor a fetch');
  const fetchImpl = options.fetchImpl || fetch;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const signal = options.signal;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 2000;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 3 * 60 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';

  const report = progress => {
    const fingerprint = JSON.stringify(progress);
    if (fingerprint !== lastStatus) {
      lastStatus = fingerprint;
      onProgress(progress);
    }
  };

  report({ status: 'waiting' });
  while (!signal?.aborted && Date.now() < deadline) {
    try {
      const jobResponse = await fetchImpl(`${LIBVAULT_API}/jobs?md5=${normalized}`, { headers: { Accept: 'application/json' }, signal });
      if (jobResponse.ok) {
        const job = await jobResponse.json();
        if (job.status === 'failed') {
          const result = { status: 'failed', error: job.error || 'LibVault could not fetch this book' };
          report(result);
          return result;
        }
        if (job.status === 'ready') {
          const blossomResponse = await fetchImpl(`${LIBVAULT_API}/blossom/${normalized}`, { headers: { Accept: 'application/json' }, signal });
          if (blossomResponse.ok) {
            const blossom = await blossomResponse.json();
            if (blossom.status === 'ready' && validHex(blossom.sha256, 64) && /^https:\/\//i.test(String(blossom.url || ''))) {
              const result = { status: 'ready', blossom };
              report(result);
              return result;
            }
          }
          report({ status: 'publishing' });
        } else {
          report({
            status: job.status || 'queued',
            bytes: Number(job.bytes || 0),
            total: Number(job.total || 0),
            source: String(job.source || ''),
          });
        }
      }
    } catch (error) {
      if (signal?.aborted) return { status: 'cancelled' };
      report({ status: 'waiting', error: error?.message || String(error) });
    }
    await wait(intervalMs, signal);
  }
  if (signal?.aborted) return { status: 'cancelled' };
  const result = { status: 'failed', error: 'Timed out waiting for LibVault' };
  report(result);
  return result;
}

export async function lookupLibVaultBlossomState(md5, fetchImpl = fetch) {
  const normalized = String(md5 || '').toLowerCase();
  if (!validHex(normalized, 32)) return null;
  const response = await fetchImpl(`${LIBVAULT_API}/blossom/${normalized}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  return response.json();
}

export async function lookupLibVaultBlossom(md5, fetchImpl = fetch) {
  const blossom = await lookupLibVaultBlossomState(md5, fetchImpl);
  if (!blossom) return null;
  if (blossom.status !== 'ready' || !validHex(blossom.sha256, 64) || !/^https:\/\//i.test(String(blossom.url || ''))) return null;
  return blossom;
}

export {
  LIBVAULT_API, LIBVAULT_NIP05, LIBVAULT_NIP05_URL, LIBVAULT_FETCH_TYPE,
  LIBVAULT_SEARCH_TYPE, LIBVAULT_SEARCH_RESPONSE_TYPE,
};
