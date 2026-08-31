'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('../web/jszip.min.js');

const MAX_BOOK_BYTES = 128 * 1024 * 1024;
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

function safeCoverID(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{32}(?:[a-f0-9]{32})?$/.test(id) ? id : '';
}

function detectImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > MAX_COVER_BYTES) return null;
  let mime = '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = 'image/jpeg';
  else if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mime = 'image/png';
  else if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') mime = 'image/gif';
  else if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') mime = 'image/webp';
  return mime ? { bytes, mime, extension: IMAGE_TYPES.get(mime) } : null;
}

function xmlAttribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '';
}

function epubCandidateNames(zip, opfPath, opf) {
  const directory = path.posix.dirname(opfPath);
  const items = [...opf.matchAll(/<item\b[^>]*>/gi)].map(match => ({
    id: xmlAttribute(match[0], 'id'),
    href: xmlAttribute(match[0], 'href'),
    mediaType: xmlAttribute(match[0], 'media-type').toLowerCase(),
    properties: xmlAttribute(match[0], 'properties').toLowerCase().split(/\s+/),
  }));
  const metadataCoverID = opf.match(/<meta\b[^>]*\bname\s*=\s*["']cover["'][^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1]
    || opf.match(/<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bname\s*=\s*["']cover["'][^>]*>/i)?.[1]
    || '';
  const guideHref = opf.match(/<reference\b[^>]*\btype\s*=\s*["']cover["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1] || '';
  const preferred = items.filter(item => item.properties.includes('cover-image') || item.id === metadataCoverID);
  const likely = items.filter(item => IMAGE_TYPES.has(item.mediaType) && /cover|front/i.test(`${item.id} ${item.href}`));
  const hrefs = [...preferred, ...likely].map(item => item.href);
  if (guideHref && /\.(?:jpe?g|png|webp|gif)(?:$|[?#])/i.test(guideHref)) hrefs.push(guideHref);
  const resolved = hrefs.map(href => path.posix.normalize(path.posix.join(directory, decodeURIComponent(href.split(/[?#]/, 1)[0]))));
  const filenameFallbacks = Object.keys(zip.files).filter(name => /(?:^|\/)(?:cover|front)[^/]*\.(?:jpe?g|png|webp|gif)$/i.test(name));
  return [...new Set([...resolved, ...filenameFallbacks])];
}

async function epubPackage(bytes) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const containerEntry = zip.file('META-INF/container.xml');
  const container = containerEntry ? await containerEntry.async('string') : '';
  const opfPath = container.match(/\bfull-path\s*=\s*["']([^"']+\.opf)["']/i)?.[1]
    || Object.keys(zip.files).find(name => /\.opf$/i.test(name))
    || '';
  const opfEntry = opfPath ? zip.file(opfPath) : null;
  const opf = opfEntry ? await opfEntry.async('string') : '';
  return { zip, opfPath, opf };
}

async function epubCover(bytes) {
  const { zip, opfPath, opf } = await epubPackage(bytes);
  for (const name of epubCandidateNames(zip, opfPath, opf)) {
    const entry = zip.file(name);
    if (!entry || entry.dir || Number(entry._data?.uncompressedSize || 0) > MAX_COVER_BYTES) continue;
    const cover = detectImage(Buffer.from(await entry.async('uint8array')));
    if (cover) return cover;
  }
  return null;
}

function decodeXMLText(value) {
  const codePoint = (value, radix) => {
    const numeric = parseInt(value, radix);
    return Number.isInteger(numeric) && numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : '';
  };
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_match, code) => codePoint(code, 10))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => codePoint(code, 16))
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}

function xmlElement(xml, name) {
  return decodeXMLText(xml.match(new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`, 'i'))?.[1] || '');
}

async function epubMetadata(bytes) {
  const { opf } = await epubPackage(bytes);
  if (!opf) return null;
  return {
    title: xmlElement(opf, 'title'),
    authors: xmlElement(opf, 'creator'),
    language: xmlElement(opf, 'language'),
    isbn: [...opf.matchAll(/<(?:[\w.-]+:)?identifier\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?identifier>/gi)]
      .map(match => decodeXMLText(match[1]).replace(/^urn:isbn:/i, ''))
      .find(value => /(?:\d[\s-]*){9}[\dX]/i.test(value)) || '',
  };
}

function fb2Metadata(bytes) {
  const xml = bytes.toString('utf8');
  const titleInfo = xml.match(/<title-info\b[^>]*>([\s\S]*?)<\/title-info>/i)?.[1] || xml;
  const firstName = xmlElement(titleInfo, 'first-name');
  const middleName = xmlElement(titleInfo, 'middle-name');
  const lastName = xmlElement(titleInfo, 'last-name');
  return {
    title: xmlElement(titleInfo, 'book-title'),
    authors: [firstName, middleName, lastName].filter(Boolean).join(' '),
    language: xmlElement(titleInfo, 'lang'),
    isbn: xmlElement(xml, 'isbn'),
  };
}

function fb2Cover(bytes) {
  const xml = bytes.toString('utf8');
  const coverID = xml.match(/<coverpage\b[^>]*>[\s\S]*?<image\b[^>]*(?:l:href|xlink:href|href)\s*=\s*["']#([^"']+)["']/i)?.[1] || '';
  const binaries = [...xml.matchAll(/<binary\b([^>]*)>([\s\S]*?)<\/binary>/gi)];
  const selected = binaries.find(match => xmlAttribute(match[1], 'id') === coverID)
    || binaries.find(match => /cover|front/i.test(xmlAttribute(match[1], 'id')));
  if (!selected) return null;
  const encoded = selected[2].replace(/\s+/g, '');
  if (!encoded || encoded.length > Math.ceil(MAX_COVER_BYTES * 4 / 3) + 8) return null;
  return detectImage(Buffer.from(encoded, 'base64'));
}

async function existingCover(cacheDir, id) {
  for (const extension of IMAGE_TYPES.values()) {
    try {
      const filePath = path.join(cacheDir, `${id}${extension}`);
      const bytes = await fs.readFile(filePath);
      const cover = detectImage(bytes);
      if (cover) return { ...cover, path: filePath, cached: true };
    } catch {
      // Keep checking the other supported image extensions.
    }
  }
  return null;
}

async function localBookCover({ bookId, bookPath, cacheDir }) {
  const id = safeCoverID(bookId);
  if (!id || !bookPath || !cacheDir) return null;
  const cached = await existingCover(cacheDir, id);
  if (cached) return cached;
  const stat = await fs.stat(bookPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BOOK_BYTES) return null;
  const extension = path.extname(bookPath).toLowerCase();
  const bytes = await fs.readFile(bookPath);
  const cover = extension === '.epub' ? await epubCover(bytes) : extension === '.fb2' ? fb2Cover(bytes) : null;
  if (!cover) return null;
  await fs.mkdir(cacheDir, { recursive: true });
  const outputPath = path.join(cacheDir, `${id}${cover.extension}`);
  await fs.writeFile(outputPath, cover.bytes, { mode: 0o600 });
  return { ...cover, path: outputPath, cached: false };
}

async function localBookMetadata({ bookId, bookPath }) {
  if (!safeCoverID(bookId) || !bookPath) return null;
  const stat = await fs.stat(bookPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BOOK_BYTES) return null;
  const extension = path.extname(bookPath).toLowerCase();
  if (!['.epub', '.fb2'].includes(extension)) return null;
  const bytes = await fs.readFile(bookPath);
  const metadata = extension === '.epub' ? await epubMetadata(bytes) : fb2Metadata(bytes);
  if (!metadata) return null;
  const useful = Object.fromEntries(Object.entries(metadata).filter(([, value]) => String(value || '').trim()));
  return Object.keys(useful).length ? useful : null;
}

module.exports = {
  detectImage,
  epubCover,
  epubMetadata,
  fb2Cover,
  fb2Metadata,
  localBookCover,
  localBookMetadata,
  safeCoverID,
};
