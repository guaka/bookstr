import test from 'node:test';
import assert from 'node:assert/strict';

await import('../nostr-social.js');
const {
  latestFollowEvent,
  followsFromEvent,
  latestProfiles,
  nip05Parts,
  nip05Matches,
  nip42AuthTemplate,
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
  assert.deepEqual(nip05Parts('Alice@trustroots.org'), {
    address: 'alice@trustroots.org',
    name: 'alice',
    url: 'https://www.trustroots.org/.well-known/nostr.json?name=alice',
  });
  assert.equal(nip05Parts('not-an-address'), null);
  assert.equal(nip05Matches({ names: { ALICE: alice.toUpperCase() } }, 'alice', alice), true);
  assert.equal(nip05Matches({ names: { alice: bob } }, 'alice', alice), false);
});

test('builds a NIP-42 authentication event for the challenged relay', () => {
  assert.deepEqual(nip42AuthTemplate('wss://nip42.trustroots.org', 'challenge-value', 123), {
    kind: 22242,
    created_at: 123,
    tags: [
      ['relay', 'wss://nip42.trustroots.org'],
      ['challenge', 'challenge-value'],
    ],
    content: '',
  });
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

test('latestFollowEvent returns null when followed pubkey is missing or lowercase normalization is needed', () => {
  const latest = latestFollowEvent([
    { id: 'older', kind: 3, pubkey: alice.toUpperCase(), created_at: 11, id: 'older' },
    { id: 'newest', kind: 3, pubkey: 'invalid', created_at: 12 },
  ], alice);
  assert.equal(latest.id, 'older');
  assert.equal(latest.pubkey, alice);
});

test('followsFromEvent preserves only valid pubkeys and valid relay URLs', () => {
  const follows = followsFromEvent({ tags: [
    ['p', alice, 'ws://relay.example'], // invalid scheme should be dropped
    ['p', bob, 'wss://relay.example', 'Bob'],
  ]});
  assert.deepEqual(follows, [{ pubkey: bob, relay: 'wss://relay.example', petname: 'Bob' }]);
});

test('publicBookLists defaults list title when title tag is missing', () => {
  const lists = publicBookLists([
    { id: 'only', kind: 30003, pubkey: alice, created_at: 100, tags: [['d', 'missing-title'], ['i', 'isbn:9780765382030']] },
  ], [alice]);
  assert.equal(lists[0].title, 'Book list');
  assert.equal(lists[0].eventId, 'only');
});

test('latestProfiles ignores malformed json profiles and out-of-order same-timestamp events', () => {
  assert.deepEqual(latestProfiles([
    { id: 'high', kind: 0, pubkey: alice, created_at: 10, content: '{invalid' },
    { id: 'tie2', kind: 0, pubkey: alice, created_at: 20, content: JSON.stringify({ name: 'Alice', picture: 'bad-uri' }) },
    { id: 'tie1', kind: 0, pubkey: alice, created_at: 20, content: JSON.stringify({ name: 'Alice Older' }) },
  ], [alice]).map(profile => profile.name), ['Alice']);
});

test('latestFollowEvent uses lexicographic tie-break between same-timestamp events', () => {
  const latest = latestFollowEvent([
    { id: 'a_lower', kind: 3, pubkey: owner, created_at: 40, tags: [] },
    { id: 'z_upper', kind: 3, pubkey: owner, created_at: 40, tags: [] },
    { id: 'middle', kind: 3, pubkey: owner, created_at: 39, tags: [] },
  ], owner);
  assert.equal(latest.id, 'z_upper');
});
