import assert from 'node:assert/strict';
import test from 'node:test';
import { listSourceDescriptors, publicSeedEligible, sourceDescriptor } from './source-registry.mjs';

test('v1 source registry includes legal multilingual torrent and text sources', () => {
  const sources = listSourceDescriptors();
  for (const id of ['propagate', 'ebooks-gratuits', 'wikisource']) assert.ok(sourceDescriptor(id));
  assert.equal(sourceDescriptor('propagate').delivery, 'native-torrent');
  assert.ok(sourceDescriptor('wikisource').languages.includes('ru'));
  assert.ok(sourceDescriptor('wikisource').languages.includes('zh'));
  assert.equal(sourceDescriptor('oapen').delivery, 'https');
  assert.equal(sources.length, new Set(sources.map(source => source.id)).size);
});
test('seeding is gated by item rights evidence', () => {
  assert.equal(publicSeedEligible({ source: 'propagate', rights_status: 'public_domain' }), true);
  assert.equal(publicSeedEligible({ source: 'wikisource', license: 'CC BY-NC 4.0', rights_status: 'open_license' }), false);
  assert.equal(publicSeedEligible({ source: 'wikisource', license: 'CC BY-SA 4.0', rights_status: 'open_license' }), true);
  assert.equal(publicSeedEligible({ source: 'wikisource', rights_status: 'unknown' }), false);
});
