import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CATALOG_PROVIDER_RECORD_VERSION,
  parseCatalogProviderRecordV1,
  serializeCatalogProviderRecordV1,
} from '../generated/catalog-provider-record-v1.js';

const fixture = JSON.parse(await readFile(new URL('../../shared/catalog/provider-records.json', import.meta.url)));

test('generated JavaScript DTO round-trips every provider fixture', () => {
  assert.equal(CATALOG_PROVIDER_RECORD_VERSION, fixture.version);
  for (const record of fixture.records) {
    assert.deepEqual(JSON.parse(serializeCatalogProviderRecordV1(record)), record);
    assert.deepEqual(parseCatalogProviderRecordV1(record), record);
  }
});

test('generated JavaScript DTO preserves every optional wire field', () => {
  const record = {
    ...fixture.records[1],
    publishedYear: '2026',
    rights: {
      status: 'open_license',
      license: 'CC BY',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      source: 'fixture',
    },
    acquisitions: [{ format: 'pdf', url: 'https://example.test/book.pdf', availability: 'preview' }],
  };
  assert.deepEqual(parseCatalogProviderRecordV1(record), record);

  const minimalRights = { ...fixture.records[0], rights: { status: 'unknown' } };
  assert.deepEqual(parseCatalogProviderRecordV1(minimalRights).rights, { status: 'unknown' });
});

test('generated JavaScript DTO rejects malformed wire shapes', () => {
  assert.throws(() => parseCatalogProviderRecordV1(null), /must be an object/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...fixture.records[0], provider: 1 }), /provider must be a string/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...fixture.records[0], authors: 'Jane' }), /authors must be an array/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...fixture.records[0], authors: [1] }), /authors\[0\] must be a string/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...fixture.records[0], rights: [] }), /rights must be an object/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...fixture.records[0], acquisitions: {} }), /acquisitions must be an array/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...fixture.records[0], acquisitions: [null] }), /acquisitions\[0\] must be an object/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...fixture.records[0], publishedYear: 1813 }), /publishedYear must be a string/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...fixture.records[0], rights: { ...fixture.records[0].rights, license: 1 } }), /license must be a string/);
});
