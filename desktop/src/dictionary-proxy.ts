export const DICTIONARY_BASE_URL = 'https://books-api.guaka.org/api/dictionaries';

const DICTIONARY_LANGUAGE_CODES = new Set([
  'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'ga', 'id',
  'it', 'ja', 'ku', 'la', 'lt', 'mg', 'nl', 'no', 'pl', 'pt', 'ru', 'sv',
  'tr', 'zh',
]);

const DICTIONARY_PATH_PREFIX = '/api/dictionaries/';

export function dictionaryPairFromPath(pathname: string): string | null {
  const match = String(pathname || '').match(/^\/api\/dictionaries\/([a-z]{2})-([a-z]{2})\.sqlite3$/);
  if (!match) return null;
  const [, source = '', target = ''] = match;
  if (source === target || !DICTIONARY_LANGUAGE_CODES.has(source) || !DICTIONARY_LANGUAGE_CODES.has(target)) {
    return null;
  }
  return `${source}-${target}`;
}

function dictionaryResponse(
  body: BodyInit | null,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export type DictionaryFetch = (
  url: string,
  options: { method: string },
) => Promise<Response>;

export async function proxyDictionaryRequest(
  request: Request,
  fetchImpl: DictionaryFetch,
  baseUrl = DICTIONARY_BASE_URL,
): Promise<Response | null> {
  const parsed = new URL(request.url);
  if (!parsed.pathname.startsWith(DICTIONARY_PATH_PREFIX)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return dictionaryResponse('Method not allowed', 405, { Allow: 'GET, HEAD' });
  }
  const pair = dictionaryPairFromPath(parsed.pathname);
  if (!pair) return dictionaryResponse('Invalid dictionary pair', 400);

  try {
    const upstream = await fetchImpl(`${baseUrl}/${pair}.sqlite3`, { method: request.method });
    const headers: Record<string, string> = {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    };
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers['Content-Length'] = contentLength;
    return dictionaryResponse(request.method === 'HEAD' ? null : upstream.body, upstream.status, headers);
  } catch {
    return dictionaryResponse('Dictionary download unavailable', 502, {
      'Content-Type': 'text/plain; charset=UTF-8',
    });
  }
}
