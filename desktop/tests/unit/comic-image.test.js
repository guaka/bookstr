'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GifWriter } = require('omggif');
const bmp = require('bmp-js');
const { PNG } = require('pngjs');
const { legacyImagePng } = require('../../comic-image');

function tinyGif() {
  const buffer = Buffer.alloc(256);
  const writer = new GifWriter(buffer, 1, 1, { palette: [0xff0000, 0x000000] });
  writer.addFrame(0, 0, 1, 1, [0]);
  return buffer.subarray(0, writer.end());
}

function tinyBmp() {
  return bmp.encode({ data: Buffer.from([0, 0, 255, 255]), width: 1, height: 1 }).data;
}

test('legacy image conversion rejects unsupported headers before decoding', () => {
  assert.throws(() => legacyImagePng(Buffer.from('not-an-image'), 1_000_000, 1024), /Unsupported legacy image header/);
});

test('legacy GIF headers enforce pixel bounds before codec allocation', () => {
  const header = Buffer.alloc(10);
  header.write('GIF89a', 0, 'ascii');
  header.writeUInt16LE(10000, 6);
  header.writeUInt16LE(10000, 8);
  assert.throws(() => legacyImagePng(header, 1_000_000, 1024), /dimensions exceed conversion limits/);
});

test('legacy BMP headers enforce pixel bounds before codec allocation', () => {
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(8000, 18);
  header.writeInt32LE(8000, 22);
  assert.throws(() => legacyImagePng(header, 1_000_000, 1024), /dimensions exceed conversion limits/);
});

test('legacy GIF and BMP pages convert to bounded PNG bytes', () => {
  const gifPng = legacyImagePng(tinyGif(), 1_000_000, 1_000_000);
  const bmpPng = legacyImagePng(tinyBmp(), 1_000_000, 1_000_000);
  assert.equal(PNG.sync.read(gifPng).width, 1);
  assert.equal(PNG.sync.read(bmpPng).height, 1);
  assert.throws(() => legacyImagePng(tinyGif(), 1_000_000, 10), /too large/);
});
