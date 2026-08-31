function appContentSecurityPolicy(nonce = '') {
  const nonceSource = nonce ? ` 'nonce-${nonce}'` : '';
  return [
    "default-src 'self' app:;",
    "base-uri 'self';",
    "connect-src 'self' https: wss:;",
    "font-src 'self' https: data:;",
    "img-src 'self' https: data: blob:;",
    `script-src 'self' 'wasm-unsafe-eval'${nonceSource};`,
    "style-src 'self' 'unsafe-inline';",
    "worker-src 'self' blob:;",
    "frame-src 'self' app:;",
    "object-src 'none';",
  ].join(' ');
}

module.exports = { appContentSecurityPolicy };
