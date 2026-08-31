const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.BookMetadata = {
  isbnForBook(book) {
    return String(book?.isbn || '').replace(/[^0-9X]/gi, '').toUpperCase();
  },
};
require('../../../web/cover-assets');

const { attachImageFallback, bookCoverCandidates, normalizeCoverUrl, placeholderCoverUrl, retryBookCover } = globalThis.CoverAssets;

test('desktop does not derive covers from private URLs or legacy hashes', () => {
  const candidates = bookCoverCandidates({
    md5: 'd'.repeat(32),
    title: 'Covered Book',
    coverUrl: `https://lib.b.bfr.ee/api/covers/${'d'.repeat(32)}`,
    coverSha256: 'c'.repeat(64),
  }, { desktop: true });
  assert.equal(candidates.length, 1);
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

test('web cover candidates ignore legacy hashes and use public catalog covers', () => {
  const md5 = 'a'.repeat(32);
  const sha256 = 'b'.repeat(64);
  const candidates = bookCoverCandidates({
    md5,
    title: '?',
    coverSha256: sha256,
    coverFormat: '.png',
    coverId: 42,
  }, { desktop: false });
  assert.equal(candidates[0], 'https://covers.openlibrary.org/b/id/42-M.jpg');
  assert.ok(!candidates.some(url => url.includes(sha256)));
  assert.ok(candidates.includes('https://covers.openlibrary.org/b/id/42-M.jpg'));
  assert.ok(!candidates.some(url => url.includes('lib.b.bfr.ee')));
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
  const noAttributeImage = {
    src: '',
    addEventListener: () => {},
  };
  attachImageFallback(noAttributeImage, ['data:image/svg+xml,only']);
  assert.equal(noAttributeImage.src, 'data:image/svg+xml,only');
});

test('placeholder hover can reset a failed cover candidate', () => {
  const key = 'hover-retry';
  const failed = 'https://images.example/hover-retry.jpg';
  const listeners = {};
  const image = {
    src: failed,
    getAttribute: () => failed,
    addEventListener: (name, callback) => { listeners[name] = callback; },
    classList: { remove() {} },
    closest: () => null,
    remove() {},
  };
  attachImageFallback(image, [failed], { key });
  listeners.error();
  assert.ok(!bookCoverCandidates({ coverUrl: failed }, { key }).includes(failed));
  retryBookCover(key);
  assert.ok(bookCoverCandidates({ coverUrl: failed }, { key }).includes(failed));
});

test('cover candidates reject unsafe hints and keep only usable public URLs', () => {
  assert.equal(normalizeCoverUrl('http://images.example/cover.jpg', true), '');
  assert.equal(normalizeCoverUrl('javascript:alert(1)', false), '');
  assert.equal(normalizeCoverUrl('data:image/png;base64,abc', false), 'data:image/png;base64,abc');
  assert.equal(normalizeCoverUrl('  https://images.example/cover.jpg  ', false), 'https://images.example/cover.jpg');

  const candidates = bookCoverCandidates({
    coverUrl: 'https://images.example/cover.jpg',
    coverFormat: 'pdf',
    coverId: 'not-a-number',
  }, { desktop: true });
  assert.ok(candidates.includes('https://images.example/cover.jpg'));
  assert.ok(candidates.every(url => !url.startsWith('http://')));

  for (const book of [
    { cover_url: 'https://images.example/legacy.jpg' },
    { thumbnail: 'https://images.example/thumbnail.jpg' },
    { image: 'https://images.example/image.jpg' },
    { metadata: { coverUrl: 'https://images.example/metadata.jpg' } },
  ]) {
    assert.ok(bookCoverCandidates(book, { desktop: true }).length > 1);
  }
});

test('cover candidates accept legacy aliases and deterministic placeholder initials', () => {
  assert.equal(normalizeCoverUrl('app://bookstr/cover.jpg', true), 'app://bookstr/cover.jpg');
  assert.equal(normalizeCoverUrl('./cover.jpg', false), './cover.jpg');
  assert.ok(decodeURIComponent(placeholderCoverUrl({ title: 'Ada' })).includes('>A</text>'));
  assert.ok(decodeURIComponent(placeholderCoverUrl({ title: '123' })).includes('>1</text>'));
  assert.ok(decodeURIComponent(placeholderCoverUrl({ title: '' })).includes('>B</text>'));
  assert.ok(decodeURIComponent(placeholderCoverUrl()).includes('>B</text>'));
  assert.equal(bookCoverCandidates({ md5: 'f'.repeat(32) }).length, 1);

  const candidates = bookCoverCandidates({
    cover_url: '//images.example/legacy.jpg',
    thumbnail: 'https://images.example/duplicate.jpg',
    image: 'https://images.example/image.jpg',
    metadata: { coverUrl: 'https://images.example/metadata.jpg' },
    cover_sha256: 'e'.repeat(64),
    cover_format: 'webp',
    cover_id: 12,
    isbn: '978-0-13-235088-4',
  }, { desktop: false });
  assert.ok(candidates.includes('https://images.example/legacy.jpg'));
  assert.ok(!candidates.some(url => url.includes('e'.repeat(64))));
});

test('desktop adds public catalog cover fallbacks without treating the letter placeholder as a real cover', () => {
  const candidates = bookCoverCandidates({
    md5: 'gutenberg:1661',
    sourceNativeId: 'OL123M',
  }, { desktop: true });
  assert.ok(candidates.includes('https://www.gutenberg.org/cache/epub/1661/pg1661.cover.medium.jpg'));
  assert.ok(candidates.includes('https://covers.openlibrary.org/b/olid/OL123M-M.jpg?default=false'));
  assert.ok(candidates.at(-1).startsWith('data:image/svg+xml,'));
});

test('cover candidates reject unsafe hints and keep only usable public URLs', () => {
  assert.equal(normalizeCoverUrl('http://images.example/cover.jpg', true), '');
  assert.equal(normalizeCoverUrl('javascript:alert(1)', false), '');
  assert.equal(normalizeCoverUrl('data:image/png;base64,abc', false), 'data:image/png;base64,abc');
  assert.equal(normalizeCoverUrl('  https://images.example/cover.jpg  ', false), 'https://images.example/cover.jpg');

  const candidates = bookCoverCandidates({
    coverUrl: 'https://images.example/cover.jpg',
    coverFormat: 'pdf',
    coverId: 'not-a-number',
  }, { desktop: true });
  assert.ok(candidates.includes('https://images.example/cover.jpg'));
  assert.ok(candidates.every(url => !url.startsWith('http://')));

  for (const book of [
    { cover_url: 'https://images.example/legacy.jpg' },
    { thumbnail: 'https://images.example/thumbnail.jpg' },
    { image: 'https://images.example/image.jpg' },
    { metadata: { coverUrl: 'https://images.example/metadata.jpg' } },
  ]) {
    assert.ok(bookCoverCandidates(book, { desktop: true }).length > 1);
  }
});

test('cover candidates accept legacy aliases and deterministic placeholder initials', () => {
  assert.equal(normalizeCoverUrl('app://bookstr/cover.jpg', true), 'app://bookstr/cover.jpg');
  assert.equal(normalizeCoverUrl('./cover.jpg', false), './cover.jpg');
  assert.ok(decodeURIComponent(placeholderCoverUrl({ title: 'Ada' })).includes('>A</text>'));
  assert.ok(decodeURIComponent(placeholderCoverUrl({ title: '123' })).includes('>1</text>'));
  assert.ok(decodeURIComponent(placeholderCoverUrl({ title: '' })).includes('>B</text>'));
  assert.ok(decodeURIComponent(placeholderCoverUrl()).includes('>B</text>'));
  assert.equal(bookCoverCandidates({ md5: 'f'.repeat(32) }).length, 1);

  const candidates = bookCoverCandidates({
    cover_url: '//images.example/legacy.jpg',
    thumbnail: 'https://images.example/duplicate.jpg',
    image: 'https://images.example/image.jpg',
    metadata: { coverUrl: 'https://images.example/metadata.jpg' },
    cover_sha256: 'e'.repeat(64),
    cover_format: 'webp',
    cover_id: 12,
    isbn: '978-0-13-235088-4',
  }, { desktop: false });
  assert.ok(candidates.includes('https://images.example/legacy.jpg'));
  assert.ok(!candidates.some(url => url.includes('e'.repeat(64))));
});
