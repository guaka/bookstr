# Bookstr CORS worker

This Worker proxies the limited `all.books.party` API surface used by Bookstr
and adds CORS headers for `books.guaka.org`. It is not an open proxy.

It also exposes `/api/litres/search` as a fixed-origin LitRes adapter. Set
the worker's operator-owned `LITRES_PUBLIC_DOMAIN_CATALOG_URL` environment
value to a vetted public HTTPS catalogue produced through LitRes partner
access. The route returns records only when their data explicitly labels them
public domain, free, and directly downloadable as FB2. Custom OPDS feeds
never use this worker: clients fetch their configured public HTTPS feed
directly.

Deploy from this directory with Wrangler after authenticating to the Cloudflare
account that owns `guaka.org`:

```sh
npx wrangler deploy
```

The route in `wrangler.toml` sends `https://books.guaka.org/api/*` through the
Worker. The static page uses that same-origin route in production; local plain
HTML development continues to call `all.books.party` directly.
