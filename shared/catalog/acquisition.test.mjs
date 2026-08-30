import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listAcquisitions,
  normalizeProviderRecord,
  providerBookFields,
  selectAcquisition,
} from './acquisition.mjs';

const record = {
  provider: 'propagate',
  recordId: 'book-1',
  title: 'Open book',
  authors: 'Author',
  languages: ['ru'],
  rights_status: 'public_domain',
  redistribution: 'allowed',
  acquisitions: [
    { format: 'epub', url: 'https://example.test/book.epub', availability: 'open', sha256: 'a'.repeat(64), size: 12 },
    { format: 'epub', torrent: 'https://example.test/book.torrent', availability: 'open', sha256: 'a'.repeat(64), size: 12 },
    { format: 'pdf', url: 'https://example.test/book.pdf', availability: 'restricted' },
  ],
};

test('normalizes provider records and keeps rights evidence', () => {
  const normalized = normalizeProviderRecord(record);
  assert.equal(normalized.publicationId, 'propagate:book-1');
  assert.equal(normalized.rights.public_seed_allowed, true);
  assert.equal(normalized.acquisitions.length, 3);
});

test('selects an open torrent before an equivalent HTTPS acquisition', () => {
  const selected = selectAcquisition(record);
  assert.equal(selected.format, 'epub');
  assert.match(selected.torrent, /^https:\/\//);
  assert.equal(listAcquisitions(record, { format: 'pdf' }).length, 0);
  assert.equal(listAcquisitions(record, { format: 'pdf', includeRestricted: true }).length, 1);
});

test('maps a provider record into the local library fields', () => {
  const fields = providerBookFields(record);
  assert.deepEqual(fields, {
    id: 'propagate:book-1',
    title: 'Open book',
    authors: 'Author',
    language: 'ru',
    year: '',
    isbn: '',
    source: 'propagate',
    sourceNativeId: 'book-1',
    sourceUrl: 'https://propagate.info',
    rights_status: 'public_domain',
    license: '',
    license_url: '',
    rights_source: '',
    jurisdiction: '',
    redistribution: 'allowed',
    evidence_url: '',
    attribution: '',
    public_seed_allowed: true,
  });
});

test('rejects credentials, unsupported formats, and restricted downloads by default', () => {
  assert.equal(normalizeProviderRecord({ ...record, acquisitions: [{ format: 'epub', url: 'https://user:pass@example.test/book.epub', availability: 'open' }] }).acquisitions.length, 0);
  assert.equal(normalizeProviderRecord({ ...record, acquisitions: [{ format: 'mobi', url: 'https://example.test/book.mobi', availability: 'open' }] }).acquisitions.length, 0);
  assert.throws(() => listAcquisitions(record, { format: 'mobi' }), /unsupported/);
});
