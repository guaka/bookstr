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
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/internet-archive/metadata?id=the-wealth-of-networks'),
    'https://archive.org/metadata/the-wealth-of-networks',
  );
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/internet-archive/download?id=the-wealth-of-networks&name=The_Wealth_of_Networks.epub'),
    'https://archive.org/download/the-wealth-of-networks/The_Wealth_of_Networks.epub',
  );
  const archiveSearch = new URL(catalogUpstreamUrl('app://bookstr/api/internet-archive/search?query=Yochai%20Benkler'));
  assert.equal(archiveSearch.origin + archiveSearch.pathname, 'https://archive.org/advancedsearch.php');
  assert.equal(archiveSearch.searchParams.get('q'), '(Yochai Benkler) AND mediatype:texts');
  assert.deepEqual(archiveSearch.searchParams.getAll('fl[]'), [
    'identifier', 'title', 'creator', 'date', 'year', 'language', 'licenseurl',
  ]);
  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/litres/search?q=tolstoy&limit=20', base),
    'https://catalog.test/api/litres/search?q=tolstoy&limit=20',
  );
  assert.equal(catalogUpstreamUrl('app://bookstr/api/gdl-epub?id=not-a-number'), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/gdl-epub'), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/metadata?id=../private'), '');
  assert.equal(catalogUpstreamUrl(`app://bookstr/api/internet-archive/metadata?id=${'x'.repeat(129)}`), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/download?id=book&name=../private.epub'), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/download?id=../book&name=book.epub'), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/download?id=book'), '');
  assert.equal(catalogUpstreamUrl(`app://bookstr/api/internet-archive/download?id=book&name=${'x'.repeat(513)}`), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/download?id=book&name=bad%5Cname.epub'), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/download?id=book&name=bad%00name.epub'), '');
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
  assert.equal(catalogUpstreamUrl('app://bookstr/api/books/42?view=full', base), 'https://catalog.test/api/books/42?view=full');
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

test('catalog proxy selects route-specific accepts, forwards all cache headers, and omits HEAD bodies', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response('payload', {
      status: 206,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '7',
        'Cache-Control': 'max-age=60',
        ETag: 'fixture',
        'Last-Modified': 'Sun, 30 Aug 2026 12:00:00 GMT',
      },
    });
  };
  const opds = await proxyCatalogRequest(new Request('app://bookstr/api/opds?query=paper'), fetchImpl);
  assert.equal(calls[0].options.headers.Accept, 'application/atom+xml;profile=opds-catalog');
  assert.equal(opds.headers.get('content-length'), '7');
  assert.equal(opds.headers.get('cache-control'), 'max-age=60');
  assert.equal(opds.headers.get('last-modified'), 'Sun, 30 Aug 2026 12:00:00 GMT');

  const json = await proxyCatalogRequest(new Request('app://bookstr/api/oapen?query=paper'), fetchImpl);
  assert.equal(calls[1].options.headers.Accept, 'application/json');
  assert.equal(await json.text(), 'payload');

  const head = await proxyCatalogRequest(new Request('app://bookstr/api/search?q=paper', { method: 'HEAD' }), fetchImpl);
  assert.equal(calls[2].options.method, 'HEAD');
  assert.equal(await head.text(), '');

  await proxyCatalogRequest(new Request('app://bookstr/api/search?q=paper'), fetchImpl, 'https://catalog.test/api/');
  assert.equal(calls[3].options.headers.Accept, '*/*');
  assert.equal(calls[3].url, 'https://catalog.test/api/search?q=paper');

  assert.equal(
    catalogUpstreamUrl('app://bookstr/api/opds?query=paper&order_by=popular', undefined, 'https://unglue.test/s.open/'),
    'https://unglue.test/s.paper/?order_by=popular',
  );
});

test('catalog proxy handles HEAD responses and route-specific accept headers', async () => {
  const calls = [];
  const response = await proxyCatalogRequest(
    new Request('app://bookstr/api/oapen?query=history', { method: 'HEAD' }),
    async (url, options) => {
      calls.push({ url, options });
      return new Response(null, {
        status: 206,
        headers: {
          'Content-Length': '0',
          'Cache-Control': 'max-age=60',
          'Last-Modified': 'yesterday',
        },
      });
    },
  );

  assert.deepEqual(calls, [{
    url: 'https://library.oapen.org/rest/search?query=history&expand=metadata%2Cbitstreams&limit=50',
    options: { method: 'HEAD', headers: { Accept: 'application/json' } },
  }]);
  assert.equal(response.status, 206);
  assert.equal(response.body, null);
  assert.equal(response.headers.get('content-length'), '0');
  assert.equal(response.headers.get('cache-control'), 'max-age=60');
  assert.equal(response.headers.get('last-modified'), 'yesterday');
  assert.equal(response.headers.get('etag'), null);
});

test('catalog proxy preserves accept headers for ordinary catalog routes', async () => {
  let received;
  const response = await proxyCatalogRequest(
    new Request('app://bookstr/api/books/7', { headers: { Accept: 'application/custom' } }),
    async (_url, options) => {
      received = options;
      return new Response('ok', { status: 200 });
    },
    'https://catalog.test/api/',
  );

  assert.deepEqual(received, { method: 'GET', headers: { Accept: 'application/custom' } });
  assert.equal(await response.text(), 'ok');
});

test('catalog proxy rejects incomplete archive requests and defaults ordinary accept headers', async () => {
  const base = 'https://catalog.test/api';
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/search', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/metadata', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/gdl-epub', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/oapen-file', base), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/download?id=book'), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/download?name=book.epub'), '');
  assert.equal(catalogUpstreamUrl(`app://bookstr/api/internet-archive/download?id=book&name=${'x'.repeat(513)}`), '');
  assert.equal(catalogUpstreamUrl('app://bookstr/api/internet-archive/download?id=book&name=dir%2Fbook.epub'), '');

  let received;
  await proxyCatalogRequest(
    new Request('app://bookstr/api/books/8'),
    async (_url, options) => {
      received = options;
      return new Response(null, { status: 204 });
    },
    base,
  );
  assert.deepEqual(received, { method: 'GET', headers: { Accept: '*/*' } });
});
