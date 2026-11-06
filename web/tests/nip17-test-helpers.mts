/// <reference path="../types/browser-globals.d.ts" />
/// <reference path="../types/migrated-esm-dependencies.d.ts" />

import assert from 'node:assert/strict';

export type NostrEventInput = {
  id?: string;
  pubkey?: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
};

export type NostrEventFixture = NostrEventInput & { pubkey: string };

export type NostrSignerFixture = {
  getPublicKey?: () => Promise<string> | string;
  signEvent?: (event: NostrEventInput) => Promise<NostrEventFixture> | NostrEventFixture;
  nip44?: {
    encrypt?: (peerPubkey: string, plaintext: string) => Promise<string> | string;
    decrypt?: (peerPubkey: string, ciphertext: string) => Promise<string> | string;
  };
};

export type NostrToolsFixture = {
  generateSecretKey?: () => Uint8Array;
  finalizeEvent?: (event: NostrEventInput, secretKey?: Uint8Array) => NostrEventFixture;
  verifyEvent?: (event: NostrEventFixture) => boolean;
  nip19?: { npubEncode?: (pubkey: string) => string };
  nip44?: {
    v2?: {
      utils?: { getConversationKey?: (secretKey: Uint8Array, pubkey: string) => Uint8Array };
      encrypt?: (plaintext: string, conversationKey: Uint8Array) => string;
      decrypt?: (ciphertext: string, conversationKey: Uint8Array) => string;
    };
  };
};

export type FetchResponseFixture = {
  ok?: boolean;
  status?: number;
  json?: () => Promise<unknown>;
};

export type TestRecord = Record<string, unknown>;

export type TestRequest = TestRecord & {
  type?: string;
  request_id?: string;
  query?: string;
  search_type?: string;
  limit?: number;
  offset?: number;
  book?: TestRecord;
  favorites?: string[];
  books?: TestRecord[];
};

export type TestRumor = TestRecord & {
  content: string;
  kind?: number;
  tags?: string[][];
  pubkey: string;
};

export type TestTrace = TestRecord & {
  direction?: string;
  recipient?: string;
  recipientNip05?: string;
  event?: NostrEventFixture;
  payload?: TestRequest;
};

export function testTrace(value: unknown): TestTrace {
  assert.ok(isTestRecord(value), 'Expected a trace record');
  assert.ok(value.direction === undefined || typeof value.direction === 'string', 'Expected a trace direction');
  const trace: TestTrace = { ...value };
  if (value.payload !== undefined) trace.payload = testRequest(value.payload);
  return trace;
}

export function isTestRecord(value: unknown): value is TestRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function testRequest(value: unknown): TestRequest {
  assert.ok(isTestRecord(value), 'Expected a request payload object');
  assert.ok(value.type === undefined || typeof value.type === 'string', 'Expected a string request type');
  assert.ok(value.request_id === undefined || typeof value.request_id === 'string', 'Expected a string request ID');
  assert.ok(value.query === undefined || typeof value.query === 'string', 'Expected a string query');
  assert.ok(value.search_type === undefined || typeof value.search_type === 'string', 'Expected a string search type');
  assert.ok(value.limit === undefined || typeof value.limit === 'number', 'Expected a numeric result limit');
  assert.ok(value.offset === undefined || typeof value.offset === 'number', 'Expected a numeric result offset');
  assert.ok(value.book === undefined || isTestRecord(value.book), 'Expected book details to be an object');
  return value;
}

export function searchBooks(value: TestRecord): TestRecord[] {
  const books = value.books;
  assert.ok(Array.isArray(books) && books.every(isTestRecord), 'Expected books to be an array of records');
  return books;
}

export function searchHits(value: TestRecord): Array<TestRecord & { citation: TestRecord & { snippet: string } }> {
  const hits = value.hits;
  assert.ok(Array.isArray(hits) && hits.every(hit => isTestRecord(hit) && isTestRecord(hit.citation) && typeof hit.citation.snippet === 'string'), 'Expected search hits to include citation snippets');
  return hits;
}

export async function fetchResponse(fixture: FetchResponseFixture): Promise<Response> {
  const status = fixture.status ?? (fixture.ok === false ? 500 : 200);
  const body = fixture.json ? JSON.stringify(await fixture.json()) : null;
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

export function signerFixture(fixture: NostrSignerFixture): MigratedNostrSigner {
  return {
    getPublicKey: fixture.getPublicKey ?? (() => ''),
    signEvent: async event => fixture.signEvent
      ? await fixture.signEvent(event)
      : { ...event, pubkey: event.pubkey ?? '' },
    nip44: {
      encrypt: fixture.nip44?.encrypt ?? (() => { throw new Error('Fixture NIP-44 encrypt was not configured'); }),
      decrypt: fixture.nip44?.decrypt ?? (() => { throw new Error('Fixture NIP-44 decrypt was not configured'); }),
    },
  };
}

export function toolsFixture(fixture: NostrToolsFixture): MigratedNostrTools {
  return {
    generateSecretKey: fixture.generateSecretKey ?? (() => new Uint8Array(32)),
    finalizeEvent: fixture.finalizeEvent ?? (event => ({ ...event, pubkey: event.pubkey ?? '' })),
    verifyEvent: fixture.verifyEvent ?? (() => true),
    ...(fixture.nip19 ? { nip19: { npubEncode: fixture.nip19.npubEncode ?? (pubkey => pubkey) } } : {}),
    nip44: {
      v2: {
        utils: {
          getConversationKey: fixture.nip44?.v2?.utils?.getConversationKey ?? (() => new Uint8Array(32)),
        },
        encrypt: fixture.nip44?.v2?.encrypt ?? (plaintext => plaintext),
        decrypt: fixture.nip44?.v2?.decrypt ?? (() => { throw new Error('Fixture NIP-44 decrypt was not configured'); }),
      },
    },
  };
}
