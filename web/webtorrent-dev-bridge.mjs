import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WebTorrentBridge } = require('../desktop/webtorrent-bridge.js');

const HOST = '127.0.0.1';
const PORT = 11112;
const MAX_TORRENT_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_DIR = path.join(os.tmpdir(), 'bookstr-webdev-webtorrent');

await mkdir(DOWNLOAD_DIR, { recursive: true });

const bridge = new WebTorrentBridge({ dataDir: DOWNLOAD_DIR });

function reply(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function replyBytes(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_TORRENT_BYTES) {
        reject(new Error('torrent metadata exceeds the development bridge limit'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function torrentReady(torrent) {
  if (Array.isArray(torrent.files) && torrent.files.length) return Promise.resolve(torrent);
  return new Promise((resolve, reject) => {
    torrent.once('ready', () => resolve(torrent));
    torrent.once('error', reject);
  });
}

async function joinTorrent(bytes, wantedFile) {
  const torrent = await bridge.addPublic(bytes, { deselect: true });
  torrent.on('warning', warning => console.warn(`[webtorrent bridge] ${warning.message}`));
  torrent.on('error', error => console.error(`[webtorrent bridge] ${error.message}`));
  await torrentReady(torrent);
  const file = torrent.files.find(candidate => (
    path.basename(String(candidate.path || candidate.name || '')).toLowerCase() === wantedFile
  ));
  if (!file) throw new Error(`${wantedFile} is absent from the repository torrent`);
  file.select(10);
  return torrent;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      return reply(response, 200, { ok: true, torrents: bridge.active() });
    }
    if (request.method !== 'POST' || !['/join', '/download'].includes(url.pathname)) {
      return reply(response, 404, { error: 'not found' });
    }
    const wantedFile = String(url.searchParams.get('file') || '').trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(wantedFile)) {
      return reply(response, 400, { error: 'file must be an MD5 torrent file name' });
    }
    const torrentBytes = await readBody(request);
    if (url.pathname === '/download') {
      const result = await bridge.downloadSelected(torrentBytes, {
        fileName: wantedFile,
        maxBytes: 512 * 1024 * 1024,
      });
      const body = await readFile(result.filePath);
      console.log(`[webtorrent bridge] downloaded ${wantedFile} from ${result.torrent.infoHash}`);
      return replyBytes(response, 200, body);
    }
    const torrent = await joinTorrent(torrentBytes, wantedFile);
    console.log(`[webtorrent bridge] joined ${torrent.infoHash} for ${wantedFile}`);
    return reply(response, 200, {
      infoHash: torrent.infoHash,
      file: wantedFile,
      peers: torrent.numPeers,
    });
  } catch (error) {
    console.error(`[webtorrent bridge] ${error.message}`);
    return reply(response, 500, { error: error.message });
  }
});

function shutdown() {
  server.close(() => bridge.stop().finally(() => process.exit(0)));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.listen(PORT, HOST, () => {
  console.log(`[webtorrent bridge] ready on http://${HOST}:${PORT}`);
});
