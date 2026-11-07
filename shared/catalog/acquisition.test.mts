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
  assert.ok(selected);
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

test('drops malformed HTTP and magnet locators without losing valid acquisitions', () => {
  const normalized = normalizeProviderRecord({
    ...record,
    acquisitions: [
      { format: 'epub', url: 'https://%', torrent: 'magnet:?xt=urn:btih:abc', availability: 'open' },
      { format: 'epub', url: 'https://%', torrent: 'magnet:invalid', availability: 'open' },
    ],
  });
  assert.deepEqual(normalized.acquisitions.map(entry => ({ url: entry.url, torrent: entry.torrent })), [
    { url: '', torrent: 'magnet:?xt=urn:btih:abc' },
    { url: '', torrent: 'magnet:invalid' },
  ]);
});

test('ranks borrow and preview options while honoring torrent preference', () => {
  const alternate = normalizeProviderRecord({
    provider: 'unregistered-provider',
    record_id: 'alternate-1',
    rights_status: 'unknown',
    acquisitions: [
      { format: 'epub', torrent: 'magnet:?xt=urn:btih:abc', availability: 'borrow' },
      { format: '.epub', href: 'https://example.test/preview.epub', availability: 'preview' },
    ],
  });
  assert.equal(alternate.publicationId, 'unregistered-provider:alternate-1');
  assert.equal(alternate.providerDescriptor, null);
  assert.deepEqual(listAcquisitions(alternate, { includeRestricted: true, preferTorrent: false }).map(item => item.availability), ['borrow', 'preview']);
  assert.equal(listAcquisitions(alternate, { preferTorrent: false }).length, 1);
  assert.equal(selectAcquisition({ provider: 'unregistered-provider', recordId: 'empty' }), null);
});

test('skips malformed acquisition entries while preserving a supported PDF', () => {
  const normalized = normalizeProviderRecord({
    ...record,
    acquisitions: [null, [], 42, { format: 'mobi', url: 'https://example.test/book.mobi' },
      { extension: '.PDF', href: 'https://example.test/book.pdf', access: 'open' }],
  });
  assert.equal(normalized.acquisitions.length, 1);
  assert.equal(selectAcquisition(normalized)?.format, 'pdf');
  assert.equal(selectAcquisition(normalized)?.url, 'https://example.test/book.pdf');
});

test('bounds saved provider metadata and drops control characters in language entries', () => {
  const normalized = normalizeProviderRecord({
    ...record,
    title: 'x'.repeat(401),
    authors: 'invalid\u0000author',
    languages: ['', 'en\u0000', 'x'.repeat(33), ...Array.from({ length: 20 }, (_, index) => `lang-${index}`)],
  });
  assert.equal(normalized.title, '');
  assert.equal(normalized.authors, '');
  assert.deepEqual(normalized.languages, Array.from({ length: 16 }, (_, index) => `lang-${index}`));
});
