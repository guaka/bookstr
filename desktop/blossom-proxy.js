const BLOSSOM_BASE_URL = 'https://blossom.bfr.ee';
const BLOSSOM_PROXY_PATH_PREFIX = '/api/blossom/';
const BLOSSOM_BLOB_NAME = /^[a-f0-9]{64}(?:\.(?:epub|pdf|fb2(?:\.zip)?))?$/i;

function blossomBlobNameFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (!parsed.pathname.startsWith(BLOSSOM_PROXY_PATH_PREFIX) || parsed.search) return '';
  const encodedName = parsed.pathname.slice(BLOSSOM_PROXY_PATH_PREFIX.length);
  let name;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    return '';
  }
  return BLOSSOM_BLOB_NAME.test(name) ? name.toLowerCase() : '';
}

function blossomUpstreamUrl(url, baseUrl = BLOSSOM_BASE_URL) {
  const name = blossomBlobNameFromUrl(url);
  if (!name) return '';
  return `${String(baseUrl).replace(/\/$/, '')}/${name}`;
}

async function proxyBlossomRequest(request, fetchImpl, baseUrl = BLOSSOM_BASE_URL) {
  const upstreamUrl = blossomUpstreamUrl(request.url, baseUrl);
  if (!upstreamUrl) return null;
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  }

  const headers = { Accept: request.headers.get('Accept') || '*/*' };
  const authorization = request.headers.get('Authorization');
  if (authorization?.startsWith('Nostr ') && authorization.length <= 32_768) {
    headers.Authorization = authorization;
  }

  try {
    const upstream = await fetchImpl(upstreamUrl, { method: request.method, headers });
    const responseHeaders = new Headers();
    for (const name of ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response('Blossom download unavailable', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  }
}

module.exports = {
  BLOSSOM_BASE_URL,
  blossomBlobNameFromUrl,
  blossomUpstreamUrl,
  proxyBlossomRequest,
};
