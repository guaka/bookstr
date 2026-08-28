const CATALOG_BASE_URL = 'https://books-api.guaka.org/api';
const UNGLUE_OPDS_BASE_URL = 'https://unglue.it/api/opds/s.open';
const GUTENDEX_BASE_URL = 'https://gutendex.com/books/';
const OAPEN_SEARCH_BASE_URL = 'https://library.oapen.org/rest/search';
const OAPEN_BITSTREAM_BASE_URL = 'https://library.oapen.org/rest/bitstreams';
const OPEN_TEXTBOOKS_BASE_URL = 'https://open.umn.edu/opentextbooks/textbooks.json';
const DOAB_SEARCH_BASE_URL = 'https://directory.doabooks.org/rest/search';
const GDL_BASE_URL = 'https://content.digitallibrary.io';

const CATALOG_PATHS = [
  /^\/api\/search$/,
  /^\/api\/opds$/,
  /^\/api\/gutendex$/,
  /^\/api\/oapen$/,
  /^\/api\/oapen-file$/,
  /^\/api\/open-textbooks$/,
  /^\/api\/doab$/,
  /^\/api\/gdl$/,
  /^\/api\/gdl-epub$/,
  /^\/api\/books\/\d+$/,
  /^\/api\/books\/\d+\/download$/,
];

function catalogUpstreamUrl(
  url,
  baseUrl = CATALOG_BASE_URL,
  unglueBaseUrl = UNGLUE_OPDS_BASE_URL,
  gutendexBaseUrl = GUTENDEX_BASE_URL,
) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (!CATALOG_PATHS.some(pattern => pattern.test(parsed.pathname))) return '';
  if (parsed.pathname === '/api/oapen-file') {
    const id = String(parsed.searchParams.get('id') || '').trim().toLowerCase();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) return '';
    return `${OAPEN_BITSTREAM_BASE_URL}/${id}/retrieve`;
  }
  if (parsed.pathname === '/api/oapen') {
    const query = String(parsed.searchParams.get('query') || '').trim();
    if (!query) return '';
    const upstream = new URL(OAPEN_SEARCH_BASE_URL);
    upstream.searchParams.set('query', query);
    upstream.searchParams.set('expand', 'metadata,bitstreams');
    upstream.searchParams.set('limit', '50');
    return upstream.href;
  }
  if (parsed.pathname === '/api/open-textbooks') {
    const query = String(parsed.searchParams.get('query') || '').trim();
    if (!query) return '';
    const upstream = new URL(OPEN_TEXTBOOKS_BASE_URL);
    upstream.searchParams.set('q', query);
    return upstream.href;
  }
  if (parsed.pathname === '/api/doab') {
    const query = String(parsed.searchParams.get('query') || '').trim();
    if (!query) return '';
    const upstream = new URL(DOAB_SEARCH_BASE_URL);
    upstream.searchParams.set('query', query);
    upstream.searchParams.set('expand', 'metadata,bitstreams');
    upstream.searchParams.set('limit', '50');
    return upstream.href;
  }
  if (parsed.pathname === '/api/gdl') {
    const query = String(parsed.searchParams.get('query') || '').trim();
    if (!query) return '';
    const upstream = new URL(`${GDL_BASE_URL}/wp-json/content-api/v1/contentsearch`);
    upstream.searchParams.set('query', query);
    upstream.searchParams.set('_skip', '0');
    return upstream.href;
  }
  if (parsed.pathname === '/api/gdl-epub') {
    const id = String(parsed.searchParams.get('id') || '').trim();
    if (!/^\d+$/.test(id)) return '';
    return `${GDL_BASE_URL}/wp-json/epub-generator/v1/book/${id}`;
  }
  if (parsed.pathname === '/api/gutendex') {
    const query = String(parsed.searchParams.get('query') || '').trim();
    if (!query) return '';
    const upstream = new URL(gutendexBaseUrl);
    upstream.searchParams.set('search', query);
    return upstream.href;
  }
  if (parsed.pathname === '/api/opds') {
    const query = String(parsed.searchParams.get('query') || '').trim();
    if (!query) return '';
    const upstreamBase = String(unglueBaseUrl).replace(/\/s\.open\/?$/, '');
    const upstream = new URL(`${upstreamBase}/s.${encodeURIComponent(query)}/`);
    upstream.searchParams.set('order_by', parsed.searchParams.get('order_by') || 'newest');
    return upstream.href;
  }
  const upstream = new URL(`${String(baseUrl).replace(/\/$/, '')}${parsed.pathname.slice(4)}`);
  upstream.search = parsed.search;
  return upstream.href;
}

async function proxyCatalogRequest(request, fetchImpl, baseUrl = CATALOG_BASE_URL) {
  const upstreamUrl = catalogUpstreamUrl(request.url, baseUrl);
  if (!upstreamUrl) return null;
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  }
  try {
    const pathname = new URL(request.url).pathname;
    const accept = pathname === '/api/opds'
      ? 'application/atom+xml;profile=opds-catalog'
      : ['/api/oapen', '/api/open-textbooks', '/api/doab', '/api/gdl'].includes(pathname)
        ? 'application/json'
        : request.headers.get('Accept') || '*/*';
    const upstream = await fetchImpl(upstreamUrl, {
      method: request.method,
      headers: { Accept: accept },
    });
    const headers = new Headers();
    for (const name of ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return new Response('Catalog unavailable', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  }
}

module.exports = {
  CATALOG_BASE_URL,
  GUTENDEX_BASE_URL,
  OAPEN_BITSTREAM_BASE_URL,
  OAPEN_SEARCH_BASE_URL,
  OPEN_TEXTBOOKS_BASE_URL,
  DOAB_SEARCH_BASE_URL,
  GDL_BASE_URL,
  UNGLUE_OPDS_BASE_URL,
  catalogUpstreamUrl,
  proxyCatalogRequest,
};
