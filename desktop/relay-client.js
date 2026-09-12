'use strict';

const { open } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const WebSocket = require('ws');
const { readExactly } = require('./encrypted-transfer');

// Main-process only: signEvent and the ciphertext file handles never cross IPC.
class RelayClient {
  constructor({ url, signEvent, clock = () => Math.floor(Date.now() / 1000), allowLoopback = false }) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'wss:' && !(allowLoopback && endpoint.protocol === 'ws:' && endpoint.hostname === '127.0.0.1')) throw new Error('Relay requires WSS');
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/v1/connect') throw new Error('Invalid relay endpoint');
    this.url = url; this.signEvent = signEvent; this.clock = clock;
    this.files = new Map(); this.socket = null; this.stopped = true; this.timer = null;
  }

  async add({ manifest, ciphertextPath, capability, expires }) {
    if (!/^[a-f0-9]{64}$/.test(capability) || !Number.isSafeInteger(expires) || expires <= this.clock() || expires > this.clock() + 86400) throw new Error('Invalid transfer grant');
    const { validateManifest } = require('./encrypted-transfer');
    const count = validateManifest(manifest);
    if (this.files.has(manifest.transferId)) throw new Error('Transfer already registered');
    const file = await open(ciphertextPath, 'r');
    const size = manifest.size + count * 16;
    if ((await file.stat()).size !== size) { await file.close(); throw new Error('Ciphertext size mismatch'); }
    this.files.set(manifest.transferId, { file, registration: { type: 'register', transferId: manifest.transferId,
      size, expires, tokenHash: createHash('sha256').update(capability).digest('hex') } });
    if (this.ready) this.socket.send(JSON.stringify(this.files.get(manifest.transferId).registration));
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    this.ready = false;
    const socket = new WebSocket(this.url, { maxPayload: 4096, perMessageDeflate: false });
    this.socket = socket;
    let activeReads = 0;
    socket.on('message', async bytes => {
      try {
        const message = JSON.parse(bytes.toString());
        if (message.type === 'challenge') {
          if (!/^[a-f0-9]{64}$/.test(message.challenge)) throw new Error('Invalid challenge');
          const event = await this.signEvent({ kind: 27235, created_at: this.clock(), tags: [], content: `bookstr-relay-v1:${message.challenge}` });
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'auth', event }));
        } else if (message.type === 'ready') {
          this.ready = true;
          for (const item of this.files.values()) if (item.registration.expires > this.clock()) socket.send(JSON.stringify(item.registration));
        } else if (message.type === 'read') {
          const item = this.files.get(message.transferId);
          if (!this.ready || !item || item.registration.expires <= this.clock() || !/^[a-f0-9]{32}$/.test(message.requestId) ||
              !Number.isSafeInteger(message.offset) || message.offset < 0 || !Number.isSafeInteger(message.length) || message.length < 1 || message.length > 65536 ||
              message.offset + message.length > item.registration.size || activeReads >= 8 || socket.bufferedAmount > 1024 * 1024) throw new Error('Invalid relay read');
          activeReads++;
          try {
            const data = await readExactly(item.file, message.length, message.offset);
            if (socket.readyState === WebSocket.OPEN) socket.send(Buffer.concat([Buffer.from(message.requestId, 'hex'), data]));
          } finally { activeReads--; }
        }
      } catch { socket.close(1008, 'Invalid transfer request'); }
    });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      this.ready = false;
      if (!this.stopped) this.timer = setTimeout(() => this.connect(), 2000);
    });
  }

  async revoke(transferId) {
    const item = this.files.get(transferId);
    this.files.delete(transferId);
    if (this.ready) this.socket.send(JSON.stringify({ type: 'revoke', transferId }));
    if (item) await item.file.close();
  }

  async stop() {
    this.stopped = true; this.ready = false; clearTimeout(this.timer);
    if (this.socket) this.socket.terminate();
    for (const id of this.files.keys()) await this.revoke(id);
  }
}

module.exports = { RelayClient };
