import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicFileMetadataEvent, parsePublicFileMetadataEvent } from './publication-nip94-v1.mjs';

const pubkey = 'a'.repeat(64);
const sha256 = 'b'.repeat(64);
const allowed = { rights_status: 'public_domain', redistribution: 'allowed' };

test('creates compact NIP-94 metadata only for verified, opted-in open editions', () => {
  const event = createPublicFileMetadataEvent({
    operatorOptIn: true,
    verified: true,
    rights: allowed,
    url: 'https://downloads.example/edition.epub',
    urls: ['https://downloads.example/edition.epub', 'https://mirror.example/edition.epub'],
    sha256,
    size: 1234,
    format: 'epub',
    title: 'An Open Book',
    publicationId: 'gutenberg:1',
  }, { pubkey, now: 100 });
  assert.equal(event.kind, 1063);
  assert.deepEqual(event.tags.slice(0, 4), [
    ['url', 'https://downloads.example/edition.epub'],
    ['m', 'application/epub+zip'],
    ['x', sha256],
    ['size', '1234'],
  ]);
  assert.deepEqual(parsePublicFileMetadataEvent(event), {
    url: 'https://downloads.example/edition.epub', fallbacks: ['https://mirror.example/edition.epub'],
    sha256, size: 1234, mime: 'application/epub+zip', title: 'An Open Book', publicationId: 'gutenberg:1',
  });
});

test('rejects non-public, unverified, non-opted-in, and filesystem publication inputs', () => {
  const input = { rights: allowed, url: 'https://downloads.example/edition.epub', sha256, size: 1, format: 'epub' };
  assert.throws(() => createPublicFileMetadataEvent(input, { pubkey, now: 1 }), /not enabled/);
  assert.throws(() => createPublicFileMetadataEvent({ ...input, operatorOptIn: true }, { pubkey, now: 1 }), /completely verified/);
  assert.throws(() => createPublicFileMetadataEvent({ ...input, operatorOptIn: true, verified: true, rights: { rights_status: 'unknown' } }, { pubkey, now: 1 }), /rights policy/);
  assert.throws(() => createPublicFileMetadataEvent({ ...input, operatorOptIn: true, verified: true, url: 'file:///private/book.epub' }, { pubkey, now: 1 }), /HTTPS publication URL/);
  assert.equal(parsePublicFileMetadataEvent({ kind: 1063, content: '', tags: [['url', 'file:///private/book.epub'], ['x', sha256], ['m', 'application/epub+zip'], ['size', '1']] }), null);
});
