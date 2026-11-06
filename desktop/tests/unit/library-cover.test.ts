const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs: typeof import('node:fs') = require('node:fs');
const os: typeof import('node:os') = require('node:os');
const path: typeof import('node:path') = require('node:path');
interface ZipFixture {
  file(name: string, contents: string | Buffer): void;
  generateAsync(options: { type: 'nodebuffer' }): Promise<Buffer>;
}
const JSZip: new () => ZipFixture = require('../../../web/jszip.min.js');

const {
  detectImage,
  epubCover,
  epubMetadata,
  localBookCover,
  localBookFormat,
  localBookMetadata,
  safeCoverID,
} = require('../../library-cover') as typeof import('../../src/library-cover');

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
  assert.ok(cover);
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

test('detects EPUB and comic archive bytes independently of a misleading filename extension', async () => {
  assert.equal(await localBookFormat(await coveredEpub(), '.cbz'), 'epub');
  const comic = new JSZip();
  comic.file('001.png', PNG);
  assert.equal(await localBookFormat(await comic.generateAsync({ type: 'nodebuffer' }), '.epub'), 'cbz');
  assert.equal(await localBookFormat(Buffer.concat([Buffer.from('Rar!'), Buffer.alloc(32)]), '.epub'), 'cbr');
});

test('detects local image signatures and rejects unrecognized document bytes', async () => {
  const gif = Buffer.alloc(32);
  gif.write('GIF89a', 0, 'ascii');
  const webp = Buffer.alloc(32);
  webp.write('RIFF', 0, 'ascii');
  webp.write('WEBP', 8, 'ascii');
  assert.equal(detectImage(gif)?.mime, 'image/gif');
  assert.equal(detectImage(webp)?.mime, 'image/webp');
  assert.equal(await localBookFormat(Buffer.from('<document/>'), '.bin'), '');
});

test('returns no EPUB cover when the package has no usable image', async () => {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file('book.opf', '<package><metadata><dc:title xmlns:dc="dc">Coverless</dc:title></metadata><manifest/></package>');
  assert.equal(await epubCover(await zip.generateAsync({ type: 'nodebuffer' })), null);
});

test('finds an EPUB package document when container.xml is absent', async () => {
  const zip = new JSZip();
  zip.file('OPS/fallback.opf', '<package><metadata><dc:title xmlns:dc="dc">Fallback OPF</dc:title><dc:language xmlns:dc="dc">en</dc:language></metadata><manifest/></package>');
  assert.deepEqual(await epubMetadata(await zip.generateAsync({ type: 'nodebuffer' })), {
    title: 'Fallback OPF', authors: '', language: 'en', isbn: '',
  });
});

test('EPUB metadata decodes valid entities and discards invalid numeric entities', async () => {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file('book.opf', '<package><metadata><dc:title xmlns:dc="dc">A &#65; &#x42; &#0; &#x110000;</dc:title><dc:creator xmlns:dc="dc">Ada &amp; Lovelace</dc:creator></metadata><manifest/></package>');
  assert.deepEqual(await epubMetadata(await zip.generateAsync({ type: 'nodebuffer' })), {
    title: 'A A B', authors: 'Ada & Lovelace', language: '', isbn: '',
  });
});

test('local metadata recognizes PDF bytes and ignores unsupported document types', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-local-metadata-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bookPath = path.join(root, 'book.bin');
  fs.writeFileSync(bookPath, '%PDF-1.4\n');
  assert.deepEqual(await localBookMetadata({ bookId: 'b'.repeat(32), bookPath }), { extension: 'pdf' });
  fs.writeFileSync(bookPath, '<document/>');
  assert.equal(await localBookMetadata({ bookId: 'b'.repeat(32), bookPath }), null);
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
  assert.ok(metadata);
  assert.ok(first);
  assert.ok(second);
  assert.equal(metadata.extension, 'epub');
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.path, path.join(cacheDir, `${bookId}.png`));
  assert.equal(metadata.language, 'pt-PT');
  assert.equal(safeCoverID('../unsafe'), '');
  assert.equal(detectImage(Buffer.from('not an image')), null);
});
