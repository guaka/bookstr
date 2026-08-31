const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('../../../web/jszip.min.js');

const {
  detectImage,
  epubCover,
  epubMetadata,
  fb2Cover,
  fb2Metadata,
  localBookCover,
  localBookMetadata,
  safeCoverID,
} = require('../../library-cover');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function coveredEpub() {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
  zip.file('OPS/book.opf', '<package><metadata><dc:title xmlns:dc="dc">A &amp; B</dc:title><dc:creator xmlns:dc="dc">Fixture Author</dc:creator><dc:language xmlns:dc="dc">pt-PT</dc:language><dc:identifier xmlns:dc="dc">urn:isbn:978-0-00-000000-0</dc:identifier><meta name="cover" content="art"/></metadata><manifest><item id="art" href="images/front.png" media-type="image/png"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest></package>');
  zip.file('OPS/images/front.png', PNG);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('extracts the OPF-declared EPUB cover instead of guessing from the filename', async () => {
  const cover = await epubCover(await coveredEpub());
  assert.equal(cover.mime, 'image/png');
  assert.deepEqual(cover.bytes, PNG);
});

test('extracts language and identity metadata from an EPUB package', async () => {
  assert.deepEqual(await epubMetadata(await coveredEpub()), {
    title: 'A & B',
    authors: 'Fixture Author',
    language: 'pt-PT',
    isbn: '978-0-00-000000-0',
  });
});

test('extracts an FB2 coverpage binary', () => {
  const xml = Buffer.from(`<FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><coverpage><image l:href="#front-art"/></coverpage></title-info></description><binary id="front-art" content-type="image/png">${PNG.toString('base64')}</binary></FictionBook>`);
  const cover = fb2Cover(xml);
  assert.equal(cover.mime, 'image/png');
  assert.deepEqual(cover.bytes, PNG);
});

test('extracts FB2 language metadata', () => {
  const xml = Buffer.from('<FictionBook><description><title-info><book-title>Fixture FB2</book-title><author><first-name>Ada</first-name><last-name>Lovelace</last-name></author><lang>en</lang></title-info><publish-info><isbn>9780000000000</isbn></publish-info></description></FictionBook>');
  assert.deepEqual(fb2Metadata(xml), {
    title: 'Fixture FB2', authors: 'Ada Lovelace', language: 'en', isbn: '9780000000000',
  });
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
  const metadata = await localBookMetadata({ bookId, bookPath });
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.path, path.join(cacheDir, `${bookId}.png`));
  assert.equal(metadata.language, 'pt-PT');
  assert.equal(safeCoverID('../unsafe'), '');
  assert.equal(detectImage(Buffer.from('not an image')), null);
});
