import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeRightsV2, publicSeedAllowed } from '../../shared/rights/rights.mjs';

const fixture = JSON.parse(await readFile(new URL('../../shared/fixtures/book-rights-v2.json', import.meta.url)));
const schema = JSON.parse(await readFile(new URL('../../shared/contracts/book-rights-v2.schema.json', import.meta.url)));

test('rights v2 fixture is versioned and complete', () => {
  assert.equal(fixture.version, 2);
  assert.ok(fixture.cases.length >= 1);
  for (const key of schema.required) assert.ok(Object.hasOwn(fixture.cases[0].expected, key), key);
});
test('portable rights adapter conforms to every shared v2 case', () => {
  for (const entry of fixture.cases) {
    const actual = normalizeRightsV2(entry.input);
    const nullable = value => value || null;
    assert.deepEqual({
      rights_status: actual.rights_status,
      license: nullable(actual.license),
      license_url: nullable(actual.license_url),
      rights_source: nullable(actual.rights_source),
      jurisdiction: nullable(actual.jurisdiction),
      redistribution: actual.redistribution,
      evidence_url: nullable(actual.evidence_url),
      attribution: nullable(actual.attribution),
      public_seed_allowed: actual.public_seed_allowed,
    }, entry.expected, entry.name);
  }
});

test('rights adapter safely handles malformed metadata and every inferred policy', () => {
  assert.deepEqual(normalizeRightsV2('not-an-object'), {
    rights_status: 'unknown', license: '', license_url: '', rights_source: '', jurisdiction: '', redistribution: 'unknown', evidence_url: '', attribution: '', public_seed_allowed: false,
  });
  const publicDomain = normalizeRightsV2({ metadata: '{bad', license: 'CC0', evidence_url: 'ftp://not-safe.example', copyright: false });
  assert.equal(publicDomain.rights_status, 'public_domain');
  assert.equal(publicDomain.redistribution, 'allowed');
  assert.equal(publicDomain.evidence_url, '');
  assert.equal(publicSeedAllowed({ rights: { status: 'open-license', redistribution: 'allowed' } }), true);
  assert.equal(publicSeedAllowed({ rights_status: 'copyright', license: 'All rights reserved' }), false);
  assert.equal(normalizeRightsV2({ license: 'CC BY-NC 4.0' }).redistribution, 'noncommercial');
  const contradictory = normalizeRightsV2({
    rights_status: 'copyrighted',
    license: 'All rights reserved. http://creativecommons.org/licenses/by-nc-sa/2.5/The online version is Creative Commons Noncommercial Sharealike.',
  });
  assert.equal(contradictory.rights_status, 'open_license');
  assert.equal(contradictory.license_url, 'http://creativecommons.org/licenses/by-nc-sa/2.5/');
  assert.equal(contradictory.redistribution, 'noncommercial');
  assert.equal(normalizeRightsV2({ license: 'Do not redistribute' }).redistribution, 'forbidden');
  const linked = normalizeRightsV2({ license: 'Open publication license (https://example.test/license).', metadata: { rightsSource: 'metadata', jurisdiction: 'EU', attribution: 'Author' } });
  assert.equal(linked.rights_status, 'open_license');
  assert.equal(linked.license_url, 'https://example.test/license');
  assert.equal(linked.rights_source, 'metadata');
  assert.equal(linked.jurisdiction, 'EU');
  assert.equal(linked.attribution, 'Author');
  assert.equal(normalizeRightsV2({ license_url: 'https://%' }).license_url, '');
});
