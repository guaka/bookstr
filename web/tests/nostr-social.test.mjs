import test from 'node:test';
import assert from 'node:assert/strict';

await import('../nostr-social.js');
const {
  latestFollowEvent,
  followsFromEvent,
  latestProfiles,
  profileFromEvent,
  trustrootsProfiles,
  trustrootsUsernameFromEvent,
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

test('returns null when no matching follow event exists', () => {
  assert.equal(latestFollowEvent('not-an-array', owner), null);
  assert.equal(latestFollowEvent([], owner), null);
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

test('followsFromEvent ignores invalid tags and keeps distinct normalized pubkeys', () => {
  const follows = followsFromEvent({ tags: [
    ['x', alice, 'wss://relay.example'],
    ['p', alice.toUpperCase(), 'wss://relay.example', 'Alice'],
    ['p', alice, 'ws://untrusted.example', 'Duplicate Alice'],
    ['p', 'bad-pubkey', 'wss://relay.example', 'Not valid'],
    ['p', alice, 'wss://trusted.example', 'Alice again'],
  ]});
  assert.deepEqual(follows, [{ pubkey: alice, relay: 'wss://relay.example', petname: 'Alice' }]);
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

test('keeps the latest profile on ties by lexicographic id and ignores malformed payloads', () => {
  assert.deepEqual(latestProfiles([
    { id: 'a', kind: 0, pubkey: alice, created_at: 20, content: JSON.stringify({ name: 'Alpha' }) },
    { id: 'z', kind: 0, pubkey: alice, created_at: 20, content: JSON.stringify({ name: 'Zulu' }) },
    { id: 'invalid', kind: 0, pubkey: alice, created_at: 20, content: '{invalid-json}' },
  ], [alice]).map(profile => profile.name), ['Zulu']);
});

test('normalizes malformed profile payloads and ignores non-http portrait URLs', () => {
  assert.deepEqual(profileFromEvent({
    kind: 0,
    pubkey: alice,
    created_at: 1,
    content: '{invalid-json',
    petname: 'Alice',
    picture: 'ftp://books.test/cover.jpg',
  }), {
    pubkey: alice,
    name: '',
    about: '',
    picture: '',
    nip05: '',
    createdAt: 1,
  });
});

test('extracts Trustroots usernames only with valid namespace tags', () => {
  assert.equal(trustrootsUsernameFromEvent({
    tags: [
      ['l', 'Alice', 'org.trustroots:username'],
      ['l', 'Another', 'org.trustroots:other'],
    ],
  }), 'alice');
  assert.equal(trustrootsUsernameFromEvent({
    tags: [['l', 'Bad Name!', 'org.trustroots:username']],
  }), '');
  assert.equal(trustrootsUsernameFromEvent({
    tags: [['l', 'alice', 'org.trustroots']],
  }), '');
});

test('trustrootsProfiles keeps claim fallback identities when claim payload is malformed', () => {
  const importer = 'd'.repeat(64);
  const profiles = trustrootsProfiles([
    { id: 'base', kind: 0, pubkey: alice, created_at: 30, content: JSON.stringify({ name: 'Alice Profile' }) },
    { id: 'identity', kind: 10390, pubkey: alice, created_at: 40, tags: [['l', 'Alice', 'org.trustroots:username']], content: JSON.stringify({ display_name: 'Alice Profile' }) },
    { id: 'claim', kind: 30390, pubkey: alice, created_at: 50, tags: [], content: '{ invalid' },
  ], [alice], importer);
  assert.deepEqual(profiles, [{
    pubkey: alice,
    name: 'Alice Profile',
    about: '',
    picture: '',
    nip05: 'alice@trustroots.org',
    createdAt: 50,
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
  assert.equal(nip05Matches({}, 'alice', alice), false);
  assert.equal(nip05Parts('Alice@localhost:8080'), null);
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
  assert.equal(hasPublicBookReference([['libvault-book', '', 'Missing value']]), false);
  assert.equal(hasPublicBookReference([['book', 'not-a-type', 'openlibrary:OL1M']]), false);
});

test('keeps the newest public book list per author and address', () => {
  const lists = publicBookLists([
    { id: 'old', kind: 30003, pubkey: alice, created_at: 10, tags: [['d', 'reading'], ['title', 'Old'], ['i', 'isbn:9780765382030']] },
    { id: 'new', kind: 30003, pubkey: alice, created_at: 20, tags: [['d', 'reading'], ['title', 'Reading'], ['book', 'bookstr', 'book:1']] },
    { id: 'other', kind: 30003, pubkey: bob, created_at: 30, tags: [['d', 'articles'], ['e', 'f'.repeat(64)]] },
  ], [alice, bob]);
  assert.deepEqual(lists, [{ pubkey: alice, title: 'Reading', createdAt: 20, eventId: 'new' }]);
});

test('filters public book lists to followed users and private collections', () => {
  const lists = publicBookLists([
    { id: 'followed', kind: 30003, pubkey: alice, created_at: 10, tags: [['d', 'reading'], ['title', 'Reading'], ['book', 'bookstr', 'book:1']] },
    { id: 'private', kind: 30003, pubkey: alice, created_at: 12, tags: [['d', 'libvault-favorites'], ['title', 'Private'], ['book', 'bookstr', 'book:2']] },
    { id: 'private-chunk', kind: 30003, pubkey: alice, created_at: 13, tags: [['d', 'bookstr-collection-secret'], ['title', 'Private chunk'], ['book', 'bookstr', 'book:2']] },
    { id: 'unfollowed', kind: 30003, pubkey: owner, created_at: 14, tags: [['d', 'reading'], ['title', 'Unfollowed'], ['book', 'bookstr', 'book:3']] },
    { id: 'notlist', kind: 30001, pubkey: alice, created_at: 16, tags: [['d', 'other'], ['title', 'Wrong kind'], ['book', 'bookstr', 'book:4']] },
  ], [alice]);
  assert.deepEqual(lists, [{ pubkey: alice, title: 'Reading', createdAt: 10, eventId: 'followed' }]);
});

test('nip05Parts rejects malformed NIP-05 identifiers', () => {
  assert.equal(nip05Parts('alice@%GG.com'), null);
  assert.equal(nip05Parts('alice@localhost:443'), null);
});

test('nip05Matches requires a valid expected pubkey and names map', () => {
  assert.equal(nip05Matches({ not: 'object' }, 'alice', alice), false);
  assert.equal(nip05Matches({ names: { ALICE: 'not-a-hex' } }, 'ALICE', alice), false);
});

test('publicBookLists applies fallback title and filters non-list tags', () => {
  const lists = publicBookLists([
    { id: 'missing', kind: 30003, pubkey: alice, created_at: 10, tags: [['d', 'reading'], ['book', 'bookstr', 'book:1']] },
    { id: 'skip', kind: 30001, pubkey: alice, created_at: 20, tags: [['d', 'wrong-kind'], ['title', 'Wrong']] },
    { id: 'invalid', kind: 30003, pubkey: owner, created_at: 30, tags: [] },
  ], [alice]);
  assert.deepEqual(lists, [{
    pubkey: alice,
    title: 'Book list',
    createdAt: 10,
    eventId: 'missing',
  }]);
});

test('keeps arbitrary public NIP-51 lists from followed people', () => {
  const lists = publicNip51Lists([
    { id: 'old', kind: 30001, pubkey: alice, created_at: 10, tags: [['d', 'links'], ['title', 'Old links']] },
    { id: 'new', kind: 30001, pubkey: alice, created_at: 20, tags: [['d', 'links'], ['title', 'Interesting links']] },
    { id: 'bookmark', kind: 30003, pubkey: bob, created_at: 30, tags: [['d', 'bookmarks'], ['title', 'Bookmarks']] },
    { id: 'other', kind: 30001, pubkey: owner, created_at: 40, tags: [['d', 'private'], ['title', 'Ignore']] },
    { id: 'fallback', kind: 30002, pubkey: bob, created_at: 35, tags: [['d', 'fallback']] },
    { id: 'unsupported', kind: 29999, pubkey: alice, created_at: 50, tags: [['d', 'unsupported'], ['title', 'Skip me']] },
  ], [alice, bob]);
  assert.deepEqual(lists, [
    { pubkey: bob, title: 'fallback', kind: 30002, createdAt: 35, eventId: 'fallback' },
    { pubkey: bob, title: 'Bookmarks', kind: 30003, createdAt: 30, eventId: 'bookmark' },
    { pubkey: alice, title: 'Interesting links', kind: 30001, createdAt: 20, eventId: 'new' },
  ]);
});

test('latestFollowEvent resolves ties by lexicographically larger ids', () => {
  assert.equal(
    latestFollowEvent([
      { kind: 3, id: 'aaa', pubkey: owner, created_at: 10, tags: [] },
      { kind: 3, id: 'zzz', pubkey: owner, created_at: 10, tags: [] },
      { kind: 3, id: 'bbb', pubkey: bob, created_at: 11, tags: [] },
    ], owner).id,
    'zzz',
  );
});

test('publicBookLists ignores malformed entries and still returns the best available title', () => {
  const lists = publicBookLists([
    { id: 'bad', kind: 30003, pubkey: alice, created_at: 40, tags: [] },
    { id: 'good', kind: 30003, pubkey: alice, created_at: 41, tags: [['d', 'reading'], ['book', 'libvault', 'book:1']] },
  ], [alice]);
  assert.deepEqual(lists, [{ pubkey: alice, title: 'Book list', createdAt: 41, eventId: 'good' }]);
});

test('trustrootsProfiles accepts a valid claim without `p` tags by targeting the publisher', () => {
  const profiles = trustrootsProfiles([
    {
      id: 'claim',
      kind: 30390,
      pubkey: alice,
      created_at: 20,
      tags: [],
      content: JSON.stringify({
        display_name: 'Alice Claim',
        about: 'Imported via Trustroots claim',
        picture: 'https://example.test/picture.jpg',
      }),
    },
  ], [alice], 'd'.repeat(64));

  assert.deepEqual(profiles, [{
    pubkey: alice,
    name: 'Alice Claim',
    about: 'Imported via Trustroots claim',
    picture: 'https://example.test/picture.jpg',
    nip05: '',
    createdAt: 20,
  }]);
});

test('latestFollowEvent returns null when requested author id is invalid', () => {
  assert.equal(latestFollowEvent([
    { id: 'ok', kind: 3, pubkey: owner, created_at: 10, tags: [] },
  ], 'not-a-key'), null);
});

test('hasPublicBookReference rejects unsupported `i` tag identifiers', () => {
  assert.equal(hasPublicBookReference([['i', 'not-an-isbn-tag']]), false);
});

test('uses an empty key as the NIP-51 address when `d` is missing', () => {
  const lists = publicNip51Lists([
    {
      id: 'missing-d',
      kind: 30001,
      pubkey: alice,
      created_at: 10,
      tags: [
        ['title', 'Fallback NIP-51 list'],
        ['bookstr-book', 'fallback', 'fallback'],
      ],
    },
  ], [alice]);

  assert.deepEqual(lists, [{
    pubkey: alice,
    title: 'Fallback NIP-51 list',
    kind: 30001,
    createdAt: 10,
    eventId: 'missing-d',
  }]);
});

test('trustrootsProfiles reads the Trustroots username from a claim event', () => {
  const importer = 'd'.repeat(64);
  const profiles = trustrootsProfiles([
    {
      id: 'claim',
      kind: 30390,
      pubkey: alice,
      created_at: 20,
      tags: [['p', alice], ['l', 'AliceClaim', 'org.trustroots:username']],
      content: JSON.stringify({ name: 'Alice Claim', about: 'Claimed user', picture: 'https://example.test/picture.jpg' }),
    },
  ], [alice], importer);

  assert.equal(profiles[0].name, 'Alice Claim');
  assert.equal(profiles[0].nip05, 'aliceclaim@trustroots.org');
  assert.equal(profiles[0].picture, 'https://example.test/picture.jpg');
});

test('publicBookLists ignores events without a d-tag but still keeps valid entries', () => {
  const lists = publicBookLists([
    {
      id: 'no-id',
      kind: 30003,
      pubkey: alice,
      created_at: 7,
      tags: [['book', 'bookstr', 'book:plain']],
    },
  ], [alice]);

  assert.deepEqual(lists, [{
    pubkey: alice,
    title: 'Book list',
    createdAt: 7,
    eventId: 'no-id',
  }]);
});

test('publicNip51Lists keeps the latest duplicate list per namespace', () => {
  const lists = publicNip51Lists([
    { id: 'older', kind: 30003, pubkey: alice, created_at: 1, tags: [['d', 'collection'], ['title', 'Older Collection'], ['book', 'bookstr', 'book:1']] },
    { id: 'newer', kind: 30003, pubkey: alice, created_at: 20, tags: [['d', 'collection'], ['title', 'Newer Collection'], ['book', 'bookstr', 'book:1']] },
    { id: 'other', kind: 30003, pubkey: alice, created_at: 3, tags: [['d', 'other'], ['title', 'Other'], ['book', 'libvault', 'book:2']] },
  ], [alice]);

  assert.deepEqual(lists, [
    { pubkey: alice, title: 'Newer Collection', kind: 30003, createdAt: 20, eventId: 'newer' },
    { pubkey: alice, title: 'Other', kind: 30003, createdAt: 3, eventId: 'other' },
  ]);
});

test('publicNip51Lists orders newest supported lists first', () => {
  const lists = publicNip51Lists([
    { id: 'older-books', kind: 30001, pubkey: alice, created_at: 2, tags: [['d', 'books'], ['title', 'Older Books'], ['book', 'bookstr', 'book:1']] },
    { id: 'latest-links', kind: 30001, pubkey: alice, created_at: 12, tags: [['d', 'links'], ['title', 'Latest Links'], ['book', 'bookstr', 'book:2']] },
    { id: 'most-recent', kind: 30002, pubkey: alice, created_at: 10, tags: [['d', 'articles'], ['title', 'Most Recent'], ['book', 'bookstr', 'book:3']] },
    { id: 'replaced-links', kind: 30001, pubkey: alice, created_at: 20, tags: [['d', 'links'], ['title', 'Replaced Links'], ['book', 'bookstr', 'book:4']] },
  ], [alice]);

  assert.deepEqual(lists.map(list => list.eventId), ['replaced-links', 'most-recent', 'older-books']);
});
