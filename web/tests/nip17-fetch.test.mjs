import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIBVAULT_FETCH_TYPE,
  LIBVAULT_NIP05,
  LIBVAULT_SEARCH_RESPONSE_TYPE,
  libvaultBookRef,
  lookupLibVaultBlossom,
  lookupLibVaultBlossomState,
  monitorLibVaultFetch,
  resolveLibVaultService,
  sendLibVaultFetchRequest,
  searchLibVault,
  unwrapLibVaultResponse,
} from '../nip17-fetch.js';
import * as nostrTools from '../vendor/nostr-tools.js';

const servicePubkey = '8'.repeat(64);
const senderPubkey = '7'.repeat(64);

function discoveryResponse() {
  return {
    ok: true,
    json: async () => ({
      names: { books: servicePubkey },
      relays: { [servicePubkey]: ['wss://relay.example', 'https://not-a-relay.example'] },
    }),
  };
}

test('builds the portable LibVault book reference', () => {
  assert.deepEqual(libvaultBookRef({
    md5: 'A'.repeat(32),
    isbn: '978-1-2345-6789-0',
    title: 'Example',
    authors: 'Ada Author',
    source: 'openlibrary',
    sourceNativeId: 'OL1W',
    catalogUrl: 'https://openlibrary.org/works/OL1W',
  }), {
    md5: 'a'.repeat(32),
    isbn: '9781234567890',
    title: 'Example',
    author: 'Ada Author',
    source: 'openlibrary',
    source_id: 'OL1W',
    url: 'https://openlibrary.org/works/OL1W',
  });
});

test('resolves books@blossom.bfr.ee and keeps only secure relays', async () => {
  const service = await resolveLibVaultService(async () => discoveryResponse());
  assert.equal(service.nip05, LIBVAULT_NIP05);
  assert.equal(service.pubkey, servicePubkey);
  assert.deepEqual(service.relays, ['wss://relay.example']);
});

test('gift-wraps and publishes a libvault.fetch request', async () => {
  let rumor;
  let published;
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (recipient, plaintext) => {
        assert.equal(recipient, servicePubkey);
        rumor = JSON.parse(plaintext);
        return `sealed:${plaintext}`;
      },
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const tools = {
    generateSecretKey: () => new Uint8Array(32).fill(1),
    finalizeEvent: (event) => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
    nip44: { v2: {
      utils: { getConversationKey: () => new Uint8Array(32).fill(2) },
      encrypt: plaintext => `wrapped:${plaintext}`,
    } },
  };

  const result = await sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Example' }, {
    signer,
    fetchImpl: async () => discoveryResponse(),
    loadTools: async () => tools,
    publish: async (relay, event) => {
      published = { relay, event };
      return true;
    },
  });

  assert.equal(rumor.kind, 14);
  assert.deepEqual(rumor.tags, [['p', servicePubkey]]);
  const request = JSON.parse(rumor.content);
  assert.equal(request.type, LIBVAULT_FETCH_TYPE);
  assert.equal(request.request_id, result.requestId);
  assert.equal(request.book.md5, 'a'.repeat(32));
  assert.equal(published.relay, 'wss://relay.example');
  assert.equal(published.event.kind, 1059);
  assert.equal(published.event.tags[0][0], 'p');
  assert.equal(published.event.tags[0][1], servicePubkey);
  const expiration = published.event.tags.find(tag => tag[0] === 'expiration');
  assert.ok(expiration, 'gift wrap should carry a NIP-40 expiration');
  assert.ok(Number(expiration[1]) >= Math.floor(Date.now() / 1000) + 595);
  assert.ok(Number(expiration[1]) <= Math.floor(Date.now() / 1000) + 605);
});

test('the real NIP-44 implementation lets the LibVault key unwrap the request', async () => {
  const senderSecret = nostrTools.generateSecretKey();
  const recipientSecret = nostrTools.generateSecretKey();
  const recipientPubkey = nostrTools.getPublicKey(recipientSecret);
  let wrap;
  const signer = {
    getPublicKey: async () => nostrTools.getPublicKey(senderSecret),
    nip44: {
      encrypt: async (recipient, plaintext) => nostrTools.nip44.v2.encrypt(
        plaintext,
        nostrTools.nip44.v2.utils.getConversationKey(senderSecret, recipient),
      ),
    },
    signEvent: async event => nostrTools.finalizeEvent(event, senderSecret),
  };

  await sendLibVaultFetchRequest({ md5: 'b'.repeat(32), title: 'Private example' }, {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ names: { books: recipientPubkey }, relays: {} }),
    }),
    loadTools: async () => nostrTools,
    publish: async (_relay, event) => {
      wrap = event;
      return true;
    },
  });

  const seal = JSON.parse(nostrTools.nip44.v2.decrypt(
    wrap.content,
    nostrTools.nip44.v2.utils.getConversationKey(recipientSecret, wrap.pubkey),
  ));
  const rumor = JSON.parse(nostrTools.nip44.v2.decrypt(
    seal.content,
    nostrTools.nip44.v2.utils.getConversationKey(recipientSecret, seal.pubkey),
  ));
  const request = JSON.parse(rumor.content);
  assert.equal(wrap.kind, 1059);
  assert.equal(seal.kind, 13);
  assert.equal(rumor.kind, 14);
  assert.equal(request.type, LIBVAULT_FETCH_TYPE);
  assert.equal(request.book.md5, 'b'.repeat(32));
});

test('reports download and Blossom publication progress', async () => {
  const responses = [
    { ok: false, status: 404 },
    { ok: true, json: async () => ({ status: 'fetching', bytes: 25, total: 100, source: 'torrent' }) },
    { ok: true, json: async () => ({ status: 'ready', bytes: 100, total: 100 }) },
    { ok: true, json: async () => ({ status: 'publishing' }) },
    { ok: true, json: async () => ({ status: 'ready', bytes: 100, total: 100 }) },
    { ok: true, json: async () => ({
      status: 'ready',
      sha256: 'c'.repeat(64),
      url: `https://blossom.bfr.ee/${'c'.repeat(64)}.epub`,
      format: 'epub',
    }) },
  ];
  const progress = [];
  const result = await monitorLibVaultFetch('a'.repeat(32), {
    intervalMs: 0,
    timeoutMs: 1000,
    fetchImpl: async () => responses.shift(),
    onProgress: update => progress.push(update),
  });

  assert.deepEqual(progress.map(update => update.status), ['waiting', 'fetching', 'publishing', 'ready']);
  assert.equal(progress[1].bytes, 25);
  assert.equal(result.blossom.sha256, 'c'.repeat(64));
});

test('looks up newly published Blossom copies for existing favorites', async () => {
  const blossom = await lookupLibVaultBlossom('d'.repeat(32), async url => {
    assert.match(url, /\/api\/blossom\/d{32}$/);
    return {
      ok: true,
      json: async () => ({
        status: 'ready',
        sha256: 'e'.repeat(64),
        url: `https://blossom.bfr.ee/${'e'.repeat(64)}.epub`,
        format: 'epub',
      }),
    };
  });
  assert.equal(blossom.sha256, 'e'.repeat(64));
});

test('preserves publishing state so the library can retry availability', async () => {
  const blossom = await lookupLibVaultBlossomState('d'.repeat(32), async () => ({
    ok: true,
    json: async () => ({ status: 'publishing', md5: 'd'.repeat(32) }),
  }));
  assert.equal(blossom.status, 'publishing');
});

test('sends a private search and returns its matching response', async () => {
  let request;
  let armed = false;
  const traces = [];
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => {
        request = JSON.parse(JSON.parse(plaintext).content);
        return `sealed:${plaintext}`;
      },
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const tools = {
    generateSecretKey: () => new Uint8Array(32).fill(1),
    finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
    nip19: { npubEncode: pubkey => `npub:${pubkey}` },
    nip44: { v2: {
      utils: { getConversationKey: () => new Uint8Array(32).fill(2) },
      encrypt: plaintext => `wrapped:${plaintext}`,
    } },
  };
  const response = await searchLibVault('green books', 'title', {
    signer,
    fetchImpl: async () => discoveryResponse(),
    loadTools: async () => tools,
    publish: async () => true,
    onTrace: trace => traces.push(trace),
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: 'libvault.search.result', request_id: requestID, status: 'ready', books: [{ title: 'Green Books' }] }),
      arm: () => { armed = true; },
      close: () => {},
    }),
  });
  assert.equal(request.type, 'libvault.search');
  assert.equal(request.query, 'green books');
  assert.equal(request.search_type, 'title');
  assert.equal(request.limit, 200);
  assert.equal(armed, true);
  assert.equal(response.books[0].title, 'Green Books');
  assert.equal(traces[0].direction, 'sent');
  assert.equal(traces[0].recipient, `npub:${servicePubkey}`);
  assert.equal(traces[0].recipientNip05, 'books@blossom.bfr.ee');
  assert.equal(traces[0].payload.query, 'green books');
  assert.equal(traces[0].event.kind, 1059);
  assert.equal(traces[1].direction, 'received');
  assert.equal(traces[1].payload.books[0].title, 'Green Books');
});

test('unwraps a signed private search response from the LibVault service', async () => {
  const senderSecret = nostrTools.generateSecretKey();
  const recipientSecret = nostrTools.generateSecretKey();
  const recipientPubkey = nostrTools.getPublicKey(recipientSecret);
  const clientPubkey = nostrTools.getPublicKey(senderSecret);
  const rumor = {
    pubkey: recipientPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 14,
    tags: [['p', clientPubkey]],
    content: JSON.stringify({ type: 'libvault.search.result', request_id: 'search-1', status: 'ready', books: [] }),
  };
  rumor.id = nostrTools.getEventHash(rumor);
  const seal = nostrTools.finalizeEvent({
    kind: 13,
    created_at: rumor.created_at,
    tags: [],
    content: nostrTools.nip44.v2.encrypt(
      JSON.stringify(rumor),
      nostrTools.nip44.v2.utils.getConversationKey(recipientSecret, clientPubkey),
    ),
  }, recipientSecret);
  const ephemeral = nostrTools.generateSecretKey();
  const wrap = nostrTools.finalizeEvent({
    kind: 1059,
    created_at: rumor.created_at,
    tags: [['p', clientPubkey]],
    content: nostrTools.nip44.v2.encrypt(
      JSON.stringify(seal),
      nostrTools.nip44.v2.utils.getConversationKey(ephemeral, clientPubkey),
    ),
  }, ephemeral);
  const signer = { nip44: { decrypt: async (peer, ciphertext) => nostrTools.nip44.v2.decrypt(
    ciphertext,
    nostrTools.nip44.v2.utils.getConversationKey(senderSecret, peer),
  ) } };
  const response = await unwrapLibVaultResponse(wrap, { pubkey: recipientPubkey }, clientPubkey, signer, nostrTools);
  assert.equal(response.type, 'libvault.search.result');
  assert.equal(response.request_id, 'search-1');
});

test('resolves a default relay when only non-wss relays are advertised', async () => {
  const service = await resolveLibVaultService(async () => ({
    ok: true,
    json: async () => ({
      names: { books: servicePubkey },
      relays: {
        [servicePubkey]: ['https://relay.example', 'http://relay.example'],
      },
    }),
  }));

  assert.deepEqual(service.relays, ['wss://relay.nomadwiki.org']);
});

test('unwrapLibVaultResponse ignores a response with an invalid rumor hash', async () => {
  const senderSecret = nostrTools.generateSecretKey();
  const recipientSecret = nostrTools.generateSecretKey();
  const recipientPubkey = nostrTools.getPublicKey(recipientSecret);
  const clientPubkey = nostrTools.getPublicKey(senderSecret);
  const rumor = {
    pubkey: recipientPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 14,
    tags: [['p', clientPubkey]],
    content: JSON.stringify({ type: 'libvault.search.result', request_id: 'search-1', status: 'ready', books: [] }),
    id: 'not-the-event-hash',
  };
  const seal = nostrTools.finalizeEvent({
    kind: 13,
    created_at: rumor.created_at,
    tags: [],
    content: nostrTools.nip44.v2.encrypt(
      JSON.stringify(rumor),
      nostrTools.nip44.v2.utils.getConversationKey(recipientSecret, clientPubkey),
    ),
  }, recipientSecret);
  const ephemeral = nostrTools.generateSecretKey();
  const wrap = nostrTools.finalizeEvent({
    kind: 1059,
    created_at: rumor.created_at,
    tags: [['p', clientPubkey]],
    content: nostrTools.nip44.v2.encrypt(
      JSON.stringify(seal),
      nostrTools.nip44.v2.utils.getConversationKey(ephemeral, clientPubkey),
    ),
  }, ephemeral);
  const signer = { nip44: { decrypt: async (peer, ciphertext) => nostrTools.nip44.v2.decrypt(
    ciphertext,
    nostrTools.nip44.v2.utils.getConversationKey(senderSecret, peer),
  ) } };

  const response = await unwrapLibVaultResponse(wrap, { pubkey: recipientPubkey }, clientPubkey, signer, nostrTools);
  assert.equal(response, null);
});

test('monitorLibVaultFetch exits as cancelled when the signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await monitorLibVaultFetch('a'.repeat(32), {
    signal: controller.signal,
    intervalMs: 0,
    timeoutMs: 10,
    fetchImpl: async () => {
      assert.fail('monitor should not call fetch after signal is already aborted');
    },
  });

  assert.equal(result.status, 'cancelled');
});

test('lookupLibVaultBlossom filters out non-ready states', async () => {
  const blossom = await lookupLibVaultBlossom('a'.repeat(32), async () => ({
    ok: true,
    json: async () => ({ status: 'publishing' }),
  }));

  assert.equal(blossom, null);
});

test('searchLibVault surfaces relay readiness failures', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.stringify(JSON.parse(plaintext)),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'ready', pubkey: senderPubkey, sig: 'ready' }),
  };

  await assert.rejects(
    () => searchLibVault('books', 'title', {
      signer,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: servicePubkey },
          relays: { [servicePubkey]: ['wss://relay.example'] },
        }),
      }),
      listen: () => ({
        ready: Promise.reject(new Error('Could not subscribe for a private LibVault response')),
        result: new Promise(() => {}),
        arm: () => {},
        close: () => {},
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(1),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '5'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(2) }, encrypt: plaintext => `wrapped:${plaintext}` } },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      onTrace: () => {},
      limit: 100,
    }),
    /private LibVault response/,
  );
});

test('sendLibVaultFetchRequest reports relay rejection when no relay accepts it', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => 'sealed',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };

  await assert.rejects(
    () => sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Blocked example' }, {
      signer,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: servicePubkey },
          relays: { [servicePubkey]: ['wss://relay.example', 'wss://relay.backup'] },
        }),
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(3),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(4) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      }),
      publish: async () => false,
    }),
    /No relay accepted the private LibVault fetch request/,
  );
});

test('monitorLibVaultFetch treats non-ok jobs endpoint response as waiting then timed out', async () => {
  const start = Date.now();
  const result = await monitorLibVaultFetch('a'.repeat(32), {
    intervalMs: 0,
    timeoutMs: 5,
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'Timed out waiting for LibVault');
  assert.ok(Date.now() - start >= 0);
});


test('resolveLibVaultService rejects invalid NIP-05 pubkeys', async () => {
  await assert.rejects(
    () => resolveLibVaultService(async () => ({
      ok: true,
      json: async () => ({
        names: { books: 'not-a-key' },
        relays: { books: ['wss://relay.example'] },
      }),
    })),
    /books@blossom\.bfr\.ee has an invalid Nostr key/,
  );
});

test('libvaultBookRef trims and ignores invalid identifiers', () => {
  const ref = libvaultBookRef({
    md5: 'A'.repeat(32),
    isbn: 'not-an-isbn',
    title: '  Example Title  ',
    authors: 'Ada Author',
    source: 'openlibrary',
    sourceNativeId: 'OL1W',
    catalogUrl: 'https://openlibrary.org/works/OL1W',
  });

  assert.equal(ref.md5, 'a'.repeat(32));
  assert.equal(ref.isbn, undefined);
  assert.equal(ref.title, 'Example Title');
  assert.equal(ref.author, 'Ada Author');
  assert.equal(ref.source_id, 'OL1W');
});

test('searchLibVault normalizes searchType and returns an empty result set when status is ready', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const response = await searchLibVault('Books', undefined, {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(5),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '9'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: {
        utils: { getConversationKey: () => new Uint8Array(32).fill(6) },
        encrypt: plaintext => `wrapped:${plaintext}`,
      } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    listen: () => {
      const request = {
        type: LIBVAULT_SEARCH_RESPONSE_TYPE,
        request_id: '',
        status: 'ready',
        books: [],
      };
      return {
        ready: Promise.resolve(),
        result: Promise.resolve(request),
        arm: () => {},
        close: () => {},
      };
    },
    limit: 400,
  });

  assert.equal(response.status, 'ready');
  assert.equal(response.books.length, 0);
});

test('sendLibVaultFetchRequest rejects an invalid signer public key', async () => {
  const signer = {
    getPublicKey: async () => 'not-a-key',
    nip44: {
      encrypt: async () => 'sealed',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: 'not-a-key', sig: 'signed' }),
  };

  await assert.rejects(
    () => sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Example' }, {
      signer,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: servicePubkey },
          relays: { [servicePubkey]: ['wss://relay.example'] },
        }),
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(1),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
        nip44: { v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(2) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        } },
      }),
      publish: async () => true,
    }),
    /invalid public key/,
  );
});

test('monitorLibVaultFetch reports failed status from jobs response', async () => {
  const result = await monitorLibVaultFetch('a'.repeat(32), {
    intervalMs: 0,
    timeoutMs: 20,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ status: 'failed', error: 'indexer is temporarily unavailable' }),
    }),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'indexer is temporarily unavailable');
});


test('resolveLibVaultService deduplicates duplicate relays', async () => {
  const service = await resolveLibVaultService(async () => ({
    ok: true,
    json: async () => ({
      names: { books: servicePubkey },
      relays: { [servicePubkey]: ['wss://relay.example', 'wss://relay.example'] },
    }),
  }));

  assert.deepEqual(service.relays, ['wss://relay.example']);
});

test('searchLibVault fails when no relay accepts the subscription', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => 'encrypted',
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'signed' }),
  };

  await assert.rejects(
    () => searchLibVault('books', 'title', {
      signer,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: servicePubkey },
          relays: { [servicePubkey]: ['wss://relay.example'] },
        }),
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(7),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '7'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(8) }, encrypt: plaintext => `wrapped:${plaintext}` } },
        verifyEvent: () => true,
      }),
      publish: async () => false,
      listen: () => ({
        ready: Promise.resolve(),
        result: new Promise(() => {}),
        arm: () => {},
        close: () => {},
      }),
      onTrace: () => {},
    }),
    /No relay accepted the private LibVault search/,
  );
});

test('sendLibVaultFetchRequest requires a NIP-44 signer', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'signed' }),
  };

  await assert.rejects(
    () => sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Example' }, {
      signer,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: servicePubkey },
          relays: { [servicePubkey]: ['wss://relay.example'] },
        }),
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(9),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '9'.repeat(64), sig: 'wrapped' }),
        nip44: { v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(10) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        } },
      }),
      publish: async () => true,
    }),
    /NIP-07 with NIP-44 support is required/,
  );
});

test('lookupLibVaultBlossomState refuses invalid MD5 input', async () => {
  const state = await lookupLibVaultBlossomState('not-an-md5', async () => ({
    ok: true,
    json: async () => ({ status: 'ready' }),
  }));

  assert.equal(state, null);
});

test('monitorLibVaultFetch keeps waiting when job endpoint is temporarily unavailable', async () => {
  const calls = [];
  const result = await monitorLibVaultFetch('a'.repeat(32), {
    intervalMs: 0,
    timeoutMs: 5,
    fetchImpl: async () => {
      calls.push(Date.now());
      return {
        ok: false,
        status: 503,
        json: async () => ({}),
      };
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'Timed out waiting for LibVault');
  assert.ok(calls.length >= 1);
});
