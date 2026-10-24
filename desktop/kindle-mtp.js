'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { hashFile } = require('./library-import');
const { MtpSession } = require('./mtp-session');

const execFileAsync = promisify(execFile);

class MtpKindles {
  constructor({ platform = process.platform, resourcesPath = process.resourcesPath || __dirname,
    stagingRoot, runner = execFileAsync, sessionFactory = options => new MtpSession(options), onProgress = () => {} } = {}) {
    this.platform = platform;
    this.stagingRoot = stagingRoot;
    this.runner = runner;
    this.sessionFactory = sessionFactory;
    this.onProgress = onProgress;
    this.session = null;
    this.sessionDepth = 0;
    this.operationChain = Promise.resolve();
    this.closed = false;
    this.discovery = null;
    this.helper = platform === 'win32'
      ? path.join(resourcesPath, 'kindle-wpd.ps1')
      : path.join(resourcesPath, 'kindle-mtp');
  }

  async withSession(device, operation) {
    if (this.closed) throw new Error('Kindle transport is closed.');
    if (this.platform === 'win32') return operation();
    const run = this.operationChain.then(async () => {
      if (this.closed) throw new Error('Kindle transport is closed.');
      if (this.session && this.session.deviceId !== device.helperId) throw new Error('A different Kindle session is active.');
      if (!this.session) {
        this.session = this.sessionFactory({ helper: this.helper, deviceId: device.helperId,
          onProgress: progress => this.onProgress({ ...this.currentBook, ...progress, deviceId: device.id }) });
        this.sessionDevice = device;
        this.sessionFailed = false;
      }
      this.sessionDepth++;
      try { return await operation(); }
      finally {
        if (--this.sessionDepth === 0 && this.sessionFailed) {
          const session = this.session;
          this.session = null;
          this.sessionDevice = null;
          this.sessionFailed = false;
          await session?.close().catch(() => {});
        }
      }
    });
    this.operationChain = run.catch(() => {});
    return run;
  }

  async command(action, ...args) {
    if (this.closed) throw new Error('Kindle transport is closed.');
    if (!this.stagingRoot) throw new Error('MTP staging directory is unavailable.');
    if (this.session && action !== 'devices') {
      if (args[0] !== this.session.deviceId) throw new Error('Kindle device changed.');
      try { return await this.session.command(action, ...args.slice(1)); }
      catch (error) { this.sessionFailed = true; throw error; }
    }
    try { await fsp.access(this.helper); } catch { throw new Error('Kindle MTP adapter is unavailable.'); }
    const executable = this.platform === 'win32' ? 'powershell.exe' : this.helper;
    const argv = this.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.helper, action, ...args]
      : [action, ...args];
    const { stdout } = await this.runner(executable, argv, { timeout: 120000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    // libmtp prints device discovery messages on stdout before our JSON reply.
    const response = stdout.trim().split(/\r?\n/).at(-1);
    return JSON.parse(response || 'null');
  }

  async devices() {
    if (this.sessionDepth) return [this.sessionDevice];
    if (!this.discovery) {
      this.discovery = this.discover().finally(() => { this.discovery = null; });
    }
    return this.discovery;
  }

  async discover() {
    let entries;
    try {
      entries = await this.command('devices');
    } catch (error) {
      const detail = String(error?.stderr || error?.code || 'adapter error').replace(/\s+/g, ' ').trim().slice(0, 200);
      process.stderr.write(`Kindle MTP discovery failed: ${detail}\n`);
      return [];
    }
    if (!Array.isArray(entries)) return [];
    const devices = entries.map(entry => ({
      id: `mtp:${this.platform}:${String(entry.id)}`,
      helperId: String(entry.id),
      name: String(entry.name || 'Kindle'),
      kind: 'mtp',
    }));
    if (this.session && this.sessionDepth === 0 && !devices.some(device => device.helperId === this.session.deviceId)) {
      const stale = this.session;
      this.session = null;
      this.sessionDevice = null;
      await stale.close().catch(() => {});
    } else if (this.session && this.sessionDepth === 0) {
      this.sessionDevice = devices.find(device => device.helperId === this.session.deviceId);
    }
    return devices;
  }

  async files(device, allowedSizes) {
    this.currentBook = {};
    const entries = await this.command('files', device.helperId);
    return (Array.isArray(entries) ? entries : [])
      .filter(entry => allowedSizes.has(Number(entry.size)))
      .map(entry => ({ id: String(entry.id), name: String(entry.name), size: Number(entry.size), deviceId: device.helperId }));
  }

  ensureSpace(bytes) {
    if (this.session?.freeBytes !== null && this.session?.freeBytes !== undefined && this.session.freeBytes < bytes) {
      throw new Error('Kindle does not have enough free space.');
    }
  }

  async hash(file) {
    await fsp.mkdir(this.stagingRoot, { recursive: true });
    const directory = await fsp.mkdtemp(path.join(this.stagingRoot, 'kindle-'));
    const target = path.join(directory, 'download.tmp');
    try {
      await this.command('get', file.deviceId, file.id, target);
      return (await hashFile(target)).sha256;
    } finally {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  }

  async copy(device, book, name) {
    this.currentBook = { bookId: book.bookId, title: book.title };
    this.ensureSpace(book.size);
    let source = book.path;
    let directory = '';
    if (this.platform === 'win32') {
      await fsp.mkdir(this.stagingRoot, { recursive: true });
      directory = await fsp.mkdtemp(path.join(this.stagingRoot, 'kindle-'));
      source = path.join(directory, name);
      await fsp.copyFile(book.path, source);
    }
    let result;
    try { result = await this.command('put', device.helperId, source, name); }
    finally { if (directory) await fsp.rm(directory, { recursive: true, force: true }); }
    if (!result?.id) throw new Error('Kindle did not confirm the copied file.');
    const copied = { id: String(result.id), deviceId: device.helperId };
    if (await this.hash(copied) !== book.sha256) throw new Error('Kindle copy verification failed.');
    if (this.session?.freeBytes !== null && this.session?.freeBytes !== undefined) this.session.freeBytes -= book.size;
  }

  async close() {
    this.closed = true;
    const session = this.session;
    const closePromise = session?.close();
    try { await Promise.race([this.operationChain, closePromise || Promise.resolve()]); }
    finally {
      this.session = null;
      this.sessionDevice = null;
    }
    await closePromise;
  }
}

module.exports = { MtpKindles };
