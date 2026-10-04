'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashFile } = require('./library-import');

const FORMATS = new Set(['pdf', 'txt']);
const MAX_WALK_DEPTH = 8;

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safeFilename(book, sha256) {
  const label = `${book.title || 'Book'} - ${book.authors || 'Unknown author'}`
    .normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Book';
  return `${label} - ${sha256.slice(0, 16)}.${book.extension}`;
}

function defaultRoots(platform = process.platform) {
  if (platform === 'darwin') return ['/Volumes'];
  if (platform === 'linux') return [`/media/${os.userInfo().username}`, `/run/media/${os.userInfo().username}`, '/media', '/mnt'];
  if (platform === 'win32') return Array.from({ length: 23 }, (_, index) => `${String.fromCharCode(68 + index)}:\\`);
  return [];
}

class MountedKindles {
  constructor({ roots = defaultRoots(), platform = process.platform, statfs = fsp.statfs } = {}) {
    this.roots = roots;
    this.platform = platform;
    this.statfs = statfs;
  }

  async devices() {
    const candidates = [];
    for (const base of this.roots) {
      if (this.platform === 'win32') {
        candidates.push(base);
      } else {
        const entries = await fsp.readdir(base, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) if (entry.isDirectory() && /^kindle(?:\b|[_ -])/i.test(entry.name)) candidates.push(path.join(base, entry.name));
      }
    }
    const devices = [];
    for (const root of candidates) {
      try {
        const realRoot = await fsp.realpath(root);
        const documents = await fsp.realpath(path.join(realRoot, 'documents'));
        if (!inside(realRoot, documents) || !(await fsp.stat(documents)).isDirectory()) continue;
        if (this.platform === 'win32' && !(await this.isWindowsKindleVolume(realRoot))) continue;
        const id = `mounted:${crypto.createHash('sha256').update(realRoot).digest('hex').slice(0, 24)}`;
        devices.push({ id, name: path.basename(realRoot) || 'Kindle', kind: 'mounted', root: realRoot, documents });
      } catch { /* disconnected, unreadable, or not a Kindle */ }
    }
    return devices;
  }

  async isWindowsKindleVolume(root) {
    // Windows MTP devices use the portable-device adapter; drive-letter devices
    // must have a Kindle volume label before they can be offered for writes.
    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    const drive = root.slice(0, 2);
    const script = `(Get-Volume -DriveLetter '${drive[0]}' -ErrorAction Stop).FileSystemLabel`;
    try {
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, windowsHide: true });
      return /^kindle(?:\b|[_ -])/i.test(stdout.trim());
    } catch { return false; }
  }

  async files(device, allowedSizes) {
    const results = [];
    const walk = async (directory, depth) => {
      if (depth > MAX_WALK_DEPTH) return;
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(child, depth + 1);
        else if (entry.isFile() && FORMATS.has(path.extname(entry.name).slice(1).toLowerCase())) {
          const stat = await fsp.stat(child);
          if (allowedSizes.has(stat.size)) results.push({ name: entry.name, size: stat.size, path: child });
        }
      }
    };
    await walk(device.documents, 0);
    return results;
  }

  async hash(file) { return (await hashFile(file.path)).sha256; }

  async copy(device, book, name) {
    const destination = path.join(device.documents, name);
    if (!inside(device.documents, destination)) throw new Error('Invalid Kindle destination.');
    const space = await this.statfs(device.documents).catch(() => null);
    if (space && Number(space.bavail) * Number(space.bsize) < book.size * 2) throw new Error('Kindle is out of space.');
    const temporary = path.join(device.documents, `.bookstr-${crypto.randomUUID()}.part`);
    try {
      await fsp.copyFile(book.path, temporary, fs.constants.COPYFILE_EXCL);
      if ((await hashFile(temporary)).sha256 !== book.sha256) throw new Error('Kindle copy verification failed.');
      await fsp.copyFile(temporary, destination, fs.constants.COPYFILE_EXCL);
      if ((await hashFile(destination)).sha256 !== book.sha256) throw new Error('Kindle copy verification failed.');
    } finally {
      await fsp.unlink(temporary).catch(() => {});
    }
  }
}

class KindleSync {
  constructor({ store, resolveFile, transports = [new MountedKindles()], onProgress = () => {} } = {}) {
    if (!store || !resolveFile) throw new TypeError('store and resolveFile are required');
    this.store = store;
    this.resolveFile = resolveFile;
    this.transports = transports;
    this.onProgress = onProgress;
    this.syncing = false;
  }

  async devices() {
    const groups = await Promise.all(this.transports.map(transport => transport.devices()));
    return groups.flat().map(({ id, name, kind }) => ({ id, name, kind }));
  }

  async findDevice(id) {
    for (const transport of this.transports) {
      const device = (await transport.devices()).find(item => item.id === id);
      if (device) return { transport, device };
    }
    throw new Error('Kindle is disconnected.');
  }

  async localBooks() {
    const books = [];
    const skipped = [];
    for (const job of this.store.downloads()) {
      if (!['ready', 'seeding'].includes(job.status)) continue;
      const extension = String(job.extension || '').toLowerCase();
      if (!FORMATS.has(extension)) {
        skipped.push({ title: job.title || job.bookId, reason: `${extension || 'unknown'} is not supported for USB transfer` });
        continue;
      }
      try {
        const { filePath } = await this.resolveFile(job.bookId);
        const digest = await hashFile(filePath);
        if (job.sha256 && job.sha256.toLowerCase() !== digest.sha256) throw new Error('Local checksum mismatch');
        books.push({ ...job, extension, path: filePath, sha256: digest.sha256, size: digest.size });
      } catch (error) {
        skipped.push({ title: job.title || job.bookId, reason: error.message || String(error) });
      }
    }
    return { books, skipped };
  }

  async preview(id) {
    const { transport, device } = await this.findDevice(id);
    const { books, skipped } = await this.localBooks();
    const sizes = new Set(books.map(book => book.size));
    const existing = await transport.files(device, sizes);
    const remoteHashes = new Set();
    for (const file of existing) remoteHashes.add(await transport.hash(file, device));
    const missing = [];
    for (const book of books) {
      if (remoteHashes.has(book.sha256)) continue;
      missing.push(book);
      remoteHashes.add(book.sha256);
    }
    return { device: { id: device.id, name: device.name, kind: device.kind },
      missing: missing.map(book => ({ bookId: book.bookId, title: book.title || book.bookId, size: book.size })),
      alreadyPresent: books.length - missing.length, skipped };
  }

  async transfer(id) {
    if (this.syncing) throw new Error('A Kindle transfer is already running.');
    this.syncing = true;
    try {
      const { transport, device } = await this.findDevice(id);
      const plan = await this.preview(id);
      const { books } = await this.localBooks();
      const missingIds = new Set(plan.missing.map(book => book.bookId));
      const transferred = [];
      const errors = [];
      for (const book of books) {
        if (!missingIds.has(book.bookId)) continue;
        this.onProgress({ deviceId: id, bookId: book.bookId, title: book.title, completed: transferred.length, total: missingIds.size });
        try {
          await transport.copy(device, book, safeFilename(book, book.sha256));
          transferred.push(book.bookId);
        } catch (error) {
          errors.push({ bookId: book.bookId, title: book.title, error: error.message || String(error) });
        }
      }
      this.onProgress({ deviceId: id, completed: transferred.length, total: missingIds.size, done: true });
      return { transferred, alreadyPresent: plan.alreadyPresent, skipped: plan.skipped, errors };
    } finally { this.syncing = false; }
  }
}

module.exports = { KindleSync, MountedKindles, safeFilename, defaultRoots };
