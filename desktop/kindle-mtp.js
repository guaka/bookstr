'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { hashFile } = require('./library-import');

const execFileAsync = promisify(execFile);

class MtpKindles {
  constructor({ platform = process.platform, resourcesPath = process.resourcesPath || __dirname,
    stagingRoot, runner = execFileAsync } = {}) {
    this.platform = platform;
    this.stagingRoot = stagingRoot;
    this.runner = runner;
    this.helper = platform === 'win32'
      ? path.join(resourcesPath, 'kindle-wpd.ps1')
      : path.join(resourcesPath, 'kindle-mtp');
  }

  async command(action, ...args) {
    if (!this.stagingRoot) throw new Error('MTP staging directory is unavailable.');
    try { await fsp.access(this.helper); } catch { return action === 'devices' ? [] : Promise.reject(new Error('Kindle MTP adapter is unavailable.')); }
    const executable = this.platform === 'win32' ? 'powershell.exe' : this.helper;
    const argv = this.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.helper, action, ...args]
      : [action, ...args];
    const { stdout } = await this.runner(executable, argv, { timeout: 120000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout.trim() || 'null');
  }

  async devices() {
    let entries;
    try {
      entries = await this.command('devices');
    } catch (error) {
      const detail = String(error?.stderr || error?.code || 'adapter error').replace(/\s+/g, ' ').trim().slice(0, 200);
      process.stderr.write(`Kindle MTP discovery failed: ${detail}\n`);
      return [];
    }
    return (Array.isArray(entries) ? entries : []).map(entry => ({
      id: `mtp:${this.platform}:${String(entry.id)}`,
      helperId: String(entry.id),
      name: String(entry.name || 'Kindle'),
      kind: 'mtp',
    }));
  }

  async files(device, allowedSizes) {
    const entries = await this.command('files', device.helperId);
    return (Array.isArray(entries) ? entries : [])
      .filter(entry => allowedSizes.has(Number(entry.size)))
      .map(entry => ({ id: String(entry.id), name: String(entry.name), size: Number(entry.size), deviceId: device.helperId }));
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
  }
}

module.exports = { MtpKindles };
