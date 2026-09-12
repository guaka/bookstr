'use strict';

// This service sees ciphertext and opaque capabilities, never book keys or
// names. Deploy behind HTTPS with proxy buffering and response caching off.
const http = require('node:http');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { verifyEvent } = require('nostr-tools/pure');

const BLOCK = 64 * 1024;
const digest = value => createHash('sha256').update(value).digest();

function byteRange(header, size) {
  if (header === undefined) return { start: 0, end: size - 1, status: 200 };
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end, status: 206 };
}

function createFileRelay({ allowedPubkeys, clock = () => Math.floor(Date.now() / 1000), requestTimeout = 30000 } = {}) {
  if (!Array.isArray(allowedPubkeys) || !allowedPubkeys.length || allowedPubkeys.some(key => !/^[a-f0-9]{64}$/.test(key))) {
    throw new Error('An explicit device public-key allowlist is required');
  }
  const allowed = new Set(allowedPubkeys), devices = new Map(), transfers = new Map(), pending = new Map();
  let active = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const match = /^\/v1\/files\/([a-f0-9]{32})$/.exec(req.url);
    if (!match || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
    const transfer = transfers.get(match[1]);
    const authorization = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    if (!transfer || !authorization || !timingSafeEqual(digest(authorization[1]), Buffer.from(transfer.tokenHash, 'hex')) || transfer.expires <= clock()) {
      res.writeHead(404).end(); return;
    }
    const peer = devices.get(transfer.owner);
    if (!peer || active >= 8) { res.writeHead(503, { 'Retry-After': '5' }).end(); return; }
    const etag = `"${match[1]}"`;
    const range = byteRange(req.headers['if-range'] && req.headers['if-range'] !== etag ? undefined : req.headers.range, transfer.size);
    if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${transfer.size}` }).end(); return; }
    const headers = { 'Content-Type': 'application/octet-stream', 'Content-Length': range.end - range.start + 1, 'Accept-Ranges': 'bytes', ETag: etag };
    if (range.status === 206) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${transfer.size}`;
    res.writeHead(range.status, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    active++;
    let offset = range.start, waiting, timer;
    const cleanup = () => { clearTimeout(timer); if (waiting) pending.delete(waiting); };
    res.once('close', () => { cleanup(); active--; });
    function requestBlock() {
      cleanup();
      if (res.destroyed) return;
      if (offset > range.end) { res.end(); return; }
      if (devices.get(transfer.owner) !== peer || transfer.expires <= clock()) { res.destroy(); return; }
      waiting = randomBytes(16).toString('hex');
      const length = Math.min(BLOCK, range.end - offset + 1);
      pending.set(waiting, { peer, length, abort: () => res.destroy(), receive: bytes => {
        cleanup();
        offset += bytes.length;
        res.write(bytes, () => requestBlock());
      } });
      timer = setTimeout(() => { cleanup(); res.destroy(); }, requestTimeout);
      peer.send(JSON.stringify({ type: 'read', requestId: waiting, transferId: match[1], offset, length }));
    }
    requestBlock();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: BLOCK + 16, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/v1/connect' || wss.clients.size >= 16) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, peer => wss.emit('connection', peer));
  });
  wss.on('connection', peer => {
    const challenge = randomBytes(32).toString('hex');
    let owner;
    const authTimer = setTimeout(() => peer.terminate(), requestTimeout);
    peer.send(JSON.stringify({ type: 'challenge', challenge }));
    peer.on('message', (bytes, binary) => {
      try {
        if (binary) {
          if (!owner || bytes.length < 16) throw new Error('Unauthenticated response');
          const id = bytes.subarray(0, 16).toString('hex'), request = pending.get(id);
          if (!request) return; // A cancelled HTTP request may have an in-flight reply.
          if (request.peer !== peer || bytes.length !== request.length + 16) throw new Error('Invalid response');
          request.receive(bytes.subarray(16));
          return;
        }
        const message = JSON.parse(bytes.toString());
        if (!owner) {
          const event = message.event;
          if (message.type !== 'auth' || !event || event.kind !== 27235 || event.content !== `bookstr-relay-v1:${challenge}` ||
              Math.abs(event.created_at - clock()) > 60 || !allowed.has(event.pubkey) || !verifyEvent(event)) throw new Error('Invalid authentication');
          owner = event.pubkey;
          const previous = devices.get(owner);
          devices.set(owner, peer);
          if (previous) previous.terminate();
          clearTimeout(authTimer);
          peer.send(JSON.stringify({ type: 'ready' }));
          return;
        }
        if (message.type === 'revoke') {
          if (transfers.get(message.transferId)?.owner === owner) transfers.delete(message.transferId);
          return;
        }
        if (message.type !== 'register' || !/^[a-f0-9]{32}$/.test(message.transferId) || !/^[a-f0-9]{64}$/.test(message.tokenHash) ||
            !Number.isSafeInteger(message.size) || message.size < 17 || message.size > 9 * 1024 ** 3 ||
            !Number.isSafeInteger(message.expires) || message.expires <= clock() || message.expires > clock() + 86400) throw new Error('Invalid transfer');
        for (const [id, item] of transfers) if (item.expires <= clock()) transfers.delete(id);
        const old = transfers.get(message.transferId);
        if (old && (old.owner !== owner || old.size !== message.size || old.tokenHash !== message.tokenHash)) throw new Error('Transfer identity changed');
        if (!old && transfers.size >= 256) throw new Error('Transfer limit');
        transfers.set(message.transferId, { owner, size: message.size, expires: message.expires, tokenHash: message.tokenHash });
        peer.send(JSON.stringify({ type: 'registered', transferId: message.transferId }));
      } catch {
        peer.close(1008, 'Invalid relay message');
      }
    });
    peer.on('error', () => peer.terminate());
    peer.on('close', () => {
      clearTimeout(authTimer);
      if (devices.get(owner) === peer) devices.delete(owner);
      for (const [id, request] of pending) if (request.peer === peer) { pending.delete(id); request.abort(); }
    });
  });
  return { server, close: async () => {
    for (const peer of wss.clients) peer.terminate();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    wss.close();
  } };
}

module.exports = { createFileRelay, byteRange, BLOCK };
