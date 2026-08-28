import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../opds-sources.js', import.meta.url), 'utf8');
const {
  isPublicHTTPSURL,
  normalizePublicOPDSFeeds,
  providerForOPDSFeed,
  providerRecordToBook,
  searchOPDSFeed,
} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('custom-feed settings retain only public credential-free HTTPS feeds', () => {
  assert.deepEqual(normalizePublicOPDSFeeds([
    { name: '  Public catalogue  ', url: 'https://books.example/opds' },
    { name: 'Duplicate', url: 'https://books.example/opds' },
    { name: 'Credentials', url: 'https://user:secret@books.example/opds' },
    { name: 'Private', url: 'https://192.168.1.10/opds' },
  ]), [{ name: 'Public catalogue', url: 'https://books.example/opds' }]);
  assert.equal(isPublicHTTPSURL('https://[::1]/opds'), false);
  assert.match(providerForOPDSFeed({ name: 'Public catalogue', url: 'https://books.example/opds' }), /^opds-[a-z0-9]+$/);
});

test('searches OPDS 2 directly from the configured feed and maps its FB2 acquisition', async () => {
  const feed = { name: 'Example OPDS', url: 'https://books.example/catalog.json' };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url) === feed.url) {
      return response(url, JSON.stringify({
        links: [{ rel: 'search', href: 'https://books.example/search{?query}', type: 'application/opds+json' }],
      }));
    }
    assert.equal(String(url), 'https://books.example/search?query=%D0%98%D0%B4%D0%B8%D0%BE%D1%82');
    return response(url, JSON.stringify({
      publications: [{
        metadata: {
          identifier: 'idiot',
          title: 'Идиот',
          author: [{ name: 'Фёдор Достоевский' }],
          language: 'ru',
          rights: 'Public Domain',
        },
        links: [{
          rel: ['http://opds-spec.org/acquisition/open-access'],
          type: 'application/fb2+xml',
          href: 'https://downloads.example/idiot.fb2',
        }],
      }],
    }));
  };

  const records = await searchOPDSFeed(feed, 'Идиот', fetchImpl);
  assert.equal(calls.length, 2);
  assert.equal(calls.every(url => url.startsWith('https://books.example/')), true);
  assert.deepEqual(records, [{
    provider: providerForOPDSFeed(feed),
    recordId: 'idiot',
    publicationId: providerForOPDSFeed(feed) + ':idiot',
    title: 'Идиот',
    authors: ['Фёдор Достоевский'],
    languages: ['ru'],
    rights: { status: 'public_domain', license: 'Public Domain', source: providerForOPDSFeed(feed) },
    acquisitions: [{ format: 'fb2', url: 'https://downloads.example/idiot.fb2', availability: 'open' }],
  }]);
  assert.deepEqual(providerRecordToBook(records[0], feed.url), {
    id: providerForOPDSFeed(feed) + ':idiot',
    source: providerForOPDSFeed(feed),
    sourceNativeId: 'idiot',
    sourceUrl: feed.url,
    title: 'Идиот',
    authors: 'Фёдор Достоевский',
    language: 'ru',
    year: '',
    extension: 'fb2',
    readUrl: 'https://downloads.example/idiot.fb2',
    rights_status: 'public_domain',
    license: 'Public Domain',
    rights_source: providerForOPDSFeed(feed),
  });
});

test('discovers an OPDS 1 OpenSearch descriptor without proxying it through the worker', async () => {
  const feed = { name: 'Atom', url: 'https://atom.example/catalog' };
  const calls = [];
  const atom = '<?xml version="1.0"?><feed><link rel="search" type="application/opensearchdescription+xml" href="/open.xml"/></feed>';
  const descriptor = '<OpenSearchDescription><Url type="application/atom+xml" template="https://atom.example/find?q={searchTerms}"/></OpenSearchDescription>';
  const result = '<feed><entry><id>a-1</id><title>Open book</title><author><name>Ada</name></author><dc:language>en</dc:language><dc:rights>CC BY 4.0</dc:rights><link rel="http://opds-spec.org/acquisition/open-access" type="application/x-fictionbook+xml" href="/books/open.fb2"/></entry></feed>';
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url) === feed.url) return response(url, atom);
    if (String(url) === 'https://atom.example/open.xml') return response(url, descriptor);
    if (String(url) === 'https://atom.example/find?q=open') return response(url, result);
    throw new Error('Unexpected URL ' + url);
  };
  const records = await searchOPDSFeed(feed, 'open', fetchImpl);
  assert.deepEqual(calls, [feed.url, 'https://atom.example/open.xml', 'https://atom.example/find?q=open']);
  assert.equal(records.length, 1);
  assert.equal(records[0].acquisitions[0].url, 'https://atom.example/books/open.fb2');
  assert.equal(records[0].rights.status, 'open_license');
});

test('neutralizes encoded markup in directly fetched OPDS metadata', async () => {
  const feed = { name: 'Atom', url: 'https://atom.example/catalog' };
  const hostile = '<feed><entry><id>a-1</id><title>&lt;script&gt;alert(1)&lt;/script&gt;Open book</title><dc:rights>Public Domain</dc:rights><link rel="http://opds-spec.org/acquisition/open-access" type="application/x-fictionbook+xml" href="/books/open.fb2"/></entry></feed>';
  const records = await searchOPDSFeed(feed, '', async url => response(url, hostile));
  assert.equal(records[0].title, 'alert(1)Open book');
  assert.doesNotMatch(records[0].title, /[<>]/);
});

test('reports custom OPDS request failures to the caller for per-source status handling', async () => {
  await assert.rejects(
    searchOPDSFeed({ name: 'Broken', url: 'https://books.example/opds' }, 'book', async () => ({ ok: false, status: 503 })),
    /OPDS request failed \(503\)/,
  );
  await assert.rejects(
    searchOPDSFeed({ name: 'Broken', url: 'https://books.example/opds' }, 'book', async () => {
      throw new Error('CORS blocked');
    }),
    /CORS blocked/,
  );
});

function response(url, body) {
  return {
    ok: true,
    status: 200,
    url: String(url),
    text: async () => body,
  };
}
