'use strict';

const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs: typeof import('node:fs/promises') = require('node:fs/promises');
const path: typeof import('node:path') = require('node:path');
const test: typeof import('node:test') = require('node:test');
interface ZipFixture { file(name: string, contents: string | Buffer): void; generateAsync(options: { type: 'nodebuffer' }): Promise<Buffer> }
const JSZip = require('../../../web/jszip.min.js') as new () => ZipFixture;
const { downloadsForRenderer, detectedFormat, sniffFileFormat } = require('../../library-downloads') as typeof import('../../src/library-downloads');

async function fixtureFiles() {
  const root = await fs.mkdtemp(path.join(__dirname, '.library-downloads-'));
  const files = new Map<string, string>();
  const epub = new JSZip();
  epub.file('META-INF/container.xml', '<container/>');
  const cbz = new JSZip();
  cbz.file('001.png', Buffer.from([1]));
  const entries: Array<[string, Buffer]> = [
    ['epub', await epub.generateAsync({ type: 'nodebuffer' })],
    ['cbz', await cbz.generateAsync({ type: 'nodebuffer' })],
    ['cbr', Buffer.concat([Buffer.from('Rar!'), Buffer.alloc(16)])],
    ['fb2', Buffer.from('<FictionBook><body/></FictionBook>')],
    ['pdf', Buffer.from('%PDF-1.4\n')],
    ['txt', Buffer.from('plain text')],
    ['legacy-epub', await cbz.generateAsync({ type: 'nodebuffer' })],
  ];
  await Promise.all(entries.map(async ([format, bytes]) => {
    const filePath = path.join(root, `book.${format}`);
    await fs.writeFile(filePath, bytes);
    files.set(format, filePath);
  }));
  for (const format of ['epub', 'cbz', 'cbr', 'fb2', 'pdf', 'txt']) {
    assert.equal(await detectedFormat(files.get(format)!), format === 'txt' ? '' : format);
  }
  assert.equal(await detectedFormat(files.get('legacy-epub')!), 'cbz');
  return { root, files };
}

test('renderer downloads expose actual registered reader formats as readable', async t => {
  const { root, files } = await fixtureFiles();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const formats = ['epub', 'pdf', 'fb2', 'cbz', 'cbr', 'txt'];
  const rows = [...formats, 'missing'].map(bookId => ({ bookId, status: 'ready' }));
  const results = await downloadsForRenderer(rows, async (bookId: string) => {
    const filePath = files.get(bookId);
    if (!filePath) throw new Error('missing');
    return { filePath, book: { extension: bookId } };
  });
  assert.deepEqual(results.map(item => item.readable), [true, true, true, true, true, false, false]);
  assert.equal(Object.hasOwn(results[0]!, 'filePath'), false);
});

test('reader readability follows detected bytes when catalog and path extensions are stale', async t => {
  const { root, files } = await fixtureFiles();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const [result] = await downloadsForRenderer([{ bookId: 'legacy' }], async () => ({
    filePath: files.get('legacy-epub')!, book: { extension: 'epub' },
  }));
  assert.equal(result!.readable, true);
  assert.equal(result!.extension, 'cbz');
});

test('format detection reads a bounded header from a large sparse file', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '.library-downloads-sparse-'));
  const filePath = path.join(root, 'large.pdf');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = await fs.open(filePath, 'w+');
  await file.write(Buffer.from('%PDF-'), 0, 5, 0);
  await file.truncate(70 * 1024 * 1024 * 1024);
  await file.close();
  const originalReadFile = fs.readFile;
  fs.readFile = async () => { throw new Error('format detection must not read the whole file'); };
  try {
    assert.equal(await detectedFormat(filePath), 'pdf');
  } finally {
    fs.readFile = originalReadFile;
  }
});

test('malformed ZIP content does not become readable through its filename extension', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '.library-downloads-malformed-'));
  const filePath = path.join(root, 'broken.epub');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(filePath, Buffer.from('PK\x03\x04broken archive'));
  assert.equal(await detectedFormat(filePath), '');
});

test('valid ZIP archives without reader markers remain unsupported', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '.library-downloads-unknown-'));
  const filePath = path.join(root, 'archive.zip');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const zip = new JSZip();
  zip.file('README.txt', 'not a book');
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(await detectedFormat(filePath), '');
});

test('format detection handles I/O failures and closes opened files', async () => {
  assert.equal(await sniffFileFormat('/missing', { open: async () => { throw new Error('open failed'); } } as unknown as typeof fs), '');
  let readFailureClosed = false;
  assert.equal(await sniffFileFormat('/read-error', { open: async () => ({
    stat: async () => ({ isFile: () => true, size: 8 }),
    read: async () => { throw new Error('read failed'); },
    close: async () => { readFailureClosed = true; },
  }) } as unknown as typeof fs), '');
  assert.equal(readFailureClosed, true);
  let closed = false;
  const pdfFile = {
    stat: async () => ({ isFile: () => true, size: 8 }),
    read: async (buffer: Buffer, _offset: number, _length: number, position: number) => {
      const bytes = Buffer.from(position === 0 ? '%PDF-1.4' : '');
      bytes.copy(buffer);
      return { bytesRead: bytes.length };
    },
    close: async () => { closed = true; throw new Error('close failed'); },
  };
  assert.equal(await sniffFileFormat('/pdf', { open: async () => pdfFile } as unknown as typeof fs), 'pdf');
  assert.equal(closed, true);
});

test('non-array download inputs and non-file registrations produce empty or unreadable rows', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '.library-downloads-dir-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await downloadsForRenderer(null, async () => { throw new Error('missing'); }), []);
  assert.deepEqual(await downloadsForRenderer(undefined, async () => { throw new Error('missing'); }), []);
  assert.equal(await detectedFormat(root), '');
  const [row] = await downloadsForRenderer([{ bookId: 'missing' }], async () => { throw new Error('not registered'); });
  assert.equal(row!.readable, false);
});

test('renderer format checks stay within the worker limit and preserve row order', async t => {
  const { root, files } = await fixtureFiles();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let active = 0;
  let peakActive = 0;
  const rows = Array.from({ length: 12 }, (_, index) => ({ bookId: `book-${index}` }));
  const results = await downloadsForRenderer(rows, async () => {
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    return { filePath: files.get('pdf')! };
  });
  assert.equal(peakActive, 4);
  assert.deepEqual(results.map(row => row.bookId), rows.map(row => row.bookId));
});

test('format cache remains bounded after many distinct files', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '.library-downloads-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePaths = Array.from({ length: 257 }, (_, index) => path.join(root, `book-${index}.pdf`));
  await Promise.all(filePaths.map(filePath => fs.writeFile(filePath, '%PDF-1.4')));
  for (const filePath of filePaths) assert.equal(await detectedFormat(filePath), 'pdf');
});
