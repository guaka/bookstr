'use strict';

const fs = require('node:fs/promises');

const READER_FORMATS = new Set(['epub', 'pdf', 'fb2', 'cbz', 'cbr']);
const ZIP_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const MAX_ZIP_TAIL_BYTES = 22 + 0xffff;
const MAX_ZIP_CENTRAL_DIRECTORY_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_FORMAT_CACHE_ENTRIES = 256;
const MAX_PARALLEL_FORMAT_CHECKS = 4;
const formatCache = new Map();

async function sniffFileFormat(filePath, fileSystem = fs) {
  let file;
  try {
    file = await fileSystem.open(filePath, 'r');
    const stats = await file.stat();
    if (!stats.isFile() || stats.size < 4) return '';
    const readAt = async (position, requestedLength) => {
      const length = Math.min(requestedLength, Math.max(0, stats.size - position));
      if (length <= 0) return Buffer.alloc(0);
      const bytes = Buffer.alloc(length);
      const { bytesRead } = await file.read(bytes, 0, length, position);
      return bytes.subarray(0, bytesRead);
    };
    const prefix = await readAt(0, 4096);
    if (prefix.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
    if (prefix.subarray(0, 4).toString('ascii') === 'Rar!') return 'cbr';
    if (/<FictionBook\b/i.test(prefix.toString('utf8'))) return 'fb2';
    if (prefix.readUInt32LE(0) !== ZIP_SIGNATURE || stats.size < 22) return '';

    const tailLength = Math.min(stats.size, MAX_ZIP_TAIL_BYTES);
    const tailStart = stats.size - tailLength;
    const tail = await readAt(tailStart, tailLength);
    let eocd = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue;
      if (offset + 22 + tail.readUInt16LE(offset + 20) !== tail.length) continue;
      eocd = offset;
      break;
    }
    if (eocd < 0) return '';

    const diskNumber = tail.readUInt16LE(eocd + 4);
    const centralDirectoryDisk = tail.readUInt16LE(eocd + 6);
    const diskEntries = tail.readUInt16LE(eocd + 8);
    const entryCount = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || diskEntries !== entryCount
      || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
      || entryCount > MAX_ZIP_ENTRIES || centralSize > MAX_ZIP_CENTRAL_DIRECTORY_BYTES
      || centralOffset + centralSize > stats.size || centralSize < entryCount * 46) return '';

    const central = await readAt(centralOffset, centralSize);
    if (central.length !== centralSize) return '';
    let offset = 0;
    let hasContainer = false;
    let hasComicPage = false;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) return '';
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > central.length) return '';
      const name = central.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
      const normalizedName = name.toLowerCase();
      if (/(^|\/)meta-inf\/container\.xml$/.test(normalizedName)) hasContainer = true;
      if (/\.(?:jpe?g|png|gif|webp)$/i.test(name)) hasComicPage = true;
      offset = end;
    }
    if (offset !== central.length) return '';
    if (hasContainer) return 'epub';
    if (hasComicPage) return 'cbz';
    return '';
  } catch {
    return '';
  } finally {
    await file?.close().catch(() => {});
  }
}

async function detectedFormat(filePath) {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) return '';
  const signature = `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  const cached = formatCache.get(filePath);
  if (cached?.signature === signature) return cached.format;
  const format = await sniffFileFormat(filePath);
  if (formatCache.size >= MAX_FORMAT_CACHE_ENTRIES) formatCache.delete(formatCache.keys().next().value);
  formatCache.set(filePath, { signature, format });
  return format;
}

async function downloadsForRenderer(downloads, resolveRegisteredFile) {
  const rows = Array.isArray(downloads) ? downloads : [];
  const results = new Array(rows.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < rows.length) {
      const index = nextIndex;
      nextIndex += 1;
      const download = rows[index];
      let readable = false;
      let format = '';
      try {
        const resolved = await resolveRegisteredFile(download.bookId);
        format = await detectedFormat(resolved.filePath);
        readable = READER_FORMATS.has(format);
      } catch {
        // Missing, invalid, or out-of-library registrations are not local copies.
      }
      results[index] = { ...download, ...(readable ? { extension: format } : {}), readable };
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_FORMAT_CHECKS, rows.length) }, worker));
  return results;
}

module.exports = { downloadsForRenderer, detectedFormat, sniffFileFormat };
