import test from 'node:test';
import assert from 'node:assert/strict';

await import('../nostr-social.js');
const {
  latestFollowEvent,
  followsFromEvent,
  hasPublicBookReference,
  publicBookLists,
} = globalThis.NostrSocial;

const owner = 'a'.repeat(64);
const alice = 'b'.repeat(64);
const bob = 'c'.repeat(64);

test('selects the latest kind-3 event from the connected user', () => {
  const latest = latestFollowEvent([
    { id: 'old', kind: 3, pubkey: owner, created_at: 10, tags: [] },
    { id: 'other', kind: 3, pubkey: bob, created_at: 30, tags: [] },
    { id: 'new', kind: 3, pubkey: owner, created_at: 20, tags: [] },
  ], owner);
  assert.equal(latest.id, 'new');
});

test('parses valid followed pubkeys once and preserves NIP-02 metadata', () => {
  assert.deepEqual(followsFromEvent({ tags: [
    ['p', alice.toUpperCase(), 'wss://relay.example', 'Alice'],
    ['p', alice, 'wss://duplicate.example', 'Duplicate'],
    ['p', 'invalid'],
    ['p', bob, 'not-a-relay', 'Bob'],
  ] }), [
    { pubkey: alice, relay: 'wss://relay.example', petname: 'Alice' },
    { pubkey: bob, relay: '', petname: 'Bob' },
  ]);
});

test('recognizes public book references without treating generic bookmarks as books', () => {
  assert.equal(hasPublicBookReference([['i', 'isbn:9780765382030']]), true);
  assert.equal(hasPublicBookReference([['book', 'bookstr', 'openlibrary:OL1M']]), true);
  assert.equal(hasPublicBookReference([['libvault-book', 'd'.repeat(32), 'Title']]), true);
  assert.equal(hasPublicBookReference([['e', 'e'.repeat(64)], ['title', 'Articles']]), false);
});

test('keeps the newest public book list per author and address', () => {
  const lists = publicBookLists([
    { id: 'old', kind: 30003, pubkey: alice, created_at: 10, tags: [['d', 'reading'], ['title', 'Old'], ['i', 'isbn:9780765382030']] },
    { id: 'new', kind: 30003, pubkey: alice, created_at: 20, tags: [['d', 'reading'], ['title', 'Reading'], ['book', 'bookstr', 'book:1']] },
    { id: 'other', kind: 30003, pubkey: bob, created_at: 30, tags: [['d', 'articles'], ['e', 'f'.repeat(64)]] },
  ], [alice, bob]);
  assert.deepEqual(lists, [{ pubkey: alice, title: 'Reading', createdAt: 20, eventId: 'new' }]);
});
