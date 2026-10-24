'use strict';

const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

// One process owns one open PTP session. Closing between files can make a
// Kindle leave USB mode, so preview, copy, and read-back share this process.
class MtpSession {
  constructor({ helper, deviceId, spawnProcess = spawn, onProgress = () => {}, timeout = 120000 } = {}) {
    this.helper = helper;
    this.deviceId = deviceId;
    this.spawnProcess = spawnProcess;
    this.onProgress = onProgress;
    this.timeout = timeout;
    this.child = null;
    this.pending = null;
    this.chain = Promise.resolve();
    this.stderr = '';
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.freeBytes = null;
    this.closed = false;
    this.closePromise = null;
  }

  response(timeout = this.timeout) {
    if (this.closed) throw new Error('Kindle session is closed.');
    if (this.pending) throw new Error('Overlapping Kindle operation.');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.child?.kill('SIGTERM');
        this.closed = true;
        reject(new Error('Kindle operation timed out.'));
      }, timeout);
      this.pending = {
        resolve: value => { clearTimeout(timer); this.pending = null; resolve(value); },
        reject: error => { clearTimeout(timer); this.pending = null; reject(error); },
      };
    });
  }

  fail(error) {
    this.closed = true;
    this.pending?.reject(error);
    this.child?.kill('SIGTERM');
  }

  receive(bytes) {
    this.buffer += this.decoder.write(bytes);
    if (Buffer.byteLength(this.buffer) > 16 * 1024 * 1024) {
      this.fail(new Error('Kindle response exceeds size limits.'));
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      // libmtp also prints discovery diagnostics to stdout.
      if (!/^[\[{]/.test(line)) continue;
      let value;
      try { value = JSON.parse(line); }
      catch { this.fail(new Error('Invalid Kindle response.')); return; }
      if (value.progress === true) {
        this.onProgress({ phase: value.phase, percent: value.percent });
      } else if (value.error) {
        this.value = null;
        this.fail(new Error(String(value.error)));
      } else if (value.complete === true) {
        this.pending?.resolve(this.value);
        this.value = null;
      } else if (value.ready === true) {
        this.pending?.resolve(value);
      } else {
        this.value = value;
      }
    }
  }

  async start() {
    if (this.closed) throw new Error('Kindle session is closed.');
    const ready = this.response();
    let child;
    try {
      child = this.child = this.spawnProcess(this.helper, ['session', this.deviceId], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
    } catch (error) { this.pending?.reject(error); await ready.catch(() => {}); throw error; }
    child.stdout.on('data', bytes => this.receive(bytes));
    child.stderr.on('data', bytes => { this.stderr = (this.stderr + bytes.toString()).slice(-4096); });
    child.stdin.on('error', error => this.fail(error));
    child.on('error', error => this.fail(error));
    this.exited = new Promise(resolve => child.once('close', (code, signal) => {
      this.child = null;
      this.closed = true;
      this.pending?.reject(new Error(`Kindle disconnected (${code ?? signal}). ${this.stderr}`.trim()));
      resolve();
    }));
    const result = await ready;
    if (result?.ready !== true || !Number.isSafeInteger(result.freeBytes) || result.freeBytes < 0) {
      this.fail(new Error('Invalid Kindle session response.'));
      throw new Error('Invalid Kindle session response.');
    }
    this.freeBytes = result.freeBytes;
  }

  command(action, ...args) {
    const operation = this.chain.then(async () => {
      if (this.closed) throw new Error('Kindle session is closed.');
      if (!['files', 'get', 'put'].includes(action)
          || (action === 'files' ? args.length !== 0 : args.length !== 2)
          || args.some(value => typeof value !== 'string' || !value || /[\t\r\n\0]/.test(value))) {
        throw new Error('Invalid Kindle operation.');
      }
      if (!this.child) await this.start();
      this.value = null;
      const reply = this.response(action === 'files' ? this.timeout : Math.max(this.timeout, 600000));
      this.child.stdin.write([action, ...args].join('\t') + '\n');
      const result = await reply;
      const valid = action === 'files' ? Array.isArray(result)
        : action === 'get' ? result?.ok === true
          : typeof result?.id === 'string' && /^[1-9]\d{0,9}$/.test(result.id) && Number(result.id) <= 0xffffffff;
      if (!valid) { this.fail(new Error('Invalid Kindle operation response.')); throw new Error('Invalid Kindle operation response.'); }
      return result;
    });
    this.chain = operation.catch(() => {});
    return operation;
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    if (!this.child) return Promise.resolve();
    this.closePromise = this.closeChild();
    return this.closePromise;
  }

  async closeChild() {
    const child = this.child;
    let forceTimer;
    let settleTimer;
    child.stdin.end();
    try {
      await Promise.race([this.exited, new Promise(resolve => {
        forceTimer = setTimeout(() => {
          child.kill('SIGTERM');
          settleTimer = setTimeout(resolve, 1000);
        }, 5000);
      })]);
    } finally {
      clearTimeout(forceTimer);
      clearTimeout(settleTimer);
    }
  }
}

module.exports = { MtpSession };
