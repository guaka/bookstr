import test from 'node:test';
import assert from 'node:assert/strict';

await import('../book-metadata.js');
const { desktopBlossomProxyUrl } = globalThis.BookMetadata;

test('maps trusted Blossom book URLs onto the Electron same-origin proxy', () => {
  const hash = 'a'.repeat(64);
  assert.equal(
    desktopBlossomProxyUrl(`https://blossom.bfr.ee/${hash}.EPUB`, hash.toUpperCase(), 'app://bookstr/index.html'),
    `app://bookstr/api/blossom/${hash}.epub`,
  );
  assert.equal(
    desktopBlossomProxyUrl(`https://blossom.bfr.ee/${hash}`, hash, 'app://bookstr/index.html'),
    `app://bookstr/api/blossom/${hash}`,
  );
  assert.equal(desktopBlossomProxyUrl(`https://example.test/${hash}.epub`, hash, 'app://bookstr/index.html'), '');
  assert.equal(desktopBlossomProxyUrl(`http://blossom.bfr.ee/${hash}.epub`, hash, 'app://bookstr/index.html'), '');
  assert.equal(desktopBlossomProxyUrl('https://blossom.bfr.ee/', hash, 'app://bookstr/index.html'), '');
  assert.equal(desktopBlossomProxyUrl(`https://blossom.bfr.ee/${'b'.repeat(64)}.epub`, hash, 'app://bookstr/index.html'), '');
  assert.equal(desktopBlossomProxyUrl(`https://blossom.bfr.ee/${hash}.zip`, hash, 'app://bookstr/index.html'), '');
  assert.equal(desktopBlossomProxyUrl('not a URL', hash, 'app://bookstr/index.html'), '');
  assert.equal(desktopBlossomProxyUrl(`https://blossom.bfr.ee/${hash}.epub`, 'bad hash', 'app://bookstr/index.html'), '');
  assert.equal(desktopBlossomProxyUrl(`https://blossom.bfr.ee/${hash}.epub`, hash, 'not a URL'), '');
});
