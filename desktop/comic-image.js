'use strict';

// Inspect dimensions before any decoder allocates pixel buffers. These pure JS
// codecs work in packaged Electron on macOS, Windows, and Linux.
function legacyImagePng(bytes, maxPixels, maxBytes) {
  let width, height, data;
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) {
    width = bytes.readUInt16LE(6);
    height = bytes.readUInt16LE(8);
    if (!width || !height || width * height > maxPixels) throw new Error('Comic page dimensions exceed conversion limits.');
    const { GifReader } = require('omggif');
    const reader = new GifReader(bytes);
    if (reader.numFrames() < 1) throw new Error('GIF has no image frames.');
    // A PDF page is static; preserve the GIF's first frame.
    const frame = reader.frameInfo(0);
    if (frame.x + frame.width > width || frame.y + frame.height > height) throw new Error('Invalid GIF frame dimensions.');
    data = Buffer.alloc(width * height * 4);
    reader.decodeAndBlitFrameRGBA(0, data);
  } else if (bytes.length >= 54 && bytes.toString('ascii', 0, 2) === 'BM' && bytes.readUInt32LE(14) >= 40) {
    width = bytes.readInt32LE(18);
    height = Math.abs(bytes.readInt32LE(22));
    if (width <= 0 || !height || width * height > maxPixels) throw new Error('Comic page dimensions exceed conversion limits.');
    const bitmap = require('bmp-js').decode(bytes);
    if (bitmap.width !== width || bitmap.height !== height || bitmap.data.length !== width * height * 4) throw new Error('Invalid BMP dimensions.');
    data = Buffer.alloc(width * height * 4);
    // bmp-js returns ABGR. Legacy 24-bit comic pages have no alpha channel.
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = bitmap.data[offset + 3];
      data[offset + 1] = bitmap.data[offset + 2];
      data[offset + 2] = bitmap.data[offset + 1];
      data[offset + 3] = 255;
    }
  } else throw new Error('Unsupported legacy image header.');
  const png = require('pngjs').PNG.sync.write({ width, height, data });
  if (png.length > maxBytes) throw new Error('Converted comic page is too large.');
  return png;
}

module.exports = { legacyImagePng };
