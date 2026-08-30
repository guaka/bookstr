import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverOPDSFeed,
  discoverOpenSearchTemplate,
  isPublicHTTPSURL,
  normalizeLitresPublicDomainRecords,
  normalizeOPDS2Feed,
  normalizeOPDS1Feed,
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

test('neutralizes markup introduced by XML entity decoding', () => {
  const hostile = feed.replace('Open FB2', '&lt;script&gt;alert(1)&lt;/script&gt;Open FB2');
  const [record] = normalizeOPDSFeed(hostile, { provider: 'my-feed', feedURL: 'https://books.example/opds' });
  assert.equal(record.title, 'alert(1)Open FB2');
  assert.doesNotMatch(record.title, /[<>]/);
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

test('OPDS validation covers malformed sources, private address ranges, and feed limits', () => {
  assert.equal(isPublicHTTPSURL(''), false);
  assert.equal(isPublicHTTPSURL(null), false);
  assert.equal(isPublicHTTPSURL('https://localhost/feed'), false);
  assert.equal(isPublicHTTPSURL('https://foo.localhost/feed'), false);
  assert.equal(isPublicHTTPSURL('https://foo.local/feed'), false);
  assert.equal(isPublicHTTPSURL('https://0.1.2.3/feed'), false);
  assert.equal(isPublicHTTPSURL('https://169.254.1.2/feed'), false);
  assert.equal(isPublicHTTPSURL('https://172.16.0.1/feed'), false);
  assert.equal(isPublicHTTPSURL('https://172.32.0.1/feed'), true);
  assert.equal(isPublicHTTPSURL('https://10.0.0.256/feed'), false);
  assert.equal(isPublicHTTPSURL('https://[fe80::1]/feed'), false);
  assert.equal(isPublicHTTPSURL('https://[2001:db8::1]/feed'), true);
  assert.deepEqual(normalizePublicOPDSFeeds(null), []);
  assert.deepEqual(normalizePublicOPDSFeeds([
    { name: 'x'.repeat(81), url: 'https://one.example/feed' },
    null,
    'not an object',
    { name: 'good', url: 'not a url' },
    ...Array.from({ length: 13 }, (_, index) => ({ name: `feed-${index}`, url: `https://feed-${index}.example/opds` })),
  ]).length, 12);
  assert.throws(() => normalizeOPDSFeed('<feed/>', { provider: '', feedURL: 'https://books.example/feed' }));
  assert.throws(() => normalizeOPDSFeed('<feed/>', { provider: 'x', feedURL: 'http://books.example/feed' }));
  assert.throws(() => normalizeOPDS2Feed('{bad', { provider: 'x', feedURL: 'https://books.example/feed' }));
  assert.deepEqual(normalizeOPDS2Feed('[]', { provider: 'x', feedURL: 'https://books.example/feed' }), []);
});

test('OPDS normalizers support fallback metadata and ignore unusable acquisitions', () => {
  const records = normalizeOPDS1Feed(`
    <feed>
      <entry>
        <title>Untitled candidate</title><dc:issued>published in 2024</dc:issued>
        <author><name>First</name></author><author><name>Second</name></author>
        <dc:language>en</dc:language><dc:language>invalid</dc:language><dc:rights>CC0</dc:rights>
        <link href="/cover.jpg" type="image/jpeg"/>
        <link href="/book.fb2?download=1" type="application/octet-stream"/>
      </entry>
      <entry><id>bad</id><link href="https://books.example/landing" type="text/html"/></entry>
    </feed>`, { provider: 'feed', feedURL: 'https://books.example/catalog' });
  assert.deepEqual(records, [{
    provider: 'feed', recordId: '/book.fb2?download=1',
    publicationId: 'feed:/book.fb2?download=1', title: 'Untitled candidate',
    authors: ['First', 'Second'], languages: ['en'], publishedYear: '2024',
    rights: { status: 'public_domain', license: 'CC0', source: 'feed' },
    acquisitions: [{ format: 'fb2', url: 'https://books.example/book.fb2?download=1', availability: 'open' }],
  }]);

  const opds2 = normalizeOPDS2Feed({ items: [
    null,
    { id: 'fallback', title: 'Fallback', author: 'Author', language: ['en', 'english'], license: 'Open publication',
      acquisitions: { href: 'https://books.example/fallback.fb2', mime: 'application/x-fictionbook+xml' } },
    { id: 'images-only', links: { href: 'https://books.example/image.jpg', type: 'image/jpeg' } },
  ] }, { provider: 'feed', feedURL: 'https://books.example/catalog' });
  assert.deepEqual(opds2, [{
    provider: 'feed', recordId: 'fallback', publicationId: 'feed:fallback', title: 'Fallback', authors: ['Author'],
    languages: ['en'], rights: { status: 'open_license', license: 'Open publication', source: 'feed' },
    acquisitions: [{ format: 'fb2', url: 'https://books.example/fallback.fb2', availability: 'open' }],
  }]);
});

test('OPDS search helpers handle absent links, templates, and invalid bases', () => {
  assert.equal(discoverOpenSearchTemplate('<OpenSearchDescription/>', 'https://books.example/opensearch.xml'), null);
  assert.equal(discoverOpenSearchTemplate('<OpenSearchDescription><Url template="{bad"/></OpenSearchDescription>', '%%%'), null);
  assert.equal(resolveOPDSSearchURL(null, 'book'), null);
  assert.equal(resolveOPDSSearchURL({ href: 'https://books.example/search' }, '  '), 'https://books.example/search');
  assert.equal(resolveOPDSSearchURL('https://books.example/search/{query}', 'book'), 'https://books.example/search/book');
  assert.equal(resolveOPDSSearchURL({ href: 'https://books.example/search{?q,query}' }, 'a b'), 'https://books.example/search?q=a%20b&query=a%20b');
  assert.equal(resolveOPDSSearchURL({ href: '%%%{query}' }, 'book'), '');
  assert.deepEqual(discoverOPDSFeed('{}', { provider: 'feed', feedURL: 'https://books.example/feed' }), {
    kind: 'opds2', records: [], search: null,
  });
  assert.deepEqual(discoverOPDSFeed('<feed/>', { provider: 'feed', feedURL: 'https://books.example/feed' }), {
    kind: 'opds1', records: [], search: null,
  });
});

test('LitRes normalization accepts alternate evidence fields and rejects unsafe files', () => {
  assert.deepEqual(normalizeLitresPublicDomainRecords(JSON.stringify([
    { uuid: 'uuid-1', name: 'Named', is_public_domain: true, isFree: true,
      author: { title: 'Writer' }, languages: ['RU', 'invalid'], formats: { href: 'https://books.example/named.fb2', extension: 'fb2' } },
    { slug: 'slug-1', metadata: { title: 'Zero', year: '1900' }, rights: { status: 'Public Domain' }, price: { amount: 0 },
      download_url: 'https://books.example/zero.fb2', format: 'application/fb2+xml' },
    { id: 'private', public_domain: true, free: true, files: [{ format: 'fb2', url: 'https://127.0.0.1/private.fb2' }] },
    { id: 'not-direct', public_domain: true, free: true, files: [{ type: 'application/fb2+xml', url: 'https://books.example/page' }] },
  ])), [
    { provider: 'litres-public-domain', recordId: 'uuid-1', publicationId: 'litres-public-domain:uuid-1', title: 'Named', authors: ['Writer'], languages: ['ru'], rights: { status: 'public_domain', license: 'Public Domain', source: 'litres' }, acquisitions: [{ format: 'fb2', url: 'https://books.example/named.fb2', availability: 'open' }] },
    { provider: 'litres-public-domain', recordId: 'slug-1', publicationId: 'litres-public-domain:slug-1', title: 'Zero', authors: [], languages: [], publishedYear: '1900', rights: { status: 'public_domain', license: 'Public Domain', source: 'litres' }, acquisitions: [{ format: 'fb2', url: 'https://books.example/zero.fb2', availability: 'open' }] },
  ]);
  assert.deepEqual(normalizeLitresPublicDomainRecords({}), []);
  assert.deepEqual(normalizeLitresPublicDomainRecords({ records: [] }), []);
  assert.deepEqual(normalizeLitresPublicDomainRecords({ items: [] }), []);
});
