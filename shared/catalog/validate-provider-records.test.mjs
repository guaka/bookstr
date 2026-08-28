import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateProviderRecords } from './validate-provider-records.mjs';

const fixture = JSON.parse(await readFile(new URL('./provider-records.json', import.meta.url)));

test('provider catalog fixtures conform to the versioned contract', () => {
  assert.deepEqual(validateProviderRecords(fixture), []);
});

test('validator reports document, record, identity, and collection errors', () => {
  assert.deepEqual(validateProviderRecords(null), ['$: must be an object']);
  assert.deepEqual(validateProviderRecords({ version: 2, records: [] }), ['version: must be 1', 'records: must be a non-empty array']);
  const invalid = {
    version: 1,
    records: [
      null,
      {
        provider: '', recordId: 'a', publicationId: 'wrong', title: '', authors: [''], languages: ['english'], rights: {},
        acquisitions: [{ format: 'mobi', url: 'not a url', availability: 'free' }, null],
      },
      { provider: 'empty', recordId: '1', publicationId: 'empty:1', title: 'Empty', authors: [], languages: [], rights: { status: 'unknown' }, acquisitions: [] },
      { ...fixture.records[0] },
      { ...fixture.records[0] },
    ],
  };
  const errors = validateProviderRecords(invalid);
  assert.ok(errors.includes('records[0]: must be an object'));
  assert.ok(errors.includes('records[1].provider: must be a non-empty string'));
  assert.ok(errors.includes('records[1].publicationId: must be provider:recordId'));
  assert.ok(errors.includes('records[1].authors: must be an array of names'));
  assert.ok(errors.includes('records[1].languages: must be ISO language codes'));
  assert.ok(errors.includes('records[1].rights.status: must be a known status'));
  assert.ok(errors.includes('records[1].acquisitions[0].format: must be epub or pdf'));
  assert.ok(errors.includes('records[1].acquisitions[0].url: must be an absolute HTTP(S) URL'));
  assert.ok(errors.includes('records[1].acquisitions[0].availability: must be a known availability'));
  assert.ok(errors.includes('records[1].acquisitions[1]: must be an object'));
  assert.ok(errors.includes('records[2].acquisitions: must be a non-empty array'));
  assert.ok(errors.includes('records[4].publicationId: must be unique'));
});
