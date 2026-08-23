# Bookstr CORS worker

This Worker proxies the limited `all.books.party` API surface used by Bookstr
and adds CORS headers for `books.guaka.org`. It is not an open proxy.

Deploy from this directory with Wrangler after authenticating to the Cloudflare
account that owns `guaka.org`:

```sh
npx wrangler deploy
```

The route in `wrangler.toml` sends `https://books.guaka.org/api/*` through the
Worker. The static page uses that same-origin route in production; local plain
HTML development continues to call `all.books.party` directly.
