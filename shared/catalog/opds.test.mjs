import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicHTTPSURL, normalizeOPDSFeed } from './opds.js';

const feed = `<?xml version="1.0"?><feed><entry><id>a-1</id><title>Open FB2</title><author><name>Ada Author</name></author><dc:language>ru</dc:language><dc:rights>CC BY 4.0</dc:rights><link rel="http://opds-spec.org/acquisition/open-access" type="application/x-fictionbook+xml" href="books/open.fb2"/></entry><entry><id>no-file</id><title>Metadata only</title></entry></feed>`;

test('normalizes a public OPDS FB2 acquisition without trusting unrecognized records', () => {
  assert.deepEqual(normalizeOPDSFeed(feed, { provider: 'my-feed', feedURL: 'https://books.example/opds' }), [{
    provider: 'my-feed', recordId: 'a-1', publicationId: 'my-feed:a-1', title: 'Open FB2', authors: ['Ada Author'], languages: ['ru'],
    rights: { status: 'open_license', license: 'CC BY 4.0', source: 'my-feed' },
    acquisitions: [{ format: 'fb2', url: 'https://books.example/books/open.fb2', availability: 'open' }],
  }]);
});

test('only accepts public credential-free HTTPS OPDS source URLs and rejects XML entities', () => {
  assert.equal(isPublicHTTPSURL('https://books.example/opds'), true);
  assert.equal(isPublicHTTPSURL('https://user:secret@books.example/opds'), false);
  assert.equal(isPublicHTTPSURL('http://books.example/opds'), false);
  assert.throws(() => normalizeOPDSFeed('<!DOCTYPE feed>', { provider: 'x', feedURL: 'https://books.example/opds' }));
});
