import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeRightsV2 } from '../../shared/rights/rights.mjs';

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
