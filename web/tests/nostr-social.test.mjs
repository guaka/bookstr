import test from 'node:test';
import assert from 'node:assert/strict';

await import('../nostr-social.js');
const {
  latestFollowEvent,
  followsFromEvent,
  latestProfiles,
  nip05Parts,
  nip05Matches,
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

test('keeps the newest kind-0 profile for each followed user', () => {
  assert.deepEqual(latestProfiles([
    { id: 'old', kind: 0, pubkey: alice, created_at: 10, content: JSON.stringify({ name: 'Old' }) },
    { id: 'new', kind: 0, pubkey: alice, created_at: 20, content: JSON.stringify({ display_name: 'Alice', nip05: 'Alice@Example.com', picture: 'https://example.com/alice.jpg' }) },
    { id: 'stranger', kind: 0, pubkey: owner, created_at: 30, content: JSON.stringify({ name: 'Owner' }) },
  ], [alice]), [{
    pubkey: alice,
    name: 'Alice',
    about: '',
    picture: 'https://example.com/alice.jpg',
    nip05: 'Alice@Example.com',
    createdAt: 20,
  }]);
});

test('builds NIP-05 lookup URLs and verifies the returned pubkey', () => {
  assert.deepEqual(nip05Parts('Alice@Example.com'), {
    address: 'alice@example.com',
    name: 'alice',
    url: 'https://example.com/.well-known/nostr.json?name=alice',
  });
  assert.equal(nip05Parts('not-an-address'), null);
  assert.equal(nip05Matches({ names: { ALICE: alice.toUpperCase() } }, 'alice', alice), true);
  assert.equal(nip05Matches({ names: { alice: bob } }, 'alice', alice), false);
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
