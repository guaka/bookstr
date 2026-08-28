import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverOPDSFeed,
  discoverOpenSearchTemplate,
  isPublicHTTPSURL,
  normalizeLitresPublicDomainRecords,
  normalizeOPDS2Feed,
  normalizeOPDSFeed,
  normalizePublicOPDSFeeds,
  resolveOPDSSearchURL,
} from './opds.js';

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
  assert.equal(isPublicHTTPSURL('https://127.0.0.1/opds'), false);
  assert.equal(isPublicHTTPSURL('https://192.168.1.5/opds'), false);
  assert.equal(isPublicHTTPSURL('https://[::1]/opds'), false);
  assert.throws(() => normalizeOPDSFeed('<!DOCTYPE feed>', { provider: 'x', feedURL: 'https://books.example/opds' }));
});

test('normalizes portable public custom-feed settings without credentials or private endpoints', () => {
  assert.deepEqual(normalizePublicOPDSFeeds([
    { name: '  My  catalogue ', url: 'https://books.example/opds' },
    { name: 'Duplicate', url: 'https://books.example/opds' },
    { name: 'Secrets', url: 'https://user:secret@books.example/opds' },
    { name: 'Private', url: 'https://10.0.0.2/opds' },
    { name: '', url: 'https://books.example/empty-name' },
  ]), [{ name: 'My catalogue', url: 'https://books.example/opds' }]);
});

test('discovers OPDS 1 OpenSearch and OPDS 2 FB2 acquisitions', () => {
  const opds1 = `<?xml version="1.0"?>
    <feed>
      <link rel="search" type="application/opensearchdescription+xml" href="/opensearch.xml"/>
    </feed>`;
  const discovery = discoverOPDSFeed(opds1, { provider: 'public-feed', feedURL: 'https://books.example/catalog' });
  assert.deepEqual(discovery, {
    kind: 'opds1',
    records: [],
    search: {
      kind: 'opensearch',
      href: 'https://books.example/opensearch.xml',
      type: 'application/opensearchdescription+xml',
    },
  });
  const template = discoverOpenSearchTemplate(
    '<OpenSearchDescription><Url type="application/atom+xml" template="https://books.example/search?q={searchTerms}"/></OpenSearchDescription>',
    'https://books.example/opensearch.xml',
  );
  assert.deepEqual(template, {
    kind: 'template',
    href: 'https://books.example/search?q={searchTerms}',
    type: 'application/atom+xml',
  });
  assert.equal(resolveOPDSSearchURL(template, 'Идиот'), 'https://books.example/search?q=%D0%98%D0%B4%D0%B8%D0%BE%D1%82');

  const opds2Discovery = discoverOPDSFeed(JSON.stringify({
    links: [{ rel: 'search', href: '/search{?query}', type: 'application/opds+json' }],
  }), { provider: 'public-feed', feedURL: 'https://books.example/catalog.json' });
  assert.equal(opds2Discovery.search.href, 'https://books.example/search{?query}');
  assert.equal(resolveOPDSSearchURL(opds2Discovery.search, 'Идиот'), 'https://books.example/search?query=%D0%98%D0%B4%D0%B8%D0%BE%D1%82');

  const records = normalizeOPDS2Feed({
    metadata: { title: 'A feed' },
    publications: [{
      metadata: {
        identifier: 'opds-2-book',
        title: 'Cyrillic FB2',
        author: [{ name: 'Автор' }],
        language: 'ru',
        rights: 'Public Domain',
      },
      links: [{
        rel: ['http://opds-spec.org/acquisition/open-access'],
        type: 'application/fb2+xml',
        href: '/files/book.fb2',
      }],
    }],
  }, { provider: 'public-feed', feedURL: 'https://books.example/catalog.json' });
  assert.deepEqual(records, [{
    provider: 'public-feed',
    recordId: 'opds-2-book',
    publicationId: 'public-feed:opds-2-book',
    title: 'Cyrillic FB2',
    authors: ['Автор'],
    languages: ['ru'],
    rights: { status: 'public_domain', license: 'Public Domain', source: 'public-feed' },
    acquisitions: [{ format: 'fb2', url: 'https://books.example/files/book.fb2', availability: 'open' }],
  }]);
});

test('LitRes adapter keeps only explicit free public-domain direct FB2 downloads', () => {
  const records = normalizeLitresPublicDomainRecords({
    results: [
      {
        id: 'allowed',
        title: 'Public Russian classic',
        authors: [{ name: 'Author' }],
        language: 'ru',
        rights: 'Public Domain',
        price: 0,
        files: [{ format: 'fb2.zip', url: 'https://download.litres.example/books/allowed.fb2.zip' }],
      },
      {
        id: 'not-free',
        title: 'Paid edition',
        rights: 'Public Domain',
        price: 199,
        files: [{ format: 'fb2', url: 'https://download.litres.example/books/paid.fb2' }],
      },
      {
        id: 'no-rights',
        title: 'Free but not explicitly public domain',
        price: 0,
        files: [{ format: 'fb2', url: 'https://download.litres.example/books/no-rights.fb2' }],
      },
      {
        id: 'landing-page',
        title: 'No direct file',
        rights: 'Public Domain',
        price: 0,
        files: [{ format: 'fb2', url: 'https://www.litres.ru/book/title-123/' }],
      },
    ],
  });
  assert.deepEqual(records, [{
    provider: 'litres-public-domain',
    recordId: 'allowed',
    publicationId: 'litres-public-domain:allowed',
    title: 'Public Russian classic',
    authors: ['Author'],
    languages: ['ru'],
    rights: { status: 'public_domain', license: 'Public Domain', source: 'litres' },
    acquisitions: [{
      format: 'fb2',
      url: 'https://download.litres.example/books/allowed.fb2.zip',
      availability: 'open',
    }],
  }]);
});
