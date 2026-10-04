'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { downloadsForRenderer } = require('../../library-downloads');

test('renderer downloads expose only verified registered reader files as readable', async () => {
  const rows = [
    { bookId: 'epub', status: 'ready' },
    { bookId: 'comic', status: 'ready' },
    { bookId: 'missing', status: 'ready' },
    { bookId: 'fb2', status: 'ready' },
    { bookId: 'cbz', status: 'ready' },
    { bookId: 'pdf', status: 'ready' },
    { bookId: 'txt', status: 'ready' },
  ];
  const results = await downloadsForRenderer(rows, async bookId => {
    if (bookId === 'missing') throw new Error('missing');
    if (bookId === 'epub') return { filePath: '/library/book.epub', book: { extension: 'epub' } };
    if (bookId === 'comic') return { filePath: '/library/comic.cbr', book: { extension: 'cbr' } };
    return { filePath: `/library/book.${bookId}`, book: { extension: bookId } };
  });
  assert.deepEqual(results.map(item => item.readable), [true, true, false, true, true, true, false]);
  assert.equal(Object.hasOwn(results[0], 'filePath'), false);
});

test('renderer downloads reject mismatched registered and catalog formats', async () => {
  const [result] = await downloadsForRenderer([{ bookId: 'mismatch' }], async () => ({
    filePath: '/library/book.pdf', book: { extension: 'epub' },
  }));
  assert.equal(result.readable, false);
});
