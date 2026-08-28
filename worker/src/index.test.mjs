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
