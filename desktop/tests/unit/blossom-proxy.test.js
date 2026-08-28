const test = require('node:test');
const assert = require('node:assert/strict');

const {
  blossomBlobNameFromUrl,
  blossomUpstreamUrl,
  proxyBlossomRequest,
} = require('../../blossom-proxy');

test('Blossom proxy accepts only hash-addressed EPUB, PDF, and FB2 downloads', () => {
  const hash = 'a'.repeat(64);
  assert.equal(blossomBlobNameFromUrl(`app://bookstr/api/blossom/${hash}`), hash);
  assert.equal(blossomBlobNameFromUrl(`app://bookstr/api/blossom/${hash}.EPUB`), `${hash}.epub`);
  assert.equal(
    blossomUpstreamUrl(`app://bookstr/api/blossom/${hash}.pdf`, 'https://blossom.test/'),
    `https://blossom.test/${hash}.pdf`,
  );
  assert.equal(blossomBlobNameFromUrl(`app://bookstr/api/blossom/${hash}.FB2.ZIP`), `${hash}.fb2.zip`);
  for (const url of [
    'not a URL',
    'app://bookstr/index.html',
    `app://bookstr/api/blossom/${hash}.jpg`,
    `app://bookstr/api/blossom/${hash}.epub?redirect=https://example.test`,
    'app://bookstr/api/blossom/not-a-hash.epub',
    `app://bookstr/api/blossom/${hash}%2Fextra.epub`,
    `app://bookstr/api/blossom/${hash}%ZZ.epub`,
  ]) {
    assert.equal(blossomBlobNameFromUrl(url), '');
  }
});

test('Blossom proxy streams signed downloads and preserves response metadata', async () => {
  const hash = 'b'.repeat(64);
  const authorization = 'Nostr signed-event';
  const calls = [];
  const response = await proxyBlossomRequest(
    new Request(`app://bookstr/api/blossom/${hash}.epub`, {
      headers: { Accept: 'application/epub+zip', Authorization: authorization },
    }),
    async (url, options) => {
      calls.push({ url, options });
      return new Response('EPUB fixture', {
        status: 200,
        headers: {
          'Content-Type': 'application/epub+zip',
          ETag: 'fixture-etag',
        },
      });
    },
    'https://blossom.test',
  );

  assert.deepEqual(calls, [{
    url: `https://blossom.test/${hash}.epub`,
    options: {
      method: 'GET',
      headers: { Accept: 'application/epub+zip', Authorization: authorization },
    },
  }]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/epub+zip');
  assert.equal(response.headers.get('etag'), 'fixture-etag');
  assert.equal(await response.text(), 'EPUB fixture');
});

test('Blossom proxy rejects mutations, strips unrelated auth, and handles outages', async () => {
  const hash = 'c'.repeat(64);
  const noFetch = () => assert.fail('fetch must not run');
  assert.equal(
    await proxyBlossomRequest(new Request('app://bookstr/index.html'), noFetch),
    null,
  );

  const rejected = await proxyBlossomRequest(
    new Request(`app://bookstr/api/blossom/${hash}`, { method: 'POST' }),
    noFetch,
  );
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get('allow'), 'GET, HEAD');

  const head = await proxyBlossomRequest(
    new Request(`app://bookstr/api/blossom/${hash}`, { method: 'HEAD', headers: { Authorization: 'Bearer secret' } }),
    async (_url, options) => {
      assert.deepEqual(options.headers, { Accept: '*/*' });
      return new Response(null, { status: 200 });
    },
  );
  assert.equal(head.status, 200);

  const unavailable = await proxyBlossomRequest(
    new Request(`app://bookstr/api/blossom/${hash}`),
    async () => { throw new Error('offline'); },
  );
  assert.equal(unavailable.status, 502);
  assert.equal(await unavailable.text(), 'Blossom download unavailable');
});
