import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

await import('../book-metadata.js');
const { normalizeRights } = globalThis.BookMetadata;

const fixture = JSON.parse(await readFile(new URL('../../shared/fixtures/book-rights-v1.json', import.meta.url)));
const schema = JSON.parse(await readFile(new URL('../../shared/contracts/book-rights-v1.schema.json', import.meta.url)));

function nullable(value) {
  return value || null;
}

test('book-rights fixture is versioned against the canonical schema', () => {
  assert.equal(fixture.version, schema.properties.version.const);
  assert.ok(fixture.cases.length >= schema.properties.cases.minItems);
  assert.deepEqual(
    schema.$defs.output.properties.rights_status.enum,
    ['public_domain', 'open_license', 'copyrighted', 'unknown'],
  );
  assert.equal(new Set(fixture.cases.map(entry => entry.name)).size, fixture.cases.length);
});

test('web rights adapter conforms to every shared v1 case', () => {
  for (const entry of fixture.cases) {
    const input = {
      rights_status: entry.input.status,
      license: entry.input.license,
      license_url: entry.input.license_url,
      rights_source: entry.input.rights_source,
      copyright: entry.input.copyright,
    };
    const actual = normalizeRights(input);
    assert.deepEqual({
      rights_status: actual.rights_status,
      license: nullable(actual.license),
      license_url: nullable(actual.license_url),
      rights_source: nullable(actual.rights_source),
    }, entry.expected, entry.name);
  }
});
