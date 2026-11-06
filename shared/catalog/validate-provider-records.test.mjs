import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateProviderRecords } from './validate-provider-records.mjs';

const fixture = JSON.parse(await readFile(new URL('./provider-records.json', import.meta.url)));
const contract = await readFile(new URL('./provider-contract.md', import.meta.url), 'utf8');

test('provider catalog fixtures conform to the versioned contract', () => {
  assert.deepEqual(validateProviderRecords(fixture), []);
});

test('fixture exercises supported EPUB and PDF acquisitions', () => {
  const formats = new Set(fixture.records.flatMap(record => record.acquisitions.map(acquisition => acquisition.format)));
  assert.deepEqual([...formats].sort(), ['epub', 'pdf']);
  const epub = fixture.records.find(record => record.provider === 'litres-public-domain');
  assert.ok(epub);
  assert.equal(epub.rights.status, 'public_domain');
  assert.equal(epub.rights.license, 'Public Domain');
  assert.equal(epub.publicationId, `${epub.provider}:${epub.recordId}`);
  assert.equal(epub.acquisitions[0].availability, 'open');
});

test('OPDS settings contract keeps only public name and URL metadata in Nostr', () => {
  assert.match(contract, /credential-free public/);
  assert.match(contract, /Private-network endpoints,\s+embedded credentials/);
  assert.match(contract, /bookstr-opds-feed/);
  assert.match(contract, /bookstr-opds-feeds/);
  assert.match(contract, /OPDS 1 Atom acquisition feeds, OpenSearch discovery, and\s+OPDS 2 JSON/);
  assert.match(contract, /never forwarded through Bookstr's public worker/);
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

test('validator accepts an EPUB record without weakening HTTP URL or rights checks', () => {
  const record = {
    version: 1,
    records: [{
      provider: 'fixture', recordId: 'epub', publicationId: 'fixture:epub', title: 'Fixture',
      authors: ['Author'], languages: ['en'], rights: { status: 'open_license', license: 'CC BY-SA' },
      acquisitions: [{ format: 'epub', url: 'https://books.example/fixture.epub', availability: 'open' }],
    }],
  };
  assert.deepEqual(validateProviderRecords(record), []);
  assert.notDeepEqual(validateProviderRecords({
    ...record,
    records: [{ ...record.records[0], acquisitions: [{ ...record.records[0].acquisitions[0], url: 'file:///tmp/book.epub' }] }],
  }), []);
});
