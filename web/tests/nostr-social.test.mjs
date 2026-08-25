import test from 'node:test';
import assert from 'node:assert/strict';

await import('../nostr-social.js');
const {
  latestFollowEvent,
  followsFromEvent,
  latestProfiles,
  trustrootsProfiles,
  nip05Parts,
  nip05Matches,
  nip42AuthTemplate,
  hasPublicBookReference,
  publicBookLists,
  publicNip51Lists,
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

test('uses authenticated Trustroots profile kinds as kind-0 fallbacks', () => {
  const importer = 'd'.repeat(64);
  const profiles = trustrootsProfiles([
    { id: 'zero', kind: 0, pubkey: alice, created_at: 30, content: JSON.stringify({ name: 'Nostr Alice', about: 'Nostr about' }) },
    { id: 'identity', kind: 10390, pubkey: alice, created_at: 40, tags: [['l', 'Alice', 'org.trustroots:username']] },
    { id: 'claim', kind: 30390, pubkey: importer, created_at: 20, tags: [['p', alice]], content: JSON.stringify({ display_name: 'Imported Alice', about: 'Imported about', picture: 'https://www.trustroots.org/uploads-profile/id/avatar/256.jpg' }) },
    { id: 'spoof', kind: 30390, pubkey: bob, created_at: 99, tags: [['p', alice]], content: JSON.stringify({ name: 'Spoof' }) },
  ], [alice], importer);
  assert.deepEqual(profiles, [{
    pubkey: alice,
    name: 'Nostr Alice',
    about: 'Nostr about',
    picture: 'https://www.trustroots.org/uploads-profile/id/avatar/256.jpg',
    nip05: 'alice@trustroots.org',
    createdAt: 40,
  }]);
});

test('renders an imported profile when no kind-0 event exists', () => {
  const importer = 'd'.repeat(64);
  assert.deepEqual(trustrootsProfiles([
    { id: 'claim', kind: 30390, pubkey: importer, created_at: 20, tags: [['p', bob], ['l', 'Bob', 'org.trustroots:username']], content: JSON.stringify({ display_name: 'Bob Traveler', nip05: 'bob@trustroots.org' }) },
  ], [bob], importer), [{
    pubkey: bob,
    name: 'Bob Traveler',
    about: '',
    picture: '',
    nip05: 'bob@trustroots.org',
    createdAt: 20,
  }]);
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

test('keeps arbitrary public NIP-51 lists from followed people', () => {
  const lists = publicNip51Lists([
    { id: 'old', kind: 30001, pubkey: alice, created_at: 10, tags: [['d', 'links'], ['title', 'Old links']] },
    { id: 'new', kind: 30001, pubkey: alice, created_at: 20, tags: [['d', 'links'], ['title', 'Interesting links']] },
    { id: 'bookmark', kind: 30003, pubkey: bob, created_at: 30, tags: [['d', 'bookmarks'], ['title', 'Bookmarks']] },
    { id: 'other', kind: 30001, pubkey: owner, created_at: 40, tags: [['d', 'private'], ['title', 'Ignore']] },
  ], [alice, bob]);
  assert.deepEqual(lists, [
    { pubkey: bob, title: 'Bookmarks', kind: 30003, createdAt: 30, eventId: 'bookmark' },
    { pubkey: alice, title: 'Interesting links', kind: 30001, createdAt: 20, eventId: 'new' },
  ]);
});
