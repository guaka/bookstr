const test = require('node:test');
const assert = require('node:assert/strict');

const { appContentSecurityPolicy } = require('../../security-policy');

test('desktop CSP permits secure Nostr relay WebSockets', () => {
  const policy = appContentSecurityPolicy();
  assert.match(policy, /connect-src 'self' https: wss:;/);
  assert.match(policy, /frame-src 'self' app:;/);
  assert.doesNotMatch(policy, /script-src[^;]*nonce-/);
});

test('desktop CSP adds only the supplied script nonce', () => {
  const policy = appContentSecurityPolicy('fixture-nonce');
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval' 'nonce-fixture-nonce';/);
});
