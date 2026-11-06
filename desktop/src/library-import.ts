'use strict';

const fs = require('node:fs') as typeof import('node:fs');
const fsp = require('node:fs/promises') as typeof import('node:fs/promises');
const path = require('node:path') as typeof import('node:path');
const crypto = require('node:crypto') as typeof import('node:crypto');
const { Transform } = require('node:stream') as typeof import('node:stream');
const { pipeline } = require('node:stream/promises') as typeof import('node:stream/promises');

function safeExtension(value: unknown, fallback = '') {
  const extension = String(value || fallback).trim().toLowerCase().replace(/^\./, '');
  if (!/^[a-z0-9][a-z0-9+.-]{0,15}$/.test(extension)) throw new TypeError('extension must be a short safe file extension');
  return extension;
}

function safeRelativePath(value: unknown) {
  const relative = String(value || '').replaceAll('\\', '/');
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || /[\u0000-\u001f]/.test(relative)) throw new TypeError('relative path is invalid');
  return relative;
}

function inside(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function hashFile(filePath: string): Promise<{ sha256: string; size: number }> {
  const hash = crypto.createHash('sha256');
  let size = 0;
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: string | Buffer) => { hash.update(chunk); size += chunk.length; });
    stream.once('error', reject);
    stream.once('end', () => resolve({ sha256: hash.digest('hex'), size }));
  });
}

class LibraryImporter {
  declare readonly libraryRoot: string;
  declare readonly booksRoot: string;
  constructor({ libraryRoot }: { libraryRoot?: string } = {}) {
    if (!libraryRoot) throw new TypeError('libraryRoot is required');
    this.libraryRoot = path.resolve(libraryRoot);
    this.booksRoot = path.join(this.libraryRoot, 'books');
  }

  async importFile(sourcePath: unknown, { extension, expectedSha256 }: { extension?: unknown; expectedSha256?: unknown } = {}) {
    if (typeof sourcePath !== 'string' || !sourcePath.trim() || sourcePath.includes('\0')) throw new TypeError('sourcePath is invalid');
    const source = path.resolve(sourcePath);
    const stat = await fsp.stat(source);
    if (!stat.isFile()) throw new TypeError('sourcePath must be a regular file');
    const ext = safeExtension(extension, path.extname(source).slice(1) || 'bin');
    if (ext === 'fb2') throw new TypeError('unsupported import format');
    await fsp.mkdir(this.booksRoot, { recursive: true });
    const tempPath = path.join(this.booksRoot, `.import-${process.pid}-${crypto.randomBytes(8).toString('hex')}.part`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    try {
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          size += chunk.length;
          callback(null, chunk);
        },
      });
      await pipeline(fs.createReadStream(source), meter, fs.createWriteStream(tempPath, { flags: 'wx' }));
      const sha256 = hash.digest('hex');
      if (expectedSha256 && String(expectedSha256).toLowerCase() !== sha256) throw new Error('import checksum does not match expected SHA-256');
      const relativePath = `books/${sha256}.${ext}`;
      const destination = path.join(this.libraryRoot, relativePath);
      if (!inside(this.libraryRoot, destination)) throw new Error('import destination escaped library root');
      try {
        await fsp.access(destination, fs.constants.F_OK);
        await fsp.unlink(tempPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await fsp.rename(tempPath, destination);
      }
      return { sha256, size, extension: ext, relativePath };
    } catch (error) {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  resolveRelativePath(relativePath: unknown) {
    const relative = safeRelativePath(relativePath);
    const resolved = path.resolve(this.libraryRoot, relative);
    if (!inside(this.libraryRoot, resolved)) throw new TypeError('relative path escaped library root');
    return resolved;
  }
}

export = { LibraryImporter, hashFile, safeExtension };
