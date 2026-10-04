'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { comicPages } = require('../../comic-pdf');

function listing(entries) {
  return entries.map(entry => Object.entries(entry).map(([key, value]) => `${key} = ${value}`).join('\n')).join('\n\n');
}

test('comic page listing keeps JPEG/PNG pages and rejects EPUB packages', () => {
  const pages = comicPages(listing([
    { Path: '02.png', Size: '1200', Folder: '-' },
    { Path: '01.jpg', Size: '900', Folder: '-' },
    { Path: '__MACOSX/._01.jpg', Size: '40', Folder: '-' },
  ]));
  assert.deepEqual(pages.map(page => page.name), ['01.jpg', '02.png']);
  assert.throws(
    () => comicPages(listing([
      { Path: 'META-INF/container.xml', Size: '80', Folder: '-' },
      { Path: 'page.jpg', Size: '900', Folder: '-' },
    ])),
    /EPUB/,
  );
});

test('comic page listing enforces path and size bounds', () => {
  assert.throws(
    () => comicPages(listing([{ Path: '../escape.jpg', Size: '100', Folder: '-' }])),
    /unsafe path/,
  );
  assert.throws(
    () => comicPages(listing([{ Path: 'page.webp', Size: '100', Folder: '-' }])),
    /Unsupported comic image format/,
  );
  assert.throws(
    () => comicPages(listing([{ Path: 'page.jpg', Size: String(30 * 1024 * 1024), Folder: '-' }])),
    /too large or invalid/,
  );
});
