import assert from 'node:assert/strict';
import test from 'node:test';
import { listSourceDescriptors, publicSeedEligible, sourceDescriptor } from './source-registry.mjs';

test('v1 source registry includes legal multilingual torrent and text sources', () => {
  const sources = listSourceDescriptors();
  for (const id of ['propagate', 'ebooks-gratuits', 'wikisource']) assert.ok(sourceDescriptor(id));
  const propagate = sourceDescriptor('propagate');
  const wikisource = sourceDescriptor('wikisource');
  const oapen = sourceDescriptor('oapen');
  const litres = sourceDescriptor('litres-public-domain');
  assert.ok(propagate && wikisource && oapen && litres);
  assert.equal(propagate.delivery, 'native-torrent');
  assert.ok(wikisource.languages.includes('ru'));
  assert.ok(wikisource.languages.includes('zh'));
  assert.equal(oapen.delivery, 'https');
  assert.equal(litres.enabledInV1, false);
  assert.equal(sources.length, new Set(sources.map(source => source.id)).size);
});
test('seeding is gated by item rights evidence', () => {
  assert.equal(publicSeedEligible({ source: 'propagate', rights_status: 'public_domain' }), true);
  assert.equal(publicSeedEligible({ source: 'wikisource', license: 'CC BY-NC 4.0', rights_status: 'open_license' }), false);
  assert.equal(publicSeedEligible({ source: 'wikisource', license: 'CC BY-SA 4.0', rights_status: 'open_license' }), true);
  assert.equal(publicSeedEligible({ source: 'wikisource', rights_status: 'unknown' }), false);
});

test('source lookup and seed eligibility handle unknown and malformed descriptors', () => {
  assert.equal(sourceDescriptor('  FUTURE-SOURCE  '), null);
  assert.equal(sourceDescriptor(null), null);
  assert.equal(publicSeedEligible(null), false);
  assert.equal(publicSeedEligible([]), false);
  assert.equal(publicSeedEligible({ source: 'propagate', rights_status: 'open_license' }), true);
  assert.equal(publicSeedEligible({ provider: 'future-source', rights: { rights_status: 'public_domain', redistribution: 'allowed' } }), true);
});
