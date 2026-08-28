const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.BookMetadata = {
  isbnForBook(book) {
    return String(book?.isbn || '').replace(/[^0-9X]/gi, '').toUpperCase();
  },
};
require('../../../web/cover-assets');

const { attachImageFallback, bookCoverCandidates, normalizeCoverUrl } = globalThis.CoverAssets;

test('desktop uses public cover candidates instead of private LibVault image URLs', () => {
  const sha256 = 'c'.repeat(64);
  const candidates = bookCoverCandidates({
    md5: 'd'.repeat(32),
    title: 'Covered Book',
    coverUrl: `https://lib.b.bfr.ee/api/covers/${'d'.repeat(32)}`,
    coverSha256: sha256,
  }, { desktop: true });
  assert.equal(candidates[0], `https://blossom.bfr.ee/${sha256}.jpg`);
  assert.ok(candidates.at(-1).startsWith('data:image/svg+xml,'));
  assert.ok(!candidates.some(url => url.includes('lib.b.bfr.ee')));
});

test('cover URL normalization keeps public and web-relative images', () => {
  assert.equal(normalizeCoverUrl('//images.example/cover.jpg', true), 'https://images.example/cover.jpg');
  assert.equal(normalizeCoverUrl('/relative.jpg', true), '');
  assert.equal(normalizeCoverUrl('/relative.jpg', false), '/relative.jpg');
  const candidates = bookCoverCandidates({ coverUrl: 'https://images.example/cover.jpg', isbn: '978-0-13-235088-4' }, { desktop: true });
  assert.ok(candidates.some(url => url.includes('/b/isbn/9780132350884-M.jpg')));
  assert.equal(normalizeCoverUrl('', true), '');
  assert.equal(normalizeCoverUrl('http://insecure.example/cover.jpg', false), '');
});

test('web cover candidates retain LibVault fallback and honor cover formats and bases', () => {
  const md5 = 'a'.repeat(32);
  const sha256 = 'b'.repeat(64);
  const candidates = bookCoverCandidates({
    md5,
    title: '?',
    coverSha256: sha256,
    coverFormat: '.png',
    coverId: 42,
  }, {
    desktop: false,
    blossomBase: 'https://media.example',
    libVaultCoverBase: 'https://library.example/covers',
  });
  assert.equal(candidates[0], `https://media.example/${sha256}.png`);
  assert.equal(candidates.filter(url => url.endsWith('.png')).length, 1);
  assert.ok(candidates.includes('https://covers.openlibrary.org/b/id/42-M.jpg'));
  assert.ok(candidates.includes(`https://library.example/covers/${md5}`));
  assert.ok(decodeURIComponent(candidates.at(-1)).includes('>B</text>'));
  assert.equal(bookCoverCandidates({}, { desktop: true }).length, 1);
});

test('cover image fallback advances candidates and removes an exhausted image', () => {
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
  assert.doesNotThrow(() => attachImageFallback(null, []));
  const blankListeners = {};
  const blank = {
    src: '',
    getAttribute: () => '',
    addEventListener: (name, callback) => { blankListeners[name] = callback; },
  };
  attachImageFallback(blank, ['data:image/svg+xml,only']);
  assert.equal(blank.src, 'data:image/svg+xml,only');
  blankListeners.error();
});
