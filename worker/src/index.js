import { isPublicHTTPSURL, normalizeLitresPublicDomainRecords } from '../../shared/catalog/opds.js';

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

export function allowedPath(pathname) {
  return /^\/api\/search$/.test(pathname)
    || /^\/api\/books\/\d+$/.test(pathname)
    || /^\/api\/books\/\d+\/download$/.test(pathname)
    || /^\/api\/dictionaries\/[a-z]{2}-[a-z]{2}(?:\.sqlite3)?$/.test(pathname)
    || /^\/api\/litres\/search$/.test(pathname);
}

function jsonResponse(value, { request, status = 200, extraHeaders = {} }) {
  const headers = new Headers(corsHeaders(request));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=300');
  for (const [name, headerValue] of Object.entries(extraHeaders)) headers.set(name, headerValue);
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(value), { status, headers });
}

function litResSearchRequest(incoming, env) {
  const query = incoming.searchParams.get('q')?.trim() || '';
  if (!query || query.length > 160) return null;
  const limit = Math.min(50, Math.max(1, Number(incoming.searchParams.get('limit')) || 20));
  const catalogURL = String(env?.LITRES_PUBLIC_DOMAIN_CATALOG_URL || '').trim();
  if (!isPublicHTTPSURL(catalogURL)) return { query, limit, catalogURL: '' };
  return { query, limit, catalogURL: new URL(catalogURL).href };
}

function matchesLitResQuery(record, query) {
  const terms = String(query || '').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const searchable = [record?.title, ...(record?.authors || [])].join(' ').toLocaleLowerCase();
  return terms.every(term => searchable.includes(term));
}

async function fetchLitResPublicDomain(request, incoming, env) {
  const search = litResSearchRequest(incoming, env);
  if (!search) {
    return jsonResponse({ error: 'A search query of at most 160 characters is required.' }, { request, status: 400 });
  }
  if (!search.catalogURL) {
    return jsonResponse({ error: 'LitRes public-domain catalogue is not configured.' }, { request, status: 503 });
  }
  let response;
  try {
    response = await fetch(search.catalogURL, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return jsonResponse({ error: 'LitRes is unavailable.' }, { request, status: 502 });
  }
  if (!response.ok) {
    return jsonResponse({ error: `LitRes search failed (${response.status}).` }, { request, status: response.status });
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    return jsonResponse({ error: 'LitRes returned an invalid response.' }, { request, status: 502 });
  }
  // The normalizer requires explicit public-domain rights, zero/free pricing,
  // and a direct HTTPS FB2 file. A landing page or an ambiguous record is not
  // returned to Bookstr.
  const records = normalizeLitresPublicDomainRecords(payload)
    .filter(record => matchesLitResQuery(record, search.query))
    .slice(0, search.limit);
  return jsonResponse({ records }, { request });
}

export default {
  async fetch(request, env = {}) {
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
    if (incoming.pathname === '/api/litres/search') {
      return fetchLitResPublicDomain(request, incoming, env);
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
