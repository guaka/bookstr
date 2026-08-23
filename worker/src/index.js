const UPSTREAM_ORIGIN = 'https://all.books.party';
const WIKDICT_ORIGIN = 'https://download.wikdict.com/dictionaries/sqlite/2';
const ALLOWED_ORIGINS = new Set([
  'https://books.guaka.org',
  'http://localhost:11111',
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

function allowedPath(pathname) {
  return /^\/api\/search$/.test(pathname)
    || /^\/api\/books\/\d+$/.test(pathname)
    || /^\/api\/books\/\d+\/download$/.test(pathname)
    || /^\/api\/dictionaries\/[a-z]{2}-[a-z]{2}(?:\.sqlite3)?$/.test(pathname);
}

export default {
  async fetch(request) {
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    const incoming = new URL(request.url);
    if (!allowedPath(incoming.pathname)) {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const dictionaryMatch = incoming.pathname.match(/^\/api\/dictionaries\/([a-z]{2}-[a-z]{2})(?:\.sqlite3)?$/);
    const upstream = dictionaryMatch
      ? new URL(`${WIKDICT_ORIGIN}/${dictionaryMatch[1]}.sqlite3`)
      : new URL(`${UPSTREAM_ORIGIN}${incoming.pathname}`);
    if (!dictionaryMatch) upstream.search = incoming.search;

    try {
      const response = await fetch(upstream, {
        method: request.method,
        redirect: 'follow',
        headers: { Accept: request.headers.get('Accept') || '*/*' },
      });
      const headers = new Headers(cors);
      for (const name of ['Content-Type', 'Cache-Control', 'ETag', 'Last-Modified', 'Location']) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        headers,
      });
    } catch {
      return new Response('Upstream unavailable', { status: 502, headers: cors });
    }
  },
};
