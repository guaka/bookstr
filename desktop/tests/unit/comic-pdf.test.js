'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const Module = require('node:module');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { ComicPdfConverter, comicPages } = require('../../comic-pdf');

const node = process.execPath;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pJcAAAAASUVORK5CYII=', 'base64');

class FakePdfDocument extends PassThrough {
  openImage(bytes) {
    if (bytes.toString() === 'large-image') return { width: 5000, height: 2000 };
    if (bytes.toString() === 'oversized-image') return { width: 6000, height: 6000 };
    if (!bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) throw new Error('Invalid image');
    return { width: 1, height: 1 };
  }
  addPage() {}
  image() {}
  end() {
    this.write('%PDF-1.4 fixture');
    super.end();
  }
}

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'pdfkit') return FakePdfDocument;
  if (request === '7zip-bin-full') return { path7z: '/fixture/app.asar/bin/7za' };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });

function listing(entries) {
  return entries.map(entry => Object.entries(entry).map(([key, value]) => `${key} = ${value}`).join('\n')).join('\n\n');
}

async function conversionFixture(t, { archiveListing, pages = {}, failList = false } = {}) {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.comic-pdf-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'comic.cbz');
  await fs.writeFile(source, 'fixture archive');
  const tool = path.join(root, 'archive-tool.js');
  await fs.writeFile(tool, `#!${node}\n` + [
    "const args = process.argv.slice(2);",
    "if (args[0] === 'l') {",
    `  if (${failList}) process.exit(7);`,
    `  process.stdout.write(${JSON.stringify(archiveListing ?? listing([{ Path: 'page1.png', Size: String(png.length), Folder: '-' }]))});`,
    "} else {",
    `  const files = ${JSON.stringify(Object.fromEntries(Object.entries(Object.keys(pages).length ? pages : { 'page1.png': png }).map(([name, value]) => [name, Buffer.from(value).toString('base64')])))};`,
    "  process.stdout.write(Buffer.from(files[args.at(-1)] ?? '', 'base64'));",
    "}",
  ].join('\n'));
  await fs.chmod(tool, 0o755);
  return { root, source, converter: new ComicPdfConverter({ cacheRoot: path.join(root, 'cache'), archiveTool: tool }) };
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

test('comic page listing rejects malformed, protected, and empty page sets', () => {
  for (const name of ['/absolute.jpg', 'C:/absolute.jpg', 'a//page.jpg', '.hidden/page.jpg']) {
    assert.throws(() => comicPages(listing([{ Path: name, Size: '100', Folder: '-' }])), /unsafe path|no JPEG/);
  }
  assert.throws(() => comicPages(listing([
    { Path: 'folder/', Folder: '+' },
    { Path: 'notes.txt', Size: '10', Folder: '-' },
    { Size: '10', Folder: '-' },
  ])), /no JPEG/);
  assert.throws(() => comicPages(listing([{ Path: 'locked.jpg', Size: '10', Encrypted: '+', Folder: '-' }])), /Password-protected/);
  assert.throws(() => comicPages(listing([{ Path: 'page.jpg', Size: '0', Folder: '-' }])), /too large or invalid/);
});

test('conversion writes and verifies a PDF, then reuses the verified cache entry', async t => {
  const { root, source, converter } = await conversionFixture(t);
  const digest = 'A'.repeat(64);
  const result = await converter.convert(source, digest);
  assert.equal(result.path, path.join(root, 'cache', `${digest.toLowerCase()}.pdf`));
  assert.ok(result.size > 0);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await fs.readFile(result.path)).subarray(0, 4).toString(), '%PDF');
  assert.deepEqual(await fs.readdir(path.join(root, 'cache')), [`${digest.toLowerCase()}.pdf`]);
  assert.deepEqual(await converter.convert(source, digest), result);
});

test('default archive tool resolves its unpacked Electron path', () => {
  const converter = new ComicPdfConverter({ cacheRoot: '/fixture/cache' });
  assert.equal(converter.archiveTool, '/fixture/app.asar.unpacked/bin/7za');
  assert.throws(() => new ComicPdfConverter(), /cacheRoot is required/);
});

test('conversion rejects invalid requests, missing archives, and archive listing errors', async t => {
  const { source, converter } = await conversionFixture(t, { failList: true });
  await assert.rejects(converter.convert(source, 'not-a-digest'), /sourceSha256 is invalid/);
  await assert.rejects(converter.convert(path.join(path.dirname(source), 'missing.cbz'), 'b'.repeat(64)), /ENOENT/);
  await assert.rejects(converter.convert(source, 'c'.repeat(64)), /Command failed/);
  assert.deepEqual(await fs.readdir(converter.cacheRoot), []);
});

test('conversion replaces an empty cache file and shares concurrent work', async t => {
  const { root, source, converter } = await conversionFixture(t);
  const digest = '9'.repeat(64);
  await fs.mkdir(converter.cacheRoot, { recursive: true });
  await fs.writeFile(path.join(converter.cacheRoot, `${digest}.pdf`), '');
  const [first, second] = await Promise.all([
    converter.convert(source, digest),
    converter.convert(source, digest),
  ]);
  assert.deepEqual(first, second);
  assert.ok(first.size > 0);
  assert.equal((await fs.readdir(converter.cacheRoot)).length, 1);

  const directoryDigest = '8'.repeat(64);
  await fs.mkdir(path.join(converter.cacheRoot, `${directoryDigest}.pdf`));
  await assert.rejects(converter.convert(source, directoryDigest));
});

test('temporary cleanup errors do not mask a successfully verified PDF', async t => {
  const { source, converter } = await conversionFixture(t);
  const remove = fs.rm;
  const digest = '7'.repeat(64);
  let cleanupFailureObserved = false;
  fs.rm = async (target, options) => {
    if (String(target).startsWith(path.join(converter.cacheRoot, `.${digest}-`))) {
      cleanupFailureObserved = true;
      throw new Error('simulated cleanup failure');
    }
    return remove(target, options);
  };
  let result;
  try {
    result = await converter.convert(source, digest);
  } finally {
    fs.rm = remove;
  }
  assert.ok(result.size > 0);
  assert.equal(cleanupFailureObserved, true);
  assert.deepEqual(await fs.readdir(converter.cacheRoot), [`${digest}.pdf`]);
});

test('conversion removes temporary PDFs after extraction or image decoding fails', async t => {
  const changedSize = listing([{ Path: 'page1.png', Size: String(png.length + 1), Folder: '-' }]);
  const first = await conversionFixture(t, { archiveListing: changedSize, pages: { 'page1.png': png } });
  await assert.rejects(first.converter.convert(first.source, 'd'.repeat(64)), /size changed during extraction/);
  assert.deepEqual(await fs.readdir(first.converter.cacheRoot), []);

  const badImage = await conversionFixture(t, {
    archiveListing: listing([{ Path: 'page1.png', Size: '4', Folder: '-' }]),
    pages: { 'page1.png': Buffer.from('nope') },
  });
  await assert.rejects(badImage.converter.convert(badImage.source, 'e'.repeat(64)));
  assert.deepEqual(await fs.readdir(badImage.converter.cacheRoot), []);

  const oversized = await conversionFixture(t, {
    archiveListing: listing([{ Path: 'page1.png', Size: String(Buffer.byteLength('oversized-image')), Folder: '-' }]),
    pages: { 'page1.png': Buffer.from('oversized-image') },
  });
  await assert.rejects(oversized.converter.convert(oversized.source, 'f'.repeat(64)), /dimensions exceed conversion limits/);
  assert.deepEqual(await fs.readdir(oversized.converter.cacheRoot), []);
});

test('conversion expands one nested ZIP page and converts a legacy GIF page', async t => {
  const { GifWriter } = require('omggif');
  const gifBuffer = Buffer.alloc(256);
  const writer = new GifWriter(gifBuffer, 1, 1, { palette: [0xff0000, 0x000000] });
  writer.addFrame(0, 0, 1, 1, [0]);
  const gif = gifBuffer.subarray(0, writer.end());

  const root = await fs.mkdtemp(path.join(process.cwd(), '.comic-pdf-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const nestedZip = path.join(root, 'nested-page.zip');
  const { spawnSync } = require('node:child_process');
  await fs.writeFile(path.join(root, 'nested.png'), png);
  const zipped = spawnSync('zip', ['-q', '-j', nestedZip, path.join(root, 'nested.png')], { encoding: 'utf8' });
  assert.equal(zipped.status, 0, zipped.stderr);
  const zipBytes = await fs.readFile(nestedZip);

  const source = path.join(root, 'comic.cbz');
  await fs.writeFile(source, 'fixture archive');
  const tool = path.join(root, 'archive-tool.js');
  const outerListing = listing([
    { Path: 'bundle.jpg', Size: String(zipBytes.length), Folder: '-' },
    { Path: 'frame.gif', Size: String(gif.length), Folder: '-' },
  ]);
  const nestedListing = listing([{ Path: 'nested.png', Size: String(png.length), Folder: '-' }]);
  await fs.writeFile(tool, `#!${node}\n` + [
    "const args = process.argv.slice(2);",
    "const archive = args[args.indexOf('--') + 1];",
    "if (args[0] === 'l') {",
    "  process.stdout.write(archive.endsWith('pages.zip')",
    `    ? ${JSON.stringify(nestedListing)}`,
    `    : ${JSON.stringify(outerListing)});`,
    "} else {",
    `  const files = ${JSON.stringify({
      'bundle.jpg': zipBytes.toString('base64'),
      'frame.gif': gif.toString('base64'),
      'nested.png': png.toString('base64'),
    })};`,
    "  process.stdout.write(Buffer.from(files[args.at(-1)] ?? '', 'base64'));",
    "}",
  ].join('\n'));
  await fs.chmod(tool, 0o755);
  const converter = new ComicPdfConverter({ cacheRoot: path.join(root, 'cache'), archiveTool: tool });
  const result = await converter.convert(source, '1'.repeat(64));
  assert.ok(result.size > 0);
  assert.equal((await fs.readFile(result.path)).subarray(0, 4).toString(), '%PDF');
});
