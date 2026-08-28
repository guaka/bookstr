const test = require('node:test');
const assert = require('node:assert/strict');

const {
  catalogUpstreamUrl,
  proxyCatalogRequest,
} = require('../../catalog-proxy');

test('catalog proxy allowlists only Bookstr search and acquisition routes', () => {
  const base = 'https://catalog.test/api';
  assert.equal(catalogUpstreamUrl('not a URL', base), '');
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/search?q=paper&limit=50', base),
    'https://catalog.test/api/search?q=paper&limit=50',
  );
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/opds?query=paper', base, 'https://unglue.test/s.open'),
    'https://unglue.test/s.paper/?order_by=newest',
  );
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/gutendex?query=war', base, 'https://unglue.test/s.open', 'https://gutendex.test/books/'),
    'https://gutendex.test/books/?search=war',
  );
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/oapen?query=climate'),
    'https://library.oapen.org/rest/search?query=climate&expand=metadata%2Cbitstreams&limit=50',
  );
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/open-textbooks?query=climate'),
    'https://open.umn.edu/opentextbooks/textbooks.json?q=climate',
  );
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/oapen-file?id=fa5e4801-f872-4845-bd63-fd7d72d14e12'),
    'https://library.oapen.org/rest/bitstreams/fa5e4801-f872-4845-bd63-fd7d72d14e12/retrieve',
  );
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/doab?query=climate'),
    'https://directory.doabooks.org/rest/search?query=climate&expand=metadata%2Cbitstreams&limit=50',
  );
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/gdl?query=river'),
    'https://content.digitallibrary.io/wp-json/content-api/v1/contentsearch?query=river&_skip=0',
  );
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/gdl-epub?id=14165'),
    'https://content.digitallibrary.io/wp-json/epub-generator/v1/book/14165',
  );
  assert.equal(catalogUpstreamUrl('app://bookstr/api/gdl-epub?id=not-a-number'), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/oapen-file?id=not-a-uuid'), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/gutendex', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/oapen', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/open-textbooks', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/doab', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/gdl', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/opds', base, 'https://unglue.test/s.open'), '');
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/books/42/download', base),
    'https://catalog.test/api/books/42/download',
  );
  assert.equal(catalogUpstreamUrl('app://bookstr/api/dictionaries/en-fr.sqlite3', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/books/not-a-number/download', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/index.html', base), '');
});

test('catalog proxy forwards responses and preserves useful headers', async () => {
  const calls = [];
  const response = await proxyCatalogRequest(
    new Request('app://bookstr/api/search?q=paper', { headers: { Accept: 'application/json' } }),
    async (url, options) => {
      calls.push({ url, options });
      return new Response('{"results":[]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: 'fixture' },
      });
    },
    'https://catalog.test/api',
  );
  assert.deepEqual(calls, [{
    url: 'https://catalog.test/api/search?q=paper',
    options: { method: 'GET', headers: { Accept: 'application/json' } },
  }]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('etag'), 'fixture');
  assert.equal(await response.text(), '{"results":[]}');
});

test('catalog proxy rejects mutations, ignores unrelated routes, and handles outages', async () => {
  const noFetch = () => assert.fail('fetch must not run');
  assert.equal(await proxyCatalogRequest(new Request('app://bookstr/index.html'), noFetch), null);

  const rejected = await proxyCatalogRequest(
    new Request('app://bookstr/api/search', { method: 'POST' }),
    noFetch,
  );
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'GET, HEAD');

  const unavailable = await proxyCatalogRequest(
    new Request('app://bookstr/api/opds?query=paper'),
    async () => { throw new Error('offline'); },
  );
  assert.equal(unavailable.status, 502);
  assert.equal(await unavailable.text(), 'Catalog unavailable');
});
