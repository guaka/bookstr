import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  LIBVAULT_FETCH_TYPE,
  LIBVAULT_FAVORITES_TYPE,
  LIBVAULT_NIP05,
  LIBVAULT_RESOLVE_RESPONSE_TYPE,
  LIBVAULT_RESOLVE_TYPE,
  LIBVAULT_SEARCH_RESPONSE_TYPE,
  libvaultBookRef,
  resolveLibVaultBook,
  resolveLibVaultService,
  sendLibVaultFetchRequest,
  sendLibVaultFavoritesSync,
  searchLibVault,
  unwrapLibVaultResponse,
} from '../nip17-fetch.js';
import * as nostrTools from '../vendor/nostr-tools.js';

const nip17Source = await readFile(new URL('../nip17-fetch.js', import.meta.url), 'utf8');

test('NIP-17 no longer contains LibVault job or Blossom publication helpers', () => {
  assert.doesNotMatch(nip17Source, /\/jobs\?|\/blossom\/|monitorLibVaultFetch|lookupLibVaultBlossom/);
});

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

test('resolveLibVaultService accepts uppercase advertised relay public keys', async () => {
  const service = await resolveLibVaultService(async () => ({
    ok: true,
    json: async () => ({
      names: { books: servicePubkey.toUpperCase() },
      relays: { [servicePubkey.toUpperCase()]: ['wss://relay.example'] },
    }),
  }));

  assert.equal(service.pubkey, servicePubkey);
  assert.deepEqual(service.relays, ['wss://relay.example']);
});

test('resolveLibVaultService rejects discovery payloads missing a books mapping', async () => {
  await assert.rejects(
    () => resolveLibVaultService(async () => ({ ok: true, json: async () => ({ names: {}, relays: {} }) })),
    /books@blossom\.bfr\.ee has an invalid Nostr key/,
  );
});

test('resolveLibVaultService rejects non-object discovery payloads', async () => {
  await assert.rejects(
    () => resolveLibVaultService(async () => ({ ok: true, json: async () => null })),
    /books@blossom\.bfr\.ee has an invalid Nostr key/,
  );
});

test('resolveLibVaultService rejects failed discovery responses', async () => {
  await assert.rejects(
    () => resolveLibVaultService(async () => ({ ok: false, status: 503 })),
    /Could not resolve books@blossom\.bfr\.ee \(503\)/,
  );
});

test('resolveLibVaultService falls back to the default relay when relay metadata is malformed', async () => {
  const service = await resolveLibVaultService(async () => ({
    ok: true,
    json: async () => ({
      names: { books: servicePubkey },
      relays: { [servicePubkey]: 'not-an-array' },
    }),
  }));

  assert.deepEqual(service.relays, ['wss://relay.nomadwiki.org']);
});

test('resolveLibVaultService normalizes secure relays with uppercase scheme and deduplicates them', async () => {
  const service = await resolveLibVaultService(async () => ({
    ok: true,
    json: async () => ({
      names: { books: servicePubkey },
      relays: { [servicePubkey]: ['WSS://relay.example', 'wss://relay.example', 'https://insecure.example'] },
    }),
  }));

  assert.deepEqual(service.relays, ['wss://relay.example']);
});

test('sendLibVaultFetchRequest rejects when no relay publisher is available', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => 'sealed',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };

  await assert.rejects(
    () => sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Blocked' }, {
      signer,
      fetchImpl: async () => discoveryResponse(),
    }),
    /No Nostr relay publisher is available/,
  );
});

test('sendLibVaultFetchRequest accepts uppercase sender public keys', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey.toUpperCase(),
    nip44: {
      encrypt: async () => 'sealed',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey.toUpperCase(), sig: 'signed' }),
  };
  let publishRecipient;
  const result = await sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Example' }, {
    signer,
    fetchImpl: async () => discoveryResponse(),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(1),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
      nip44: {
        v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(2) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        },
      },
    }),
    publish: async (relay, event) => {
      publishRecipient = event.tags[0][1];
      return true;
    },
  });

  assert.equal(result.wrap.tags?.[1]?.[0], 'expiration');
  assert.equal(publishRecipient, servicePubkey);
});

test('sendLibVaultFetchRequest accepts a partial relay publish success', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => 'sealed',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  let publishCalls = 0;

  const discovery = {
    ok: true,
    json: async () => ({
      names: { books: servicePubkey },
      relays: { [servicePubkey]: ['wss://relay.example', 'wss://relay.example/secondary'] },
    }),
  };

  const result = await sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Partial relay accept' }, {
    signer,
    fetchImpl: async () => discovery,
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(7),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
      nip44: {
        v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(8) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        },
      },
    }),
    publish: async relay => {
      publishCalls += 1;
      return relay === 'wss://relay.example';
    },
  });

  assert.equal(publishCalls, 2);
  assert.equal(result.service.relays.length, 2);
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
    () => sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Invalid sender' }, {
      signer,
      fetchImpl: async () => discoveryResponse(),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(33),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
      }),
      publish: async () => true,
    }),
    /invalid public key/,
  );
});

test('resolveLibVaultService falls back to the default relay when relays are missing', async () => {
  const service = await resolveLibVaultService(async () => ({
    ok: true,
    json: async () => ({
      names: { books: servicePubkey },
      relays: {},
    }),
  }));

  assert.deepEqual(service.relays, ['wss://relay.nomadwiki.org']);
  assert.equal(service.pubkey, servicePubkey);
});

test('resolveLibVaultService surfaces discovery failures', async () => {
  await assert.rejects(
    () => resolveLibVaultService(async () => {
      throw new Error('network offline');
    }),
    /Could not resolve books@blossom\.bfr\.ee/i,
  );
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

test('gift-wraps the complete deduplicated favorites set for LibVault', async () => {
  let rumor;
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: { encrypt: async (_recipient, plaintext) => { rumor = JSON.parse(plaintext); return 'sealed'; } },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const tools = {
    generateSecretKey: () => new Uint8Array(32).fill(1),
    finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
    nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32) }, encrypt: value => value } },
  };
  await sendLibVaultFavoritesSync([{ md5: 'a'.repeat(32) }, { md5: 'a'.repeat(32) }, { md5: 'b'.repeat(32) }], {
    signer, fetchImpl: async () => discoveryResponse(), loadTools: async () => tools, publish: async () => true,
  });
  const request = JSON.parse(rumor.content);
  assert.equal(request.type, LIBVAULT_FAVORITES_TYPE);
  assert.deepEqual(request.favorites, ['a'.repeat(32), 'b'.repeat(32)]);
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

test('sends content search through the existing private request shape', async () => {
  let request;
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
  const response = await searchLibVault('green ideas', 'content', {
    signer,
    fetchImpl: async () => discoveryResponse(),
    loadTools: async () => tools,
    publish: async () => true,
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({
        type: 'libvault.search.result', request_id: requestID, status: 'ready', total: 1,
        hits: [{ citation: { snippet: 'A passage' }, book: null }],
      }),
      arm: () => {},
      close: () => {},
    }),
  });
  assert.deepEqual(request, {
    type: 'libvault.search', request_id: request.request_id, query: 'green ideas', search_type: 'content', limit: 200,
  });
  assert.equal(response.hits[0].citation.snippet, 'A passage');
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

test('unwrapLibVaultResponse ignores messages that were not wrapped for this sender', async () => {
  const senderSecret = nostrTools.generateSecretKey();
  const recipientSecret = nostrTools.generateSecretKey();
  const maliciousPubkey = '9'.repeat(64);
  const recipientPubkey = nostrTools.getPublicKey(recipientSecret);
  const clientPubkey = nostrTools.getPublicKey(senderSecret);
  const rumor = {
    pubkey: recipientPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 14,
    tags: [['p', maliciousPubkey]],
    content: JSON.stringify({ type: 'libvault.search.result', request_id: 'search-2', status: 'ready', books: [] }),
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
  assert.equal(response, null);
});

test('unwrapLibVaultResponse returns null when wrapped event is not addressed to sender', async () => {
  const response = await unwrapLibVaultResponse(
    {
      kind: 1059,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: 'a'.repeat(64),
      tags: [['p', '0'.repeat(64)]],
      content: 'ignored',
      id: 'wrapped-id',
      sig: 'wrapped-sig',
    },
    { pubkey: servicePubkey },
    senderPubkey,
    { nip44: { decrypt: async () => '' } },
    { ...nostrTools, verifyEvent: () => true },
  );

  assert.equal(response, null);
});

test('unwrapLibVaultResponse rejects responses signed by unknown service keys', async () => {
  const senderSecret = nostrTools.generateSecretKey();
  const recipientSecret = nostrTools.generateSecretKey();
  const servicePubkey = nostrTools.getPublicKey(recipientSecret);
  const clientPubkey = nostrTools.getPublicKey(senderSecret);
  const rumor = {
    pubkey: servicePubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 14,
    tags: [['p', clientPubkey]],
    content: JSON.stringify({ type: 'libvault.search.result', request_id: 'search-3', status: 'ready', books: [] }),
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
  const otherSecret = nostrTools.generateSecretKey();
  const wrap = nostrTools.finalizeEvent({
    kind: 1059,
    created_at: rumor.created_at,
    tags: [['p', clientPubkey]],
    content: nostrTools.nip44.v2.encrypt(
      JSON.stringify(seal),
      nostrTools.nip44.v2.utils.getConversationKey(otherSecret, clientPubkey),
    ),
  }, otherSecret);
  const signer = { nip44: { decrypt: async (peer, ciphertext) => nostrTools.nip44.v2.decrypt(
    ciphertext,
    nostrTools.nip44.v2.utils.getConversationKey(senderSecret, peer),
  ) } };

  const response = await unwrapLibVaultResponse(wrap, { pubkey: '0'.repeat(64) }, clientPubkey, signer, nostrTools);
  assert.equal(response, null);
});

test('unwrapLibVaultResponse ignores payloads failing event verification', async () => {
  const response = await unwrapLibVaultResponse(
    {
      kind: 1059,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: 'a'.repeat(64),
      tags: [['p', senderPubkey]],
      content: '{}',
      id: 'bad',
      sig: 'bad',
    },
    { pubkey: servicePubkey },
    senderPubkey,
    { nip44: { decrypt: async () => '' } },
    { ...nostrTools, verifyEvent: () => false },
  );

  assert.equal(response, null);
});

test('unwrapLibVaultResponse rejects rumors with invalid id hash', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  const secret = nostrTools.generateSecretKey();
  const seal = {
    kind: 13,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: service,
    tags: [['p', sender]],
    content: JSON.stringify({
      kind: 14,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: service,
      tags: [['p', sender]],
      content: JSON.stringify({
        type: LIBVAULT_SEARCH_RESPONSE_TYPE,
        request_id: 'search-1',
        status: 'ready',
        books: [],
      }),
      id: 'invalid-rumor-id',
    }),
  };
  const wrapped = {
    kind: 1059,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: service,
    tags: [['p', sender]],
    content: nostrTools.nip44.v2.encrypt(
      JSON.stringify(seal),
      nostrTools.nip44.v2.utils.getConversationKey(secret, sender),
    ),
    id: 'wrapped-id',
    sig: 'wrapped-sig',
  };
  const signer = {
    nip44: {
      decrypt: async (peer, ciphertext) => {
        if (ciphertext === 'invalid-seal') return JSON.stringify(seal);
        return ciphertext;
      },
    },
  };

  const response = await unwrapLibVaultResponse(
    { ...wrapped, content: 'invalid-seal' },
    { pubkey: service },
    sender,
    signer,
    {
      ...nostrTools,
      verifyEvent: () => true,
      getPublicKey: () => service,
    },
  );

  assert.equal(response, null);
});

test('searchLibVault requires a decrypt-capable NIP-44 signer', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => 'sealed',
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
      publish: async () => true,
    }),
    /A Nostr signer with NIP-44 support is required/,
  );
});

test('searchLibVault requires WebSocket support when no custom listener is provided', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
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
        nip44: { v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(8) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        } },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      WebSocketImpl: null,
    }),
    /WebSocket support is required for private search/,
  );
});

test('searchLibVault rejects non-ready private search responses', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => 'sealed',
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'signed' }),
  };
  await assert.rejects(
    () => searchLibVault('Books', 'all', {
      signer,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: servicePubkey },
          relays: { [servicePubkey]: ['wss://relay.example'] },
        }),
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(11),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'a'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(12) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        } },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      listen: () => ({
        ready: Promise.resolve(),
        result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: '', status: 'error', books: [] }),
        arm: () => {},
        close: () => {},
      }),
    }),
    /Private LibVault search failed/,
  );
});

test('searchLibVault ignores mismatched response IDs and times out', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
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
        generateSecretKey: () => new Uint8Array(32).fill(9),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'a'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(10) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        } },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      responseTimeoutMs: 5,
      listen: ({ requestID }) => ({
        ready: Promise.resolve(),
        result: Promise.resolve({
          type: LIBVAULT_SEARCH_RESPONSE_TYPE,
          request_id: `${requestID}-mismatch`,
          status: 'ready',
          books: [{ title: 'Wrong Request' }],
        }),
        arm: () => {},
        close: () => {},
      }),
    }),
    /Private LibVault search response timed out/,
  );
});

test('unwrapLibVaultResponse rejects malformed wrapped payload JSON', async () => {
  const signer = { nip44: { decrypt: async () => '{malformed' } };
  await assert.rejects(
    () => unwrapLibVaultResponse(
      {
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: 'a'.repeat(64),
        tags: [['p', senderPubkey]],
        content: 'not-valid-json',
        id: 'valid-id',
        sig: 'sig',
      },
      { pubkey: servicePubkey },
      senderPubkey,
      signer,
      { ...nostrTools, verifyEvent: () => true },
    ),
    SyntaxError,
  );
});

test('unwrapLibVaultResponse rejects a rumor without a sender p-tag', async () => {
  const signer = {
    nip44: {
      decrypt: async (_sender, ciphertext) => {
        if (ciphertext === 'sealed-event') return JSON.stringify(seal);
        if (ciphertext === 'sealed-rumor') return JSON.stringify(rumor);
        throw new Error('unexpected ciphertext');
      },
    },
  };
  const rumor = {
    pubkey: servicePubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 14,
    tags: [],
    content: 'sealed-rumor',
  };
  rumor.id = nostrTools.getEventHash(rumor);
  const seal = {
    kind: 13,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: servicePubkey,
    tags: [['p', senderPubkey]],
    content: 'sealed-rumor',
  };
  seal.id = nostrTools.getEventHash(seal);

  const response = await unwrapLibVaultResponse(
    {
      kind: 1059,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: 'a'.repeat(64),
      tags: [['p', senderPubkey]],
      content: 'sealed-event',
      id: 'valid-id',
      sig: 'sig',
    },
    { pubkey: servicePubkey },
    senderPubkey,
    signer,
    { ...nostrTools, verifyEvent: () => true },
  );

  assert.equal(response, null);
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

test('searchLibVault closes custom listener when ready times out before response', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.stringify(JSON.parse(plaintext)),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'ready', pubkey: senderPubkey, sig: 'ready' }),
  };
  let closed = false;

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
        close: () => { closed = true; },
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(1),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '5'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(2) }, encrypt: plaintext => `wrapped:${plaintext}` } },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      limit: 100,
    }),
    /private LibVault response/,
  );

  assert.ok(closed);
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

test('sendLibVaultFetchRequest succeeds when at least one relay accepts the request', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => 'sealed',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const publishCalls = [];

  const result = await sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Example' }, {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.accepts.example', 'wss://relay.rejects.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(3),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
      nip44: {
        v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(4) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        },
      },
    }),
    publish: async (relay, _event) => {
      publishCalls.push(relay);
      return relay === 'wss://relay.accepts.example';
    },
  });

  assert.equal(result.service.pubkey, servicePubkey);
  assert.deepEqual(
    publishCalls.sort(),
    ['wss://relay.accepts.example', 'wss://relay.rejects.example'].sort(),
  );
  assert.equal(typeof result.requestId, 'string');
});

test('sendLibVaultFetchRequest propagates publish failures', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: { encrypt: async () => 'sealed' },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };

  await assert.rejects(
    () => sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Example' }, {
      signer,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: servicePubkey },
          relays: { [servicePubkey]: ['wss://relay.bad', 'wss://relay.good'] },
        }),
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(3),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(4) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      }),
      publish: async relay => {
        if (relay === 'wss://relay.bad') throw new Error('publish failed');
        return true;
      },
    }),
    /publish failed/,
  );
});

test('searchLibVault rejects missing relay publisher', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'ready' }),
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
        generateSecretKey: () => new Uint8Array(32).fill(1),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(2) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      }),
    }),
    /No Nostr relay publisher is available/,
  );
});

test('searchLibVault normalizes query, search type, and limit', async () => {
  let sent;
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'ready' }),
  };
  const payloads = [];

  const result = await searchLibVault('  Green Books  ', 'TITLE', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: requestID, status: 'ready', books: [] }),
      arm: () => {},
      close: () => {},
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(8),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'e'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: {
        utils: { getConversationKey: () => new Uint8Array(32).fill(9) },
        encrypt: plaintext => `wrapped:${plaintext}`,
      } },
      verifyEvent: () => true,
    }),
    publish: async (_relay, event) => {
      sent = event;
      return true;
    },
    onTrace: trace => {
      if (trace.direction === 'sent') payloads.push(trace.payload);
    },
  });

  assert.equal(result.books.length, 0);
  assert.equal(payloads[0].query, 'Green Books');
  assert.equal(payloads[0].search_type, 'title');
  assert.equal(payloads[0].limit, 200);
  assert.equal(sent.tags[0]?.[0], 'p');
  assert.equal(sent.tags[0]?.[1], servicePubkey);
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

test('libvaultBookRef uses sourceId as fallback identifier', () => {
  const ref = libvaultBookRef({
    md5: 'A'.repeat(32),
    title: 'Example title',
    sourceId: 'OL2W',
    catalogUrl: 'https://openlibrary.org/works/OL2W',
  });

  assert.equal(ref.source_id, 'OL2W');
  assert.equal(ref.url, 'https://openlibrary.org/works/OL2W');
});

test('libvaultBookRef prefers sourceUrl over catalogUrl', () => {
  const ref = libvaultBookRef({
    md5: 'B'.repeat(32),
    title: 'Source URL test',
    sourceUrl: 'https://source.example/book',
    catalogUrl: 'https://catalog.example/book',
  });

  assert.equal(ref.url, 'https://source.example/book');
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

test('searchLibVault uses the service pubkey when npub encoding is not available', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const traces = [];
  await searchLibVault('books', 'title', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(19),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(20) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => traces.push(trace),
    listen: () => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: '', status: 'ready', books: [] }),
      arm: () => {},
      close: () => {},
    }),
  });

  const sent = traces.find(trace => trace.direction === 'sent');
  assert.equal(sent.recipient, servicePubkey);
});

test('searchLibVault clamps query and limits to valid ranges', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const traces = [];
  const response = await searchLibVault('  alice in wonderland  ', 'TITLE', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(15),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: {
        v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(16) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        },
      },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => traces.push(trace),
    limit: 0,
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: requestID, status: 'ready', books: [] }),
      arm: () => {},
      close: () => {},
    }),
  });

  const sentPayload = traces.find(trace => trace.direction === 'sent')?.payload;
  assert.equal(response.status, 'ready');
  assert.equal(sentPayload.search_type, 'title');
  assert.equal(sentPayload.query, 'alice in wonderland');
  assert.equal(sentPayload.limit, 1);
});

test('searchLibVault clamps negative limit to 1', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'ready' }),
  };
  const traces = [];
  await searchLibVault('books', 'title', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(6),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'a'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: {
        utils: { getConversationKey: () => new Uint8Array(32).fill(7) },
        encrypt: plaintext => `wrapped:${plaintext}`,
      } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => traces.push(trace),
    limit: -1,
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: requestID, status: 'ready', books: [] }),
      arm: () => {},
      close: () => {},
    }),
  });

  const sentPayload = traces.find(trace => trace.direction === 'sent')?.payload;
  assert.equal(sentPayload.limit, 1);
});

test('searchLibVault treats non-numeric limits as 200', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const traces = [];
  await searchLibVault('books', 'title', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(13),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: {
        v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(14) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        },
      },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => traces.push(trace),
    limit: 'abc',
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: requestID, status: 'ready', books: [] }),
      arm: () => {},
      close: () => {},
    }),
  });

  const sentPayload = traces.find(trace => trace.direction === 'sent')?.payload;
  assert.equal(sentPayload.limit, 200);
});

test('searchLibVault propagates listener ready failures', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
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
        generateSecretKey: () => new Uint8Array(32).fill(19),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '9'.repeat(64), sig: 'wrapped' }),
        verifyEvent: () => true,
      }),
      listen: () => ({
        ready: Promise.reject(new Error('listener failed')),
        result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: '', status: 'ready', books: [] }),
        arm: () => {},
        close: () => {},
      }),
    }),
    /listener failed/,
  );
});

test('searchLibVault propagates listener result failures', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
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
        generateSecretKey: () => new Uint8Array(32).fill(9),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '9'.repeat(64), sig: 'wrapped' }),
        nip44: { v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(10) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        } },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      listen: () => ({
        ready: Promise.resolve(),
        result: Promise.reject(new Error('result failed')),
        arm: () => {},
        close: () => {},
      }),
    }),
    /result failed/,
  );
});

test('searchLibVault closes custom listener when result rejects', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };

  let closed = false;

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
        generateSecretKey: () => new Uint8Array(32).fill(18),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
        nip44: {
          v2: {
            utils: { getConversationKey: () => new Uint8Array(32).fill(19) },
            encrypt: plaintext => `sealed:${plaintext}`,
          },
        },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      listen: () => ({
        ready: Promise.resolve(),
        result: Promise.reject(new Error('result listener failed')),
        arm: () => {},
        close: () => { closed = true; },
      }),
    }),
    /result listener failed/,
  );

  assert.ok(closed);
});

test('searchLibVault sends an empty query when input is blank', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const traces = [];
  await searchLibVault('   ', 'title', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(21),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: {
        v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(22) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        },
      },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => traces.push(trace),
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: requestID, status: 'ready', books: [] }),
      arm: () => {},
      close: () => {},
    }),
  });

  const sentPayload = traces.find(trace => trace.direction === 'sent')?.payload;
  assert.equal(sentPayload.query, '');
});

test('searchLibVault rejects invalid signer public keys', async () => {
  const signer = {
    getPublicKey: async () => 'not-a-key',
    nip44: {
      encrypt: async () => 'sealed',
      decrypt: async () => 'opened',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: 'not-a-key', sig: 'signed' }),
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
        generateSecretKey: () => new Uint8Array(32).fill(27),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      }),
      publish: async () => true,
    }),
    /invalid public key/,
  );
});

test('searchLibVault clamps too-large limits to 200', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const traces = [];
  await searchLibVault('books', 'all', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(17),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(18) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => traces.push(trace),
    limit: 400,
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: requestID, status: 'ready', books: [] }),
      arm: () => {},
      close: () => {},
    }),
  });

  const sentPayload = traces.find(trace => trace.direction === 'sent')?.payload;
  assert.equal(sentPayload.limit, 200);
});

test('searchLibVault enforces a minimum limit of 1', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'ready' }),
  };
  const traces = [];
  await searchLibVault('books', 'title', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(17),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(18) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => traces.push(trace),
    limit: 0,
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: requestID, status: 'ready', books: [] }),
      arm: () => {},
      close: () => {},
    }),
  });

  const sentPayload = traces.find(trace => trace.direction === 'sent')?.payload;
  assert.equal(sentPayload.limit, 1);
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
    /A Nostr signer with NIP-44 support is required/,
  );
});

test('sendLibVaultFetchRequest requires a signer that can sign events', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => 'sealed',
    },
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
    /A Nostr signer with NIP-44 support is required/,
  );
});

test('sendLibVaultFavoritesSync requires a Nostr signer with NIP-44 support', async () => {
  await assert.rejects(
    () => sendLibVaultFavoritesSync([{ md5: 'a'.repeat(32) }], { signer: {} }),
    /A Nostr signer with NIP-44 support is required/,
  );
});

test('sendLibVaultFetchRequest passes through signer public key case normalization', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey.toUpperCase(),
    nip44: {
      encrypt: async () => 'sealed',
    },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey.toUpperCase(), sig: 'signed' }),
  };
  let wrapped;
  await sendLibVaultFetchRequest({ md5: 'a'.repeat(32), title: 'Example' }, {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(13),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip44: { v2: {
        utils: { getConversationKey: () => new Uint8Array(32).fill(14) },
        encrypt: plaintext => `wrapped:${plaintext}`,
      } },
    }),
    publish: async () => true,
  }).then(result => {
    wrapped = result;
  });
  assert.ok(wrapped?.wrap?.pubkey);
});

test('sendLibVaultFetchRequest fails when no relay publisher is provided', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: { encrypt: async () => 'sealed' },
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
        generateSecretKey: () => new Uint8Array(32).fill(1),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
        nip44: { v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(2) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        } },
      }),
    }),
    /No Nostr relay publisher is available/,
  );
});

test('searchLibVault emits a received trace when listener does not emit one', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };
  const traces = [];
  const response = await searchLibVault('books', 'title', {
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
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: {
        utils: { getConversationKey: () => new Uint8Array(32).fill(2) },
        encrypt: plaintext => `wrapped:${plaintext}`,
      } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => traces.push(trace),
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ type: LIBVAULT_SEARCH_RESPONSE_TYPE, request_id: requestID, status: 'ready', books: [] }),
      arm: () => {},
      close: () => {},
    }),
  });

  assert.equal(response.status, 'ready');
  const sent = traces.find(trace => trace.direction === 'sent');
  const received = traces.find(trace => trace.direction === 'received');
  const requestId = sent?.payload?.request_id || '';
  assert.ok(Boolean(sent));
  assert.equal(sent.event.kind, 1059);
  assert.equal(sent.recipient, `npub:${servicePubkey}`);
  assert.equal(sent.payload.search_type, 'title');
  assert.equal(sent.payload.limit, 200);
  assert.equal(received?.payload?.status, 'ready');
  assert.equal(received?.payload?.request_id, requestId);
});

test('searchLibVault ignores exceptions thrown from onTrace callbacks', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seal', pubkey: senderPubkey, sig: 'signed' }),
  };

  let requestId = '';
  const response = await searchLibVault('books', 'title', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(2),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: '6'.repeat(64), sig: 'wrapped' }),
      nip44: { v2: {
        utils: { getConversationKey: () => new Uint8Array(32).fill(3) },
        encrypt: plaintext => `wrapped:${plaintext}`,
      } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: () => { throw new Error('trace callback failed'); },
    listen: ({ requestID }) => {
      requestId = requestID;
      return {
        ready: Promise.resolve(),
        result: Promise.resolve({
          type: LIBVAULT_SEARCH_RESPONSE_TYPE,
          request_id: requestID,
          status: 'ready',
          books: [{ title: 'Recovered' }],
        }),
        arm: () => {},
        close: () => {},
      };
    },
  });

  assert.equal(response.status, 'ready');
  assert.equal(response.books[0].title, 'Recovered');
  assert.equal(typeof requestId, 'string');
  assert.equal(requestId.length > 0, true);
});

test('searchLibVault requires a relay publisher for subscription events', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
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
        generateSecretKey: () => new Uint8Array(32).fill(21),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(22) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        } },
        verifyEvent: () => true,
      }),
      listen: () => ({
        ready: Promise.resolve(),
        result: new Promise(() => {}),
        arm: () => {},
        close: () => {},
      }),
    }),
    /No Nostr relay publisher is available/,
  );
});

test('searchLibVault closes custom listener when result times out', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.parse(plaintext),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'signed' }),
  };
  let closed = false;
  let armed = false;

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
        generateSecretKey: () => new Uint8Array(32).fill(23),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(24) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        } },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      listen: ({ requestID }) => ({
        ready: Promise.resolve(),
        result: new Promise(() => {}),
        arm: () => { armed = true; },
        close: () => { closed = true; },
      }),
      responseTimeoutMs: 5,
    }),
    /Private LibVault search response timed out/,
  );

  assert.ok(armed);
  assert.ok(closed);
});

test('searchLibVault closes custom listener when publish is rejected', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => '{}',
      decrypt: async () => '{}',
    },
    signEvent: async event => ({ ...event, id: 'publish-failure', pubkey: senderPubkey, sig: 'signed' }),
  };
  let armed = false;
  let closed = false;

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
        generateSecretKey: () => new Uint8Array(32).fill(1),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: {
          v2: {
            utils: { getConversationKey: () => new Uint8Array(32).fill(2) },
            encrypt: plaintext => `wrapped:${plaintext}`,
          },
        },
        verifyEvent: () => true,
      }),
      publish: async () => false,
      listen: () => ({
        ready: Promise.resolve(),
        result: new Promise(() => {}),
        arm: () => { armed = true; },
        close: () => { closed = true; },
      }),
      limit: 100,
    }),
    /No relay accepted the private LibVault search/,
  );

  assert.ok(armed);
  assert.ok(closed);
});

test('searchLibVault closes custom listener when arm() throws', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async () => '{}',
      decrypt: async () => '{}',
    },
    signEvent: async event => ({ ...event, id: 'arm-error', pubkey: senderPubkey, sig: 'signed' }),
  };
  let armed = false;
  let closed = false;

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
        generateSecretKey: () => new Uint8Array(32).fill(25),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: {
          v2: {
            utils: { getConversationKey: () => new Uint8Array(32).fill(26) },
            encrypt: plaintext => `wrapped:${plaintext}`,
          },
        },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      listen: () => ({
        ready: Promise.resolve(),
        result: new Promise(() => {}),
        arm: () => {
          armed = true;
          throw new Error('subscription failed');
        },
        close: () => {
          closed = true;
        },
      }),
      limit: 100,
    }),
    /subscription failed/,
  );

  assert.ok(armed);
  assert.ok(closed);
});

test('searchLibVault closes custom listener when ready stage fails', async () => {
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: {
      encrypt: async (_recipient, plaintext) => JSON.stringify(JSON.parse(plaintext)),
      decrypt: async () => '',
    },
    signEvent: async event => ({ ...event, id: 'ready', pubkey: senderPubkey, sig: 'ready' }),
  };
  let closed = false;

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
        close: () => { closed = true; },
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(30),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(31) }, encrypt: plaintext => `wrapped:${plaintext}` } },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      limit: 100,
    }),
    /private LibVault response/,
  );

  assert.ok(closed);
});

test('searchLibVault uses default websocket listener and ignores malformed socket messages', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  const traces = [];
  const sockets = [];
  let sentPayload;
  const malformedPayload = '{bad json';
  const wrappedPayloadMarker = 'wrap:response';
  const sealedPayloadMarker = 'seal:response';
  const responsePayload = {
    type: LIBVAULT_SEARCH_RESPONSE_TYPE,
    request_id: '',
    status: 'ready',
    books: [{ title: 'Default Listener Favorite' }],
  };

  class FakeWebSocket {
    constructor() {
      this.handlers = {};
      this.closed = false;
      this.subscriptions = new Set();
      sockets.push(this);
      setTimeout(() => this._emit('open'), 0);
    }

    addEventListener(name, handler) {
      (this.handlers[name] ||= []).push(handler);
    }

    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] === 'REQ') {
        this.subscriptions.add(packet[1]);
        setTimeout(() => this._emit('message', { data: JSON.stringify(['EOSE', packet[1]]) }), 0);
        setTimeout(() => this._emit('message', { data: malformedPayload }), 1);
      }
    }

    emitResponse(subscription) {
      const event = {
        kind: 1059,
        pubkey: service,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', sender]],
        content: wrappedPayloadMarker,
      };
      this._emit('message', { data: JSON.stringify(['EVENT', subscription, event]) });
    }

    close() {
      this.closed = true;
    }

    _emit(name, event) {
      (this.handlers[name] || []).forEach(handler => handler(event));
    }
  }

  const response = await searchLibVault('books', 'title', {
    signer: {
      getPublicKey: async () => sender,
      nip44: {
        encrypt: async () => '{}',
        decrypt: async (_peer, ciphertext) => {
          if (ciphertext === wrappedPayloadMarker) {
            return JSON.stringify({
              kind: 13,
              created_at: Math.floor(Date.now() / 1000),
              pubkey: service,
              tags: [],
              content: sealedPayloadMarker,
            });
          }
          if (ciphertext === sealedPayloadMarker) {
            const rumor = {
              pubkey: service,
              created_at: Math.floor(Date.now() / 1000),
              kind: 14,
              tags: [['p', sender]],
              content: JSON.stringify({
                ...responsePayload,
                request_id: sentPayload?.request_id ?? '',
              }),
            };
            rumor.id = nostrTools.getEventHash(rumor);
            return JSON.stringify(rumor);
          }
          throw new Error('unexpected ciphertext');
        },
      },
      signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: service },
        relays: { [service]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(30),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(31) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => {
      for (const socket of sockets) {
        for (const subscription of socket.subscriptions) {
          socket.emitResponse(subscription);
        }
      }
      return true;
    },
    onTrace: trace => {
      traces.push(trace);
      if (trace.direction === 'sent') sentPayload = trace.payload;
    },
    WebSocketImpl: FakeWebSocket,
  });

  const sent = traces.find(trace => trace.direction === 'sent');
  assert.equal(sent.recipient, `npub:${service}`);
  assert.equal(response.status, 'ready');
  assert.equal(response.books?.[0]?.title, 'Default Listener Favorite');
});

test('searchLibVault ignores an unmatched default listener response and resolves when request id matches', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  const traces = [];
  const sockets = [];
  let sentPayload;

  class FakeWebSocket {
    constructor() {
      this.handlers = {};
      this.closed = false;
      this.subscriptions = new Set();
      sockets.push(this);
      setTimeout(() => this._emit('open'), 0);
    }

    addEventListener(name, handler) {
      (this.handlers[name] ||= []).push(handler);
    }

    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] === 'REQ') {
        const subscription = packet[1];
        this.subscriptions.add(subscription);
        setTimeout(() => this._emit('message', { data: JSON.stringify(['EOSE', subscription]) }), 0);
      }
      if (packet?.[0] === 'CLOSE') {
        this._emit('close');
      }
    }

    emitResponse(subscription, marker, requestID) {
      const event = {
        kind: 1059,
        pubkey: service,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', sender]],
        content: marker,
      };
      this._emit('message', { data: JSON.stringify(['EVENT', subscription, event]) });
    }

    close() {
      this.closed = true;
    }

    _emit(name, event) {
      (this.handlers[name] || []).forEach(handler => handler(event));
    }
  }

  const response = await searchLibVault('books', 'title', {
    signer: {
      getPublicKey: async () => sender,
      nip44: {
        encrypt: async () => '{}',
        decrypt: async (_peer, ciphertext) => {
          if (ciphertext.startsWith('{')) return ciphertext;
          const requestID = sentPayload?.request_id || '';
          const rumor = {
            pubkey: service,
            created_at: Math.floor(Date.now() / 1000),
            kind: 14,
            tags: [['p', sender]],
            content: '',
          };
          const payload = {
            type: LIBVAULT_SEARCH_RESPONSE_TYPE,
            request_id: ciphertext === 'wrap:match' ? requestID : 'unrelated-id',
            status: 'ready',
            books: [{ title: ciphertext === 'wrap:match' ? 'Matched book' : 'Ignored book' }],
          };
          rumor.content = JSON.stringify(payload);
          rumor.id = nostrTools.getEventHash(rumor);
          const seal = {
            kind: 13,
            created_at: rumor.created_at,
            pubkey: service,
            tags: [['p', sender]],
            content: JSON.stringify(rumor),
          };
          return JSON.stringify(seal);
        },
      },
      signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: service },
        relays: { [service]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(9),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'd'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(10) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => {
      for (const socket of sockets) {
        for (const subscription of socket.subscriptions) {
          socket.emitResponse(subscription, 'wrap:mismatch');
          socket.emitResponse(subscription, 'wrap:match');
        }
      }
      return true;
    },
    onTrace: trace => {
      traces.push(trace);
      if (trace.direction === 'sent') sentPayload = trace.payload;
    },
    WebSocketImpl: FakeWebSocket,
    responseTimeoutMs: 2000,
  });

  const sent = traces.find(trace => trace.direction === 'sent');
  assert.equal(sent?.recipient, `npub:${service}`);
  assert.equal(response.status, 'ready');
  assert.equal(response.books?.[0]?.title, 'Matched book');
});

test('searchLibVault times out when default listener never receives EOSE', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  let published = false;
  let closed = false;

  class FakeWebSocket {
    constructor() {
      setTimeout(() => this._emit('open'), 0);
    }

    addEventListener(name, handler) {
      (this.handlers ||= {})[name] = handler;
    }

    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] === 'REQ') {
        // no EOSE emitted on purpose
      }
      if (packet?.[0] === 'CLOSE') {
        this._emit('close');
      }
    }

    close() {
      closed = true;
    }

    _emit(name, event) {
      this.handlers?.[name]?.(event ?? { type: name });
    }
  }

  await assert.rejects(
    () => searchLibVault('books', 'title', {
      signer: {
        getPublicKey: async () => sender,
        nip44: { encrypt: async () => '{}', decrypt: async () => '{}' },
        signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: service },
          relays: { [service]: ['wss://relay.example'] },
        }),
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(11),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(12) }, encrypt: plaintext => `wrapped:${plaintext}` } },
        verifyEvent: () => true,
      }),
      publish: async () => {
        published = true;
        return true;
      },
      WebSocketImpl: FakeWebSocket,
      readyTimeoutMs: 8,
    }),
    /Private LibVault search relay timed out/,
  );

  assert.equal(published, false);
  assert.equal(closed, true);
});

test('searchLibVault closes default listeners when the response times out after EOSE', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  let closed = false;

  class FakeWebSocket {
    constructor() {
      this.handlers = {};
      setTimeout(() => this._emit('open'), 0);
    }

    addEventListener(name, handler) {
      (this.handlers[name] ||= []).push(handler);
    }

    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] === 'REQ') {
        setTimeout(() => this._emit('message', { data: JSON.stringify(['EOSE', packet[1]]) }), 0);
      }
    }

    close() {
      closed = true;
    }

    _emit(name, event) {
      (this.handlers[name] || []).forEach(handler => handler(event));
    }
  }

  await assert.rejects(
    () => searchLibVault('books', 'title', {
      signer: {
        getPublicKey: async () => sender,
        nip44: { encrypt: async () => '{}', decrypt: async () => '{}' },
        signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: service },
          relays: { [service]: ['wss://relay.example'] },
        }),
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(13),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(14) }, encrypt: plaintext => `wrapped:${plaintext}` } },
        verifyEvent: () => true,
      }),
      publish: async () => true,
      WebSocketImpl: FakeWebSocket,
      responseTimeoutMs: 8,
    }),
    /Private LibVault search response timed out/,
  );

  assert.equal(closed, true);
});

test('searchLibVault reports relay readiness failures from default listener', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  let published = false;
  let closed = false;

  class FakeWebSocket {
    constructor() {
      this.handlers = {};
      setTimeout(() => this._emit('open'), 0);
    }

    addEventListener(name, handler) {
      (this.handlers[name] ||= []).push(handler);
    }

    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] === 'REQ') {
        setTimeout(() => this._emit('error', new Error('relay unavailable')), 0);
      }
    }

    close() {
      closed = true;
    }

    _emit(name, event) {
      (this.handlers[name] || []).forEach(handler => handler(event));
    }
  }

  await assert.rejects(
    () => searchLibVault('books', 'title', {
      signer: {
        getPublicKey: async () => sender,
        nip44: { encrypt: async () => '{}', decrypt: async () => '{}' },
        signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          names: { books: service },
          relays: { [service]: ['wss://relay.example'] },
        }),
      }),
      loadTools: async () => ({
        generateSecretKey: () => new Uint8Array(32).fill(17),
        finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
        nip19: { npubEncode: pubkey => `npub:${pubkey}` },
        nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(18) }, encrypt: plaintext => `wrapped:${plaintext}` } },
        verifyEvent: () => true,
      }),
      publish: async () => {
        published = true;
        return true;
      },
      WebSocketImpl: FakeWebSocket,
      readyTimeoutMs: 8,
    }),
    /Could not subscribe for a private LibVault response/,
  );

  assert.equal(published, false);
  assert.equal(closed, true);
});

test('searchLibVault proceeds when one default relay is unavailable and another becomes ready', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  const sockets = [];
  let sentPayload;
  let requestId = '';
  const relays = ['wss://relay.bad.example', 'wss://relay.good.example'];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      this.subscriptions = new Set();
      this.live = false;
      sockets.push(this);
      setTimeout(() => this._emit('open'), 0);
    }

    addEventListener(name, handler) {
      (this.handlers[name] ||= []).push(handler);
    }

    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] !== 'REQ') return;
      const subscription = packet[1];
      this.subscriptions.add(subscription);
      if (this.url.includes('bad')) {
        setTimeout(() => this._emit('error', new Error('relay unavailable')), 0);
        return;
      }
      setTimeout(() => {
        this.live = true;
        this._emit('message', { data: JSON.stringify(['EOSE', subscription]) });
      }, 0);
    }

    emitResponse(subscription) {
      if (!this.live) return;
      const wrappedEvent = {
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: service,
        tags: [['p', sender]],
        content: `sealed:${requestId}`,
      };
      this._emit('message', { data: JSON.stringify(['EVENT', subscription, wrappedEvent]) });
    }

    close() {
      this.closed = true;
    }

    _emit(name, event) {
      (this.handlers[name] || []).forEach(handler => handler(event));
    }
  }

  const signer = {
    getPublicKey: async () => sender,
    nip44: {
      encrypt: async () => '{}',
      decrypt: async (_peer, ciphertext) => {
        if (ciphertext.startsWith('sealed:')) {
          const sealedRequestId = ciphertext.replace('sealed:', '');
          const seal = {
            kind: 13,
            created_at: Math.floor(Date.now() / 1000),
            pubkey: service,
            tags: [['p', sender]],
            content: `rumor:${sealedRequestId}`,
          };
          return JSON.stringify(seal);
        }
        if (ciphertext.startsWith('rumor:')) {
          const rumorRequestId = ciphertext.replace('rumor:', '');
          const rumor = {
            pubkey: service,
            kind: 14,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', sender]],
            content: JSON.stringify({
              type: LIBVAULT_SEARCH_RESPONSE_TYPE,
              request_id: rumorRequestId,
              status: 'ready',
              books: [{ title: 'Good relay reply' }],
            }),
          };
          rumor.id = await nostrTools.getEventHash(rumor);
          return JSON.stringify(rumor);
        }
        return '{}';
      },
    },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
  };

  const response = await searchLibVault('books', 'title', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: service },
        relays: { [service]: relays },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(19),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: {
        v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(20) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        },
      },
      verifyEvent: () => true,
    }),
    publish: async () => {
      requestId = sentPayload?.request_id ?? '';
      for (const socket of sockets) {
        for (const subscription of socket.subscriptions) {
          socket.emitResponse(subscription);
        }
      }
      return true;
    },
    onTrace: trace => {
      if (trace.direction === 'sent') sentPayload = trace.payload;
    },
    WebSocketImpl: FakeWebSocket,
    responseTimeoutMs: 1000,
  });
  const sent = sentPayload;
  assert.ok(sent?.request_id);
  assert.equal(response.status, 'ready');
  assert.equal(response.books?.[0]?.title, 'Good relay reply');
});

test('searchLibVault ignores malformed events and resolves from a healthy relay', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  const sockets = [];
  let sentPayload;
  const relays = ['wss://relay.malformed.example', 'wss://relay.good.example'];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      this.subscriptions = new Set();
      this.live = false;
      sockets.push(this);
      setTimeout(() => this._emit('open'), 0);
    }

    addEventListener(name, handler) {
      (this.handlers[name] ||= []).push(handler);
    }

    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] !== 'REQ') return;
      const subscription = packet[1];
      this.subscriptions.add(subscription);
      if (this.url.includes('malformed')) {
        setTimeout(() => this._emit('message', { data: 'not-json' }), 0);
        setTimeout(() => this._emit('message', { data: JSON.stringify(['EOSE', subscription]) }), 0);
        return;
      }
      setTimeout(() => {
        this.live = true;
        this._emit('message', { data: JSON.stringify(['EOSE', subscription]) });
      }, 0);
    }

    emitResponse(subscription) {
      if (!this.live) {
        if (!this.url.includes('malformed')) setTimeout(() => this.emitResponse(subscription), 1);
        return;
      }
      const wrappedEvent = {
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: service,
        tags: [['p', sender]],
        content: `sealed:${sentPayload?.request_id ?? ''}`,
      };
      this._emit('message', { data: JSON.stringify(['EVENT', subscription, wrappedEvent]) });
    }

    close() {
      this.closed = true;
    }

    _emit(name, event) {
      (this.handlers[name] || []).forEach(handler => handler(event));
    }
  }

  const signer = {
    getPublicKey: async () => sender,
    nip44: {
      encrypt: async () => '{}',
      decrypt: async (_peer, ciphertext) => {
        if (ciphertext.startsWith('sealed:')) {
          const sealedRequestId = ciphertext.replace('sealed:', '');
          const seal = {
            kind: 13,
            created_at: Math.floor(Date.now() / 1000),
            pubkey: service,
            tags: [['p', sender]],
            content: `rumor:${sealedRequestId}`,
          };
          return JSON.stringify(seal);
        }
        if (ciphertext.startsWith('rumor:')) {
          const rumorRequestId = ciphertext.replace('rumor:', '');
          const rumor = {
            pubkey: service,
            kind: 14,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', sender]],
            content: JSON.stringify({
              type: LIBVAULT_SEARCH_RESPONSE_TYPE,
              request_id: rumorRequestId,
              status: 'ready',
              books: [{ title: 'Recovered relay reply' }],
            }),
          };
          rumor.id = await nostrTools.getEventHash(rumor);
          return JSON.stringify(rumor);
        }
        return '{}';
      },
    },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
  };

  const response = await searchLibVault('books', 'title', {
    signer,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: service },
        relays: { [service]: relays },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(21),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: {
        v2: {
          utils: { getConversationKey: () => new Uint8Array(32).fill(22) },
          encrypt: plaintext => `wrapped:${plaintext}`,
        },
      },
      verifyEvent: () => true,
    }),
    publish: async () => {
      for (const socket of sockets) {
        for (const subscription of socket.subscriptions) {
          socket.emitResponse(subscription);
        }
      }
      return true;
    },
    onTrace: trace => {
      if (trace.direction === 'sent') sentPayload = trace.payload;
    },
    WebSocketImpl: FakeWebSocket,
    responseTimeoutMs: 1000,
  });

  assert.ok(sentPayload?.request_id);
  assert.equal(response.status, 'ready');
  assert.equal(response.books?.[0]?.title, 'Recovered relay reply');
});

test('searchLibVault ignores malformed event payloads and resolves from valid event', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  const traces = [];
  const sockets = [];
  let sentPayload;
  const malformedPayload = 'malformed:event-payload';
  const wrappedPayloadMarker = 'wrap:ready';
  const sealedPayloadMarker = 'seal:ready';
  const responsePayload = {
    type: LIBVAULT_SEARCH_RESPONSE_TYPE,
    request_id: '',
    status: 'ready',
    books: [{ title: 'Recovered malformed payload reply' }],
  };

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      this.closed = false;
      this.subscriptions = new Set();
      sockets.push(this);
      setTimeout(() => this._emit('open'), 0);
    }

    addEventListener(name, handler) {
      (this.handlers[name] ||= []).push(handler);
    }

    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] === 'REQ') {
        const subscription = packet[1];
        this.subscriptions.add(subscription);

        setTimeout(() => {
          const malformed = {
            kind: 1059,
            pubkey: service,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', sender]],
            content: malformedPayload,
          };
          this._emit('message', { data: JSON.stringify(['EVENT', subscription, malformed]) });
        }, 0);
        setTimeout(() => {
          this.emitResponse(subscription);
        }, 1);
        setTimeout(() => this._emit('message', { data: JSON.stringify(['EOSE', subscription]) }), 2);
      }
    }

    emitResponse(subscription) {
      const wrappedEvent = {
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: service,
        tags: [['p', sender]],
        content: wrappedPayloadMarker,
      };
      this._emit('message', { data: JSON.stringify(['EVENT', subscription, wrappedEvent]) });
    }

    close() {
      this.closed = true;
    }

    _emit(name, event) {
      (this.handlers[name] || []).forEach(handler => handler(event));
    }
  }

  const response = await searchLibVault('books', 'title', {
    signer: {
      getPublicKey: async () => sender,
      nip44: {
        encrypt: async () => '{}',
        decrypt: async (_peer, ciphertext) => {
          if (ciphertext === wrappedPayloadMarker) {
            return JSON.stringify({
              kind: 13,
              created_at: Math.floor(Date.now() / 1000),
              pubkey: service,
              tags: [],
              content: sealedPayloadMarker,
            });
          }
          if (ciphertext === sealedPayloadMarker) {
            const rumor = {
              pubkey: service,
              created_at: Math.floor(Date.now() / 1000),
              kind: 14,
              tags: [['p', sender]],
              content: JSON.stringify({
                ...responsePayload,
                request_id: sentPayload?.request_id ?? '',
              }),
            };
            rumor.id = nostrTools.getEventHash(rumor);
            return JSON.stringify(rumor);
          }
          if (ciphertext === malformedPayload) return '{}';
          throw new Error('unexpected ciphertext');
        },
      },
      signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: service },
        relays: { [service]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(10),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(11) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => {
      for (const socket of sockets) {
        for (const subscription of socket.subscriptions) {
          socket.emitResponse(subscription);
        }
      }
      return true;
    },
    onTrace: trace => {
      traces.push(trace);
      if (trace.direction === 'sent') sentPayload = trace.payload;
    },
    WebSocketImpl: FakeWebSocket,
    responseTimeoutMs: 1000,
  });

  assert.equal(response.status, 'ready');
  assert.equal(response.books?.[0]?.title, 'Recovered malformed payload reply');
});

test('searchLibVault ignores non-object EVENT payload and resolves from a valid one', async () => {
  const sender = senderPubkey;
  const service = servicePubkey;
  const sockets = [];
  let sentPayload;

  class FakeWebSocket {
    constructor() {
      this.handlers = {};
      this.closed = false;
      this.subscriptions = new Set();
      sockets.push(this);
      setTimeout(() => this._emit('open'), 0);
    }

    addEventListener(name, handler) {
      (this.handlers[name] ||= []).push(handler);
    }

    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] === 'REQ') {
        const subscription = packet[1];
        this.subscriptions.add(subscription);
        setTimeout(() => this._emit('message', { data: JSON.stringify(['EVENT', subscription, 'not-an-object']) }), 0);
        setTimeout(() => this._emit('message', { data: JSON.stringify(['EOSE', subscription]) }), 1);
      }
    }

    emitResponse(subscription, requestID) {
      this._emit('message', { data: JSON.stringify(['EVENT', subscription, {
        kind: 1059,
        pubkey: service,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', sender]],
        content: `sealed:${requestID}`,
      }]) });
    }

    close() {
      this.closed = true;
    }

    _emit(name, event) {
      (this.handlers[name] || []).forEach(handler => handler(event));
    }
  }

  const response = await searchLibVault('books', 'title', {
    signer: {
      getPublicKey: async () => sender,
      nip44: {
        encrypt: async () => '{}',
        decrypt: async (_peer, ciphertext) => {
          const [kind, ...rest] = ciphertext.split(':');
          if (kind === 'sealed') return JSON.stringify({
            kind: 13,
            created_at: Math.floor(Date.now() / 1000),
            pubkey: service,
            tags: [['p', sender]],
            content: `rumor:${rest.join(':')}`,
          });
          if (kind === 'rumor') {
            const rumor = {
              kind: 14,
              created_at: Math.floor(Date.now() / 1000),
              pubkey: service,
              tags: [['p', sender]],
              content: JSON.stringify({
              type: LIBVAULT_SEARCH_RESPONSE_TYPE,
              request_id: rest.join(':'),
              status: 'ready',
              books: [{ title: 'Non-object payload ignored reply' }],
              }),
            };
            rumor.id = nostrTools.getEventHash(rumor);
            return JSON.stringify(rumor);
          }
          return '{}';
        },
      },
      signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: service },
        relays: { [service]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(7),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(8) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => {
      for (const socket of sockets) {
        for (const subscription of socket.subscriptions) {
          socket.emitResponse(subscription, sentPayload?.request_id ?? '');
        }
      }
      return true;
    },
    onTrace: trace => {
      if (trace.direction === 'sent') sentPayload = trace.payload;
    },
    WebSocketImpl: FakeWebSocket,
    responseTimeoutMs: 1000,
  });

  assert.ok(sentPayload?.request_id);
  assert.equal(response.status, 'ready');
  assert.equal(response.books?.[0]?.title, 'Non-object payload ignored reply');
});

test('searchLibVault clamps oversized limits to the maximum', async () => {
  const sender = senderPubkey;
  let capturedLimit;
  let sentPayload;
  const response = await searchLibVault('books', 'title', {
    signer: {
      getPublicKey: async () => sender,
      nip44: {
        encrypt: async () => '{}',
        decrypt: async () => '',
      },
      signEvent: async event => ({ ...event, id: 'seed', pubkey: sender, sig: 'signed' }),
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        names: { books: servicePubkey },
        relays: { [servicePubkey]: ['wss://relay.example'] },
      }),
    }),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(7),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(8) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => {
      if (trace.direction === 'sent') {
        sentPayload = trace.payload;
        capturedLimit = trace.payload.limit;
      }
    },
    listen: ({ requestID }) => ({
      ready: Promise.resolve(),
      arm: () => {},
      close: () => {},
      result: Promise.resolve({
        type: LIBVAULT_SEARCH_RESPONSE_TYPE,
        request_id: requestID,
        status: 'ready',
        books: [{ title: 'Limited Search' }],
      }),
    }),
    limit: 500,
  });

  assert.equal(capturedLimit, 200);
  assert.equal(sentPayload?.request_id?.length > 0, true);
  assert.equal(response.status, 'ready');
  assert.equal(response.books[0]?.title, 'Limited Search');
});

test('resolveLibVaultBook requests metadata only and returns LibGen torrent identifiers', async () => {
  const md5 = 'd'.repeat(32);
  let sentPayload;
  const result = await resolveLibVaultBook({ md5, title: 'Compact favorite' }, {
    signer: {
      getPublicKey: async () => senderPubkey,
      nip44: { encrypt: async () => '{}', decrypt: async () => '' },
      signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'signed' }),
    },
    fetchImpl: async () => discoveryResponse(),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(7),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(8) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    onTrace: trace => { if (trace.direction === 'sent') sentPayload = trace.payload; },
    listen: ({ requestID }) => ({
      ready: Promise.resolve(), arm: () => {}, close: () => {},
      result: Promise.resolve({
        type: LIBVAULT_RESOLVE_RESPONSE_TYPE,
        request_id: requestID,
        status: 'ready',
        book: { md5, id: 2412930, extension: 'pdf', filesize_bytes: 12345 },
      }),
    }),
  });

  assert.equal(sentPayload.type, LIBVAULT_RESOLVE_TYPE);
  assert.equal(sentPayload.book.md5, md5);
  assert.equal(result.id, 2412930);
  assert.equal(result.filesize_bytes, 12345);
});

test('resolveLibVaultBook rejects unavailable signers, relays, and unusable responses', async () => {
  const md5 = 'd'.repeat(32);
  const signer = {
    getPublicKey: async () => senderPubkey,
    nip44: { encrypt: async () => '{}', decrypt: async () => '' },
    signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'signed' }),
  };
  const options = response => ({
    signer,
    fetchImpl: async () => discoveryResponse(),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(7),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(8) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => true,
    listen: ({ requestID }) => ({
      ready: Promise.resolve(), arm: () => {}, close: () => {},
      result: Promise.resolve({ request_id: requestID, ...response }),
    }),
  });

  await assert.rejects(() => resolveLibVaultBook({ md5 }, {}), /Nostr signer with NIP-44 support/);
  await assert.rejects(() => resolveLibVaultBook({ md5 }, { signer }), /No Nostr relay publisher/);
  await assert.rejects(() => resolveLibVaultBook({ md5 }, {
    ...options({}), signer: { ...signer, getPublicKey: async () => 'invalid' },
  }), /invalid public key/);
  const noPublisher = options({});
  delete noPublisher.publish;
  await assert.rejects(() => resolveLibVaultBook({ md5 }, noPublisher), /No Nostr relay publisher/);
  await assert.rejects(() => resolveLibVaultBook({ md5 }, {
    ...options({}), publish: async () => false,
  }), /No relay accepted/);
  await assert.rejects(() => resolveLibVaultBook({ md5 }, options({
    type: 'wrong.type', status: 'ready', book: { md5, id: 1 },
  })), /response was invalid/);
  await assert.rejects(() => resolveLibVaultBook({ md5 }, options({
    type: LIBVAULT_RESOLVE_RESPONSE_TYPE, status: 'not_found', error: 'missing catalog record',
  })), /missing catalog record/);
  await assert.rejects(() => resolveLibVaultBook({ md5 }, options({
    type: LIBVAULT_RESOLVE_RESPONSE_TYPE, status: 'ready', book: { md5 },
  })), /usable LibGen torrent metadata/);
});

test('resolveLibVaultBook receives a metadata result through its default WebSocket listener', async () => {
  const md5 = 'e'.repeat(32);
  const sockets = [];
  let sentPayload;

  class FakeWebSocket {
    constructor() {
      this.handlers = {};
      this.subscriptions = new Set();
      sockets.push(this);
      setTimeout(() => this.emit('open'), 0);
    }
    addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); }
    send(message) {
      const packet = JSON.parse(message);
      if (packet?.[0] === 'REQ') {
        this.subscriptions.add(packet[1]);
        setTimeout(() => this.emit('message', { data: JSON.stringify(['EOSE', packet[1]]) }), 0);
      }
    }
    reply(subscription) {
      this.emit('message', { data: JSON.stringify(['EVENT', subscription, {
        kind: 1059, pubkey: servicePubkey, created_at: Math.floor(Date.now() / 1000),
        tags: [['p', senderPubkey]], content: 'resolve-wrap',
      }]) });
    }
    close() {}
    emit(name, event) { (this.handlers[name] || []).forEach(handler => handler(event)); }
  }

  const result = await resolveLibVaultBook({ md5 }, {
    signer: {
      getPublicKey: async () => senderPubkey,
      nip44: {
        encrypt: async () => '{}',
        decrypt: async (_peer, ciphertext) => {
          if (ciphertext === 'resolve-wrap') return JSON.stringify({
            kind: 13, pubkey: servicePubkey, created_at: Math.floor(Date.now() / 1000),
            tags: [], content: 'resolve-rumor',
          });
          const rumor = {
            kind: 14, pubkey: servicePubkey, created_at: Math.floor(Date.now() / 1000),
            tags: [['p', senderPubkey]],
            content: JSON.stringify({
              type: LIBVAULT_RESOLVE_RESPONSE_TYPE, request_id: sentPayload.request_id,
              status: 'ready', book: { md5, id: 2412930, extension: 'pdf', filesize_bytes: 12345 },
            }),
          };
          rumor.id = nostrTools.getEventHash(rumor);
          return JSON.stringify(rumor);
        },
      },
      signEvent: async event => ({ ...event, id: 'seed', pubkey: senderPubkey, sig: 'signed' }),
    },
    fetchImpl: async () => discoveryResponse(),
    loadTools: async () => ({
      generateSecretKey: () => new Uint8Array(32).fill(7),
      finalizeEvent: event => ({ ...event, id: 'wrap', pubkey: 'f'.repeat(64), sig: 'wrapped' }),
      nip19: { npubEncode: pubkey => `npub:${pubkey}` },
      nip44: { v2: { utils: { getConversationKey: () => new Uint8Array(32).fill(8) }, encrypt: plaintext => `wrapped:${plaintext}` } },
      verifyEvent: () => true,
    }),
    publish: async () => {
      for (const socket of sockets) for (const subscription of socket.subscriptions) socket.reply(subscription);
      return true;
    },
    onTrace: trace => { if (trace.direction === 'sent') sentPayload = trace.payload; },
    WebSocketImpl: FakeWebSocket,
    responseTimeoutMs: 1000,
  });

  assert.equal(result.md5, md5);
  assert.equal(result.id, 2412930);
});

test('libvaultBookRef ignores an invalid md5 and keeps normalized isbn', () => {
  const ref = libvaultBookRef({
    md5: 'ZZZZ',
    isbn: '978-1-2345-6789-0',
    title: ' Invalid md5 example ',
    author: 'Ada',
    source: 'openlibrary',
  });

  assert.equal(ref.md5, undefined);
  assert.equal(ref.isbn, '9781234567890');
  assert.equal(ref.title, 'Invalid md5 example');
  assert.equal(ref.author, 'Ada');
  assert.equal(ref.source, 'openlibrary');
});
