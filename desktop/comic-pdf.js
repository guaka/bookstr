'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { finished } = require('node:stream/promises');
const { hashFile } = require('./library-import');

const run = promisify(execFile);
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_PAGE_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_PAGES = 300;
const MAX_PIXELS = 30_000_000;
const imageName = /\.(?:jpe?g|png)$/i;
const otherImageName = /\.(?:gif|webp|avif|bmp|tiff?)$/i;

function archiveToolPath() {
  // Electron's executable dependencies live beside app.asar after packaging.
  const { path7z } = require('7zip-bin-full');
  return path7z.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
}

function pdfDocument(...args) {
  const PDFDocument = require('pdfkit');
  return new PDFDocument(...args);
}

function comicPages(listing) {
  const entries = String(listing).split(/\r?\n\s*\r?\n/);
  const pages = [];
  let totalBytes = 0;
  let epubPackage = false;
  for (const block of entries) {
    const values = Object.fromEntries(block.split(/\r?\n/).map(line => {
      const match = /^([^=]+) = (.*)$/.exec(line);
      return match ? [match[1].trim(), match[2]] : [];
    }).filter(pair => pair.length));
    if (!values.Path || values.Folder === '+') continue;
    const name = values.Path.replaceAll('\\', '/');
    if (name.startsWith('/') || /^[a-z]:\//i.test(name) || name.split('/').some(part => !part || part === '..')) {
      throw new Error('Comic archive contains an unsafe path.');
    }
    if (name.split('/').some(part => part === '__MACOSX' || part.startsWith('.'))) continue;
    if (/^META-INF\/container\.xml$/i.test(name)) epubPackage = true;
    if (values.Encrypted === '+') throw new Error('Password-protected comics cannot be converted.');
    if (otherImageName.test(name)) throw new Error(`Unsupported comic image format: ${path.extname(name).slice(1).toLowerCase()}`);
    if (!imageName.test(name)) continue;
    const size = Number(values.Size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PAGE_BYTES) throw new Error('Comic page is too large or invalid.');
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES || pages.length >= MAX_PAGES) throw new Error('Comic exceeds conversion limits.');
    pages.push({ name: values.Path, size });
  }
  if (epubPackage) throw new Error('This archive is an EPUB, not a comic.');
  if (!pages.length) throw new Error('Comic archive has no JPEG or PNG pages.');
  pages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return pages;
}

async function renderComic(source, destination, sourceSha256, archiveTool) {
  const { stdout } = await run(archiveTool, ['l', '-slt', '-ba', '--', source], {
    timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  const pages = comicPages(stdout);
  const output = fs.createWriteStream(destination, { flags: 'wx' });
  const document = pdfDocument({
    autoFirstPage: false, margin: 0,
    info: { Title: sourceSha256, CreationDate: new Date(0) },
  });
  document.pipe(output);
  const completion = finished(output);
  completion.catch(() => {});
  try {
    for (const page of pages) {
      // Extract only one page into memory; never unpack the complete comic.
      const { stdout: bytes } = await run(archiveTool, ['x', '-so', '-spd', '-mmt=1', '--', source, page.name], {
        timeout: 120_000, maxBuffer: MAX_PAGE_BYTES + 1024, encoding: 'buffer', windowsHide: true,
      });
      if (bytes.length !== page.size) throw new Error('Comic page size changed during extraction.');
      const image = document.openImage(bytes);
      if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) {
        throw new Error('Comic page dimensions exceed conversion limits.');
      }
      const scale = Math.min(1, 4000 / Math.max(image.width, image.height));
      const width = image.width * scale;
      const height = image.height * scale;
      document.addPage({ size: [width, height], margin: 0 });
      document.image(image, 0, 0, { width, height });
    }
    document.end();
    await completion;
  } catch (error) {
    document.destroy();
    output.destroy();
    await completion.catch(() => {});
    throw error;
  }
}

class ComicPdfConverter {
  constructor({ cacheRoot, archiveTool = archiveToolPath() } = {}) {
    if (!cacheRoot) throw new TypeError('cacheRoot is required');
    this.cacheRoot = cacheRoot;
    this.archiveTool = archiveTool;
    this.inFlight = new Map();
  }

  async convert(source, sourceSha256) {
    if (!/^[a-f0-9]{64}$/i.test(sourceSha256)) throw new TypeError('sourceSha256 is invalid');
    const key = sourceSha256.toLowerCase();
    if (!this.inFlight.has(key)) {
      const pending = this.convertOnce(source, key).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return this.inFlight.get(key);
  }

  async convertOnce(source, sourceSha256) {
    const target = path.join(this.cacheRoot, `${sourceSha256}.pdf`);
    const existing = await fsp.stat(target).catch(() => null);
    if (existing?.isFile() && existing.size > 0) {
      const digest = await hashFile(target);
      return { path: target, size: digest.size, sha256: digest.sha256 };
    }
    const stat = await fsp.stat(source);
    if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) throw new Error('Comic archive exceeds conversion limits.');
    await fsp.mkdir(this.cacheRoot, { recursive: true });
    const temporary = path.join(this.cacheRoot, `.${sourceSha256}-${process.pid}-${Date.now()}.pdf`);
    try {
      await renderComic(source, temporary, sourceSha256, this.archiveTool);
      await fsp.rename(temporary, target);
      const digest = await hashFile(target);
      return { path: target, size: digest.size, sha256: digest.sha256 };
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
  }
}

module.exports = { ComicPdfConverter, comicPages };
