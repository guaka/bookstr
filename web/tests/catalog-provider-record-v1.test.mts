import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importWebRuntime } from './web-test-import.mts';

type CatalogRecord = Record<string, unknown> & { rights: Record<string, unknown> };
type CatalogProviderRecordApi = {
  CATALOG_PROVIDER_RECORD_VERSION: number;
  parseCatalogProviderRecordV1(value: unknown): CatalogRecord;
  serializeCatalogProviderRecordV1(value: unknown): string;
};

const {
  CATALOG_PROVIDER_RECORD_VERSION,
  parseCatalogProviderRecordV1,
  serializeCatalogProviderRecordV1,
} = await importWebRuntime('../generated/catalog-provider-record-v1.js') as CatalogProviderRecordApi;

const fixture = JSON.parse(await readFile(new URL('../../shared/catalog/provider-records.json', import.meta.url), 'utf8')) as { version: number; records: CatalogRecord[] };

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
  const firstRecord = fixture.records[0];
  assert.ok(firstRecord);
  assert.throws(() => parseCatalogProviderRecordV1(null), /must be an object/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...firstRecord, provider: 1 }), /provider must be a string/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...firstRecord, authors: 'Jane' }), /authors must be an array/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...firstRecord, authors: [1] }), /authors\[0\] must be a string/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...firstRecord, rights: [] }), /rights must be an object/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...firstRecord, acquisitions: {} }), /acquisitions must be an array/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...firstRecord, acquisitions: [null] }), /acquisitions\[0\] must be an object/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...firstRecord, publishedYear: 1813 }), /publishedYear must be a string/);
  assert.throws(() => parseCatalogProviderRecordV1({ ...firstRecord, rights: { ...firstRecord.rights, license: 1 } }), /license must be a string/);
});
