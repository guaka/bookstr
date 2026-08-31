import test from 'node:test';
import assert from 'node:assert/strict';

await import('../book-metadata.js');
await import('../cover-assets.js');

const { attachImageFallback, bookCoverCandidates, normalizeCoverUrl } = globalThis.CoverAssets;

test('desktop cover candidates ignore LibVault and prefer Open Library before blob fallbacks', () => {
  const sha256 = 'c'.repeat(64);
  const candidates = bookCoverCandidates({
    md5: 'd'.repeat(32),
    title: 'Covered Book',
    coverUrl: `https://lib.b.bfr.ee/api/covers/${'d'.repeat(32)}`,
    coverSha256: sha256,
    coverId: 12345,
  }, { desktop: true });
  assert.equal(candidates[0], 'https://covers.openlibrary.org/b/id/12345-M.jpg');
  assert.ok(candidates.indexOf(`https://blossom.bfr.ee/${sha256}.jpg`) > 0);
  assert.ok(candidates.at(-1).startsWith('data:image/svg+xml,'));
  assert.ok(!candidates.some(url => url.includes('lib.b.bfr.ee')));
  assert.equal(normalizeCoverUrl(`https://lib.b.bfr.ee/api/covers/${'d'.repeat(32)}`, false), '');
});

test('cover candidates retain public URLs and add Open Library ISBN fallback', () => {
  const candidates = bookCoverCandidates({
    title: 'Public Book',
    coverUrl: '//images.example/cover.jpg',
    isbn: '978-0-13-235088-4',
  }, { desktop: true });
  assert.equal(candidates[0], 'https://images.example/cover.jpg');
  assert.ok(candidates.some(url => url.includes('/b/isbn/9780132350884-M.jpg')));
  assert.equal(normalizeCoverUrl('/relative.jpg', true), '');
  assert.equal(normalizeCoverUrl('/relative.jpg', false), '/relative.jpg');
});

test('image fallback advances candidates and removes an exhausted image', () => {
  const listeners = {};
  const image = {
    src: 'https://first.example/cover.jpg',
    getAttribute: () => 'https://first.example/cover.jpg',
    addEventListener: (name, callback) => { listeners[name] = callback; },
    remove: () => { image.removed = true; },
  };
  attachImageFallback(image, ['https://first.example/cover.jpg', 'data:image/svg+xml,fallback']);
  listeners.error();
  assert.equal(image.src, 'data:image/svg+xml,fallback');
  listeners.error();
  assert.equal(image.removed, true);
});
