const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dictionaryPairFromPath,
  proxyDictionaryRequest,
} = require('../../dictionary-proxy');

test('dictionary paths only accept distinct supported language pairs', () => {
  assert.equal(dictionaryPairFromPath('/api/dictionaries/pt-en.sqlite3'), 'pt-en');
  assert.equal(dictionaryPairFromPath('/api/dictionaries/en-en.sqlite3'), null);
  assert.equal(dictionaryPairFromPath('/api/dictionaries/xx-en.sqlite3'), null);
  assert.equal(dictionaryPairFromPath('/api/dictionaries/PT-en.sqlite3'), null);
  assert.equal(dictionaryPairFromPath('/api/dictionaries/pt-en.sqlite3/extra'), null);
  assert.equal(dictionaryPairFromPath(''), null);
});

test('unrelated app resources are not handled by the dictionary proxy', async () => {
  const response = await proxyDictionaryRequest(
    new Request('app://bookstr/index.html'),
    () => assert.fail('fetch must not run'),
  );
  assert.equal(response, null);
});

test('dictionary proxy rejects unsupported methods and invalid pairs', async () => {
  const fetchImpl = () => assert.fail('fetch must not run');
  const methodResponse = await proxyDictionaryRequest(
    new Request('app://bookstr/api/dictionaries/pt-en.sqlite3', { method: 'POST' }),
    fetchImpl,
  );
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('allow'), 'GET, HEAD');
  assert.equal(await methodResponse.text(), 'Method not allowed');

  const pairResponse = await proxyDictionaryRequest(
    new Request('app://bookstr/api/dictionaries/en-en.sqlite3'),
    fetchImpl,
  );
  assert.equal(pairResponse.status, 400);
  assert.equal(await pairResponse.text(), 'Invalid dictionary pair');
});

test('dictionary proxy forwards successful and upstream error responses', async () => {
  const calls = [];
  const success = await proxyDictionaryRequest(
    new Request('app://bookstr/api/dictionaries/pt-en.sqlite3'),
    async (url, options) => {
      calls.push({ url, options });
      return new Response('SQLite fixture', {
        status: 200,
        headers: {
          'Content-Type': 'application/x-sqlite3',
          'Content-Length': '14',
        },
      });
    },
    'https://dictionary.test/files',
  );
  assert.deepEqual(calls, [{
    url: 'https://dictionary.test/files/pt-en.sqlite3',
    options: { method: 'GET' },
  }]);
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('content-type'), 'application/x-sqlite3');
  assert.equal(success.headers.get('content-length'), '14');
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.equal(await success.text(), 'SQLite fixture');

  const missing = await proxyDictionaryRequest(
    new Request('app://bookstr/api/dictionaries/pt-en.sqlite3'),
    async () => new Response('Not found', { status: 404 }),
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('content-type'), 'text/plain;charset=UTF-8');
  assert.equal(await missing.text(), 'Not found');
});

test('dictionary proxy supports HEAD and converts network errors to 502', async () => {
  const head = await proxyDictionaryRequest(
    new Request('app://bookstr/api/dictionaries/pt-en.sqlite3', { method: 'HEAD' }),
    async (_url, options) => {
      assert.equal(options.method, 'HEAD');
      return new Response(null, { status: 200 });
    },
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const unavailable = await proxyDictionaryRequest(
    new Request('app://bookstr/api/dictionaries/pt-en.sqlite3'),
    async () => { throw new Error('offline'); },
  );
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.headers.get('content-type'), 'text/plain; charset=UTF-8');
  assert.equal(await unavailable.text(), 'Dictionary download unavailable');
});
