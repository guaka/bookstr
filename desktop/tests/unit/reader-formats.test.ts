const { test } = require('node:test') as typeof import('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { isEnabledReaderFormat, requireEnabledReaderFormat } = require('../../reader-formats') as typeof import('../../src/reader-formats');

test('reader format validation normalizes supported formats and rejects empty or disabled formats', () => {
  for (const value of ['epub', ' .PDF ', 'CBZ', '.cbr']) {
    assert.equal(isEnabledReaderFormat(value), true);
    assert.equal(requireEnabledReaderFormat(value), value.trim().toLowerCase().replace(/^\./, ''));
  }
  for (const value of [undefined, null, '', 'mobi', 'application/octet-stream', 'txt']) {
    assert.equal(isEnabledReaderFormat(value), false);
    assert.throws(() => requireEnabledReaderFormat(value), /unsupported acquisition format/);
  }
});
