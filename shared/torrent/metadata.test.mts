import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bencode,
  infoHashV1,
  privateTorrentDescriptor,
  publicTorrentDescriptor,
} from './metadata.mjs';

const sha256 = 'a'.repeat(64);

test('public metadata is deterministic and uses only browser-compatible trackers', () => {
  const first = publicTorrentDescriptor({ sha256, size: 1234, extension: 'EPUB' });
  const second = publicTorrentDescriptor({ sha256, size: 1234, extension: 'epub', trackers: [...first.announce].reverse() });
  assert.deepEqual(first.info, second.info);
  assert.deepEqual(first.announce, ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev']);
  assert.equal(first.info.name, `${sha256}.epub`);
  assert.equal(first.info['piece length'], 262144);
  assert.match(first.info.source, /^bookstr-public-v1:/);
});
test('torrent info hash ignores announce and descriptor-only fields', () => {
  const a = publicTorrentDescriptor({ sha256, size: 1234, trackers: ['wss://tracker.openwebtorrent.com'] });
  const b = publicTorrentDescriptor({ sha256, size: 1234, trackers: ['wss://tracker.webtorrent.dev'] });
  assert.equal(infoHashV1(a.info), infoHashV1(b.info));
  assert.equal(bencode({ b: 'x', a: 1 }).toString(), 'd1:ai1e1:b1:xe');
});

test('private metadata is account-scoped and has no discovery trackers', () => {
  const first = privateTorrentDescriptor({ sha256, size: 10, syncSecret: 'account-one' });
  const second = privateTorrentDescriptor({ sha256, size: 10, syncSecret: 'account-two' });
  assert.deepEqual(first.announce, []);
  assert.equal(first.info.private, 1);
  assert.notEqual(first.info.source, second.info.source);
  assert.notEqual(infoHashV1(first.info), infoHashV1(second.info));
});

test('metadata rejects unsafe or incomplete identifiers', () => {
  assert.throws(() => publicTorrentDescriptor({ sha256: 'bad', size: 1 }), /sha256/);
  assert.throws(() => publicTorrentDescriptor({ sha256, size: -1 }), /size/);
  assert.throws(() => privateTorrentDescriptor({ sha256, size: 1 }), /syncSecret/);
});
