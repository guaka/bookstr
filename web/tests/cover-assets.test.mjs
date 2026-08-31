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

test('cover failures and successes stay stable across library rerenders', () => {
  const key = 'stable-book';
  const failed = 'https://images.example/missing.jpg';
  const working = 'https://images.example/working.jpg';
  const listeners = {};
  const classes = new Set();
  const image = {
    src: failed,
    getAttribute: () => failed,
    addEventListener: (name, callback) => { listeners[name] = callback; },
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
  };
  attachImageFallback(image, [failed, working], { key });
  listeners.error();
  assert.equal(image.src, working);
  listeners.load();
  assert.equal(classes.has('is-loaded'), true);
  const candidates = bookCoverCandidates({ title: 'Stable', coverUrl: failed, thumbnail: working }, { key });
  assert.equal(candidates[0], working);
  assert.ok(!candidates.includes(failed));
});

test('cover candidates use every metadata alias and prefer a ready local Electron cover', () => {
  const local = `app://bookstr/api/library-cover/${'a'.repeat(32)}`;
  const candidates = bookCoverCandidates({
    coverUrl: 'https://images.example/first.jpg',
    thumbnail: 'https://images.example/second.jpg',
    metadata: { cover_url: 'https://images.example/third.jpg' },
  }, { desktop: true, key: 'aliases', localCoverUrl: local });
  assert.deepEqual(candidates.slice(0, 4), [
    local,
    'https://images.example/first.jpg',
    'https://images.example/second.jpg',
    'https://images.example/third.jpg',
  ]);
});
