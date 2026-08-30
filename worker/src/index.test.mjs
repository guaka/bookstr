import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { allowedPath } from './index.js';

test('LitRes worker route uses only its configured fixed catalogue and filters lawful free FB2 records', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: new URL(input), init });
    return Response.json({
      results: [
        {
          id: 'public',
          title: 'Public-domain title',
          rights: 'Public Domain',
          free: true,
          files: [{ format: 'fb2.zip', url: 'https://download.litres.example/public.fb2.zip' }],
        },
        {
          id: 'ambiguous',
          title: 'Not labelled public domain',
          free: true,
          files: [{ format: 'fb2', url: 'https://download.litres.example/ambiguous.fb2' }],
        },
      ],
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const request = new Request('https://books-api.guaka.org/api/litres/search?q=Public&limit=200&url=https://attacker.example/feed');
  const response = await worker.fetch(request, {
    LITRES_PUBLIC_DOMAIN_CATALOG_URL: 'https://catalog.bookstr.example/litres-public-domain.json',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    records: [{
      provider: 'litres-public-domain',
      recordId: 'public',
      publicationId: 'litres-public-domain:public',
      title: 'Public-domain title',
      authors: [],
      languages: [],
      rights: { status: 'public_domain', license: 'Public Domain', source: 'litres' },
      acquisitions: [{
        format: 'fb2',
        url: 'https://download.litres.example/public.fb2.zip',
        availability: 'open',
      }],
    }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, 'https://catalog.bookstr.example/litres-public-domain.json');
  assert.equal(calls[0].url.searchParams.has('url'), false);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
});

test('worker does not expose custom OPDS URLs and validates LitRes search input', async (t) => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return Response.json({});
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.equal(allowedPath('/api/litres/search'), true);
  assert.equal(allowedPath('/api/opds'), false);
  assert.equal((await worker.fetch(new Request('https://books-api.guaka.org/api/opds?url=https://example.org/feed'))).status, 404);
  const invalid = await worker.fetch(new Request('https://books-api.guaka.org/api/litres/search'));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /query/);
  assert.equal(fetched, false);
  const unconfigured = await worker.fetch(new Request('https://books-api.guaka.org/api/litres/search?q=Tolstoy'));
  assert.equal(unconfigured.status, 503);
  assert.match((await unconfigured.json()).error, /not configured/);
});

test('worker handles CORS preflight, unsupported methods, and every public route shape', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: new URL(input), init });
    return new Response('upstream', {
      status: 206,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'max-age=10',
        ETag: 'etag',
        'Last-Modified': 'yesterday',
        Location: 'https://books.example/next',
        'X-Ignored': 'secret',
      },
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.equal(allowedPath('/api/search'), true);
  assert.equal(allowedPath('/api/books/42'), true);
  assert.equal(allowedPath('/api/books/42/download'), true);
  assert.equal(allowedPath('/api/dictionaries/en-ru'), true);
  assert.equal(allowedPath('/api/dictionaries/en-ru.sqlite3'), true);
  assert.equal(allowedPath('/api/books/not-a-number'), false);

  const preflight = await worker.fetch(new Request('https://books-api.guaka.org/api/search', {
    method: 'OPTIONS', headers: { Origin: 'https://books.guaka.org' },
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://books.guaka.org');
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS');

  const deniedPreflight = await worker.fetch(new Request('https://books-api.guaka.org/api/search', {
    method: 'OPTIONS', headers: { Origin: 'https://evil.example' },
  }));
  assert.equal(deniedPreflight.headers.get('Access-Control-Allow-Origin'), null);

  const method = await worker.fetch(new Request('https://books-api.guaka.org/api/search', { method: 'POST' }));
  assert.equal(method.status, 405);
  assert.equal(await method.text(), 'Method not allowed');

  const ordinary = await worker.fetch(new Request('https://books-api.guaka.org/api/search?q=book', {
    headers: { Origin: 'http://localhost:11111', Accept: 'application/json' },
  }));
  assert.equal(ordinary.status, 206);
  assert.equal(await ordinary.text(), 'upstream');
  assert.equal(ordinary.headers.get('Access-Control-Allow-Origin'), 'http://localhost:11111');
  assert.equal(ordinary.headers.get('ETag'), 'etag');
  assert.equal(ordinary.headers.get('X-Ignored'), null);
  assert.equal(calls.at(-1).url.href, 'https://all.books.party/api/search?q=book');
  assert.equal(calls.at(-1).init.headers.Accept, 'application/json');

  const dictionary = await worker.fetch(new Request('https://books-api.guaka.org/api/dictionaries/en-ru.sqlite3', {
    method: 'HEAD',
  }));
  assert.equal(dictionary.status, 206);
  assert.equal(await dictionary.text(), '');
  assert.equal(calls.at(-1).url.href, 'https://download.wikdict.com/dictionaries/sqlite/2/en-ru.sqlite3');
  assert.equal(calls.at(-1).init.method, 'HEAD');
  assert.equal(calls.at(-1).init.headers.Accept, '*/*');
});

test('worker returns stable errors for upstream and LitRes failures', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const request = () => new Request('https://books-api.guaka.org/api/search');

  globalThis.fetch = async () => { throw new Error('offline'); };
  const unavailable = await worker.fetch(request());
  assert.equal(unavailable.status, 502);
  assert.equal(await unavailable.text(), 'Upstream unavailable');

  globalThis.fetch = async () => new Response('nope', { status: 429 });
  const failed = await worker.fetch(new Request('https://books-api.guaka.org/api/search'));
  assert.equal(failed.status, 429);

  const longQuery = await worker.fetch(new Request(`https://books-api.guaka.org/api/litres/search?q=${'x'.repeat(161)}`), {
    LITRES_PUBLIC_DOMAIN_CATALOG_URL: 'https://catalog.bookstr.example/items.json',
  });
  assert.equal(longQuery.status, 400);

  globalThis.fetch = async () => { throw new Error('catalog offline'); };
  const catalogUnavailable = await worker.fetch(new Request('https://books-api.guaka.org/api/litres/search?q=book'), {
    LITRES_PUBLIC_DOMAIN_CATALOG_URL: 'https://catalog.bookstr.example/items.json',
  });
  assert.equal(catalogUnavailable.status, 502);

  globalThis.fetch = async () => new Response('bad', { status: 503 });
  const catalogFailed = await worker.fetch(new Request('https://books-api.guaka.org/api/litres/search?q=book'), {
    LITRES_PUBLIC_DOMAIN_CATALOG_URL: 'https://catalog.bookstr.example/items.json',
  });
  assert.equal(catalogFailed.status, 503);

  globalThis.fetch = async () => new Response('{not json', { status: 200 });
  const invalidPayload = await worker.fetch(new Request('https://books-api.guaka.org/api/litres/search?q=book'), {
    LITRES_PUBLIC_DOMAIN_CATALOG_URL: 'https://catalog.bookstr.example/items.json',
  });
  assert.equal(invalidPayload.status, 502);
  assert.match((await invalidPayload.json()).error, /invalid response/);
});
