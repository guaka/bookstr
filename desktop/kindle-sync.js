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
  constructor({ store, resolveFile, transports = [new MountedKindles()], comicConverter = null,
    onProgress = () => {}, now = Date.now, presenceTtlMs = 60_000 } = {}) {
    if (!store || !resolveFile) throw new TypeError('store and resolveFile are required');
    this.store = store;
    this.resolveFile = resolveFile;
    this.transports = transports;
    this.comicConverter = comicConverter;
    this.onProgress = onProgress;
    this.now = now;
    this.presenceTtlMs = presenceTtlMs;
    this.presenceByDevice = new Map();
    this.syncing = false;
    this.operationChain = Promise.resolve();
    this.closed = false;
  }

  async devices() {
    const groups = await Promise.all(this.transports.map(transport => transport.devices()));
    const devices = groups.flat().map(({ id, name, kind }) => ({ id, name, kind }));
    const connected = new Set(devices.map(device => device.id));
    for (const deviceId of this.presenceByDevice.keys()) {
      if (!connected.has(deviceId)) this.presenceByDevice.delete(deviceId);
    }
    return devices;
  }

  async findDevice(id) {
    for (const transport of this.transports) {
      const device = (await transport.devices()).find(item => item.id === id);
      if (device) return { transport, device };
    }
    this.presenceByDevice.delete(id);
    throw new Error('Kindle is disconnected.');
  }

  rememberPresence(deviceId, bookIds, replace = false, scanned = false) {
    const current = this.presenceByDevice.get(deviceId);
    const ids = replace || !current || current.expiresAt <= this.now()
      ? new Set() : new Set(current.bookIds);
    for (const bookId of bookIds) ids.add(bookId);
    this.presenceByDevice.set(deviceId, {
      bookIds: ids,
      expiresAt: this.now() + this.presenceTtlMs,
      scanned: scanned || (!replace && current?.scanned === true),
    });
  }

  async presenceBooks() {
    const books = [];
    for (const job of this.store.downloads()) {
      if (!['ready', 'seeding'].includes(job.status)) continue;
      const declaredExtension = String(job.extension || '').toLowerCase();
      const titleExtension = path.extname(String(job.title || '')).slice(1).toLowerCase();
      const extension = declaredExtension === 'epub' && ['cbz', 'cbr'].includes(titleExtension)
        ? titleExtension : declaredExtension;
      if (FORMATS.has(extension)) {
        const file = this.store.libraryFile?.(job.bookId);
        const sha256 = String(job.sha256 || file?.sha256 || '').toLowerCase();
        const size = Number(file?.sizeBytes || job.totalBytes || job.bytes);
        if (/^[a-f0-9]{64}$/.test(sha256) && Number.isSafeInteger(size) && size > 0) {
          books.push({ bookId: job.bookId, title: job.title, authors: job.authors, extension, sha256, size });
        }
        continue;
      }
      if (!['cbz', 'cbr'].includes(extension) || !this.comicConverter?.cached) continue;
      const sourceSha256 = String(job.sha256 || '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sourceSha256)) continue;
      const cachedPdf = await this.comicConverter.cached(sourceSha256);
      if (cachedPdf && Number.isSafeInteger(cachedPdf.size) && cachedPdf.size > 0
        && /^[a-f0-9]{64}$/i.test(cachedPdf.sha256)) {
        books.push({ bookId: job.bookId, title: job.title, authors: job.authors, extension: 'pdf',
          sha256: cachedPdf.sha256.toLowerCase(), size: cachedPdf.size });
      }
    }
    return books;
  }

  async presence(id) {
    return this.serialize(async () => {
      const cached = this.presenceByDevice.get(id);
      if (cached && cached.expiresAt > this.now() && cached.scanned) {
        return { deviceId: id, bookIds: [...cached.bookIds] };
      }
      const { transport, device } = await this.findDevice(id);
      const books = await this.presenceBooks();
      const expected = new Map();
      for (const book of books) {
        const name = `${book.sha256.slice(0, 16)}.${book.extension}`.toLowerCase();
        const key = `${book.size}:${name}`;
        const ids = expected.get(key) || [];
        ids.push(book.bookId);
        expected.set(key, ids);
      }
      const sizes = new Set(books.map(book => book.size));
      const inspect = async () => {
        const files = await transport.files(device, sizes);
        const present = new Set();
        for (const file of files) {
          if (!sizes.has(Number(file.size))) continue;
          const suffix = / - ([a-f0-9]{16})\.(pdf|txt)$/i.exec(String(file.name));
          if (!suffix) continue;
          const key = `${Number(file.size)}:${suffix[1].toLowerCase()}.${suffix[2].toLowerCase()}`;
          for (const bookId of expected.get(key) || []) present.add(bookId);
        }
        return present;
      };
      const present = await (transport.withSession ? transport.withSession(device, inspect) : inspect());
      this.rememberPresence(id, present, false, true);
      return { deviceId: id, bookIds: [...this.presenceByDevice.get(id).bookIds] };
    });
  }

  async localBooks(bookId) {
    const books = [];
    const skipped = [];
    const jobs = this.store.downloads();
    const selection = bookId === undefined ? null : new Set(Array.isArray(bookId) ? bookId : [bookId]);
    if (selection && (!selection.size || selection.size > 2000
      || [...selection].some(id => typeof id !== 'string' || !id || id.length > 256 || /[\u0000-\u001f]/.test(id)))) {
      throw new Error('Invalid Kindle book selection.');
    }
    if (selection && [...selection].some(id => !jobs.some(job => job.bookId === id))) throw new Error('Downloaded book was not found.');
    for (const job of jobs) {
      if (selection && !selection.has(job.bookId)) continue;
      if (bookId !== undefined && !['ready', 'seeding'].includes(job.status)) throw new Error('Book is not downloaded.');
      if (!['ready', 'seeding'].includes(job.status)) continue;
      // Some catalog records call a .cbz/.cbr title EPUB; the converter checks
      // the archive for an EPUB package before treating that title as a comic.
      const declaredExtension = String(job.extension || '').toLowerCase();
      const titleExtension = path.extname(String(job.title || '')).slice(1).toLowerCase();
      const extension = declaredExtension === 'epub' && ['cbz', 'cbr'].includes(titleExtension)
        ? titleExtension : declaredExtension;
      if (!FORMATS.has(extension) && !['cbz', 'cbr'].includes(extension)) {
        skipped.push({ title: job.title || job.bookId, reason: `${extension || 'unknown'} is not supported for USB transfer` });
        continue;
      }
      try {
        const { filePath } = await this.resolveFile(job.bookId);
        const digest = await hashFile(filePath);
        if (job.sha256 && job.sha256.toLowerCase() !== digest.sha256) throw new Error('Local checksum mismatch');
        if (extension === 'cbz' || extension === 'cbr') {
          if (!this.comicConverter) throw new Error('Comic PDF conversion is unavailable.');
          this.onProgress({ phase: 'converting', bookId: job.bookId, title: job.title });
          const pdf = await this.comicConverter.convert(filePath, digest.sha256,
            progress => this.onProgress({ ...progress, phase: 'converting', bookId: job.bookId, title: job.title }));
          books.push({ ...job, extension: 'pdf', path: pdf.path, sha256: pdf.sha256, size: pdf.size });
        } else {
          books.push({ ...job, extension, path: filePath, sha256: digest.sha256, size: digest.size });
        }
      } catch (error) {
        skipped.push({ title: job.title || job.bookId, reason: error.message || String(error) });
      }
    }
    if (selection?.size === 1 && skipped.length) throw new Error(skipped[0].reason);
    return { books, skipped };
  }

  async preview(id, bookId) {
    return this.serialize(() => this.previewOperation(id, bookId));
  }

  serialize(operation) {
    const run = this.operationChain.then(() => {
      if (this.closed) throw new Error('Kindle sync is closed.');
      return operation();
    });
    this.operationChain = run.catch(() => {});
    return run;
  }

  async previewOperation(id, bookId, knownDevice = null, sessionHeld = false) {
    const { transport, device } = knownDevice || await this.findDevice(id);
    const { books, skipped } = await this.localBooks(bookId);
    const sizes = new Set(books.map(book => book.size));
    const inspect = async () => {
      this.onProgress({ deviceId: id, phase: 'checking' });
      const existing = await transport.files(device, sizes);
      const remoteHashes = new Set();
      for (const file of existing) remoteHashes.add(await transport.hash(file, device));
      this.rememberPresence(id, books.filter(book => remoteHashes.has(book.sha256)).map(book => book.bookId));
      const missing = [];
      for (const book of books) {
        if (remoteHashes.has(book.sha256)) continue;
        missing.push(book);
        remoteHashes.add(book.sha256);
      }
      return { device: { id: device.id, name: device.name, kind: device.kind },
        missing: missing.map(book => ({ bookId: book.bookId, title: book.title || book.bookId, size: book.size })),
        alreadyPresent: books.length - missing.length, skipped };
    };
    return !sessionHeld && transport.withSession ? transport.withSession(device, inspect) : inspect();
  }

  async transfer(id, bookId) {
    return this.serialize(async () => {
      this.syncing = true;
      try {
      const { transport, device } = await this.findDevice(id);
      const copyMissing = async () => {
        const plan = await this.previewOperation(id, bookId, { transport, device }, Boolean(transport.withSession));
        const { books } = await this.localBooks(bookId);
        const missingIds = new Set(plan.missing.map(book => book.bookId));
        transport.ensureSpace?.(books.filter(book => missingIds.has(book.bookId)).reduce((total, book) => total + book.size, 0));
        const transferred = [];
        const errors = [];
        for (const book of books) {
          if (!missingIds.has(book.bookId)) continue;
          this.onProgress({ deviceId: id, phase: 'copying', bookId: book.bookId, title: book.title, completed: transferred.length, total: missingIds.size });
          try {
            await transport.copy(device, book, safeFilename(book, book.sha256));
            transferred.push(book.bookId);
            this.rememberPresence(id, [book.bookId]);
          } catch (error) {
            errors.push({ bookId: book.bookId, title: book.title, error: error.message || String(error) });
          }
        }
        this.onProgress({ deviceId: id, completed: transferred.length, total: missingIds.size, done: true });
        return { transferred, alreadyPresent: plan.alreadyPresent, skipped: plan.skipped, errors };
      };
      return await (transport.withSession ? transport.withSession(device, copyMissing) : copyMissing());
      } finally { this.syncing = false; }
    });
  }

  async close() {
    this.closed = true;
    await Promise.allSettled(this.transports.map(transport => transport.close?.()));
    let timer;
    try {
      await Promise.race([this.operationChain, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
    } finally { clearTimeout(timer); }
  }
}

module.exports = { KindleSync, MountedKindles, safeFilename, defaultRoots };
