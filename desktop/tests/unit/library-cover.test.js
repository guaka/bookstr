const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('../../../web/jszip.min.js');

const { detectImage, epubCover, fb2Cover, localBookCover, safeCoverID } = require('../../library-cover');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function coveredEpub() {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
  zip.file('OPS/book.opf', '<package><metadata><meta name="cover" content="art"/></metadata><manifest><item id="art" href="images/front.png" media-type="image/png"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest></package>');
  zip.file('OPS/images/front.png', PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('extracts the OPF-declared EPUB cover instead of guessing from the filename', async () => {
  const cover = await epubCover(await coveredEpub());
  assert.equal(cover.mime, 'image/png');
  assert.deepEqual(cover.bytes, PNG);
});

test('extracts an FB2 coverpage binary', () => {
  const xml = Buffer.from(`<FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><coverpage><image l:href="#front-art"/></coverpage></title-info></description><binary id="front-art" content-type="image/png">${PNG.toString('base64')}</binary></FictionBook>`);
  const cover = fb2Cover(xml);
  assert.equal(cover.mime, 'image/png');
  assert.deepEqual(cover.bytes, PNG);
});

test('caches a local cover by a filesystem-safe book digest', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-cover-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bookPath = path.join(root, 'book.epub');
  const cacheDir = path.join(root, 'covers');
  fs.writeFileSync(bookPath, await coveredEpub());
  const bookId = 'a'.repeat(32);
  const first = await localBookCover({ bookId, bookPath, cacheDir });
  const second = await localBookCover({ bookId, bookPath, cacheDir });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.path, path.join(cacheDir, `${bookId}.png`));
  assert.equal(safeCoverID('../unsafe'), '');
  assert.equal(detectImage(Buffer.from('not an image')), null);
});
