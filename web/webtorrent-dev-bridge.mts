/// <reference path="../desktop/src/webtorrent.d.ts" />
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Torrent } from '../desktop/src/torrent-types.js';

const HOST = '127.0.0.1';
const PORT = 11112;
const MAX_TORRENT_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_DIR = path.join(os.tmpdir(), 'bookstr-webdev-webtorrent');

type Bridge = {
  active(): unknown;
  addPublic(torrentId: string | Buffer, options: { deselect?: boolean }): Promise<Torrent>;
  downloadSelected(torrentId: string | Buffer, options: { fileName: string; maxBytes: number }): Promise<{ filePath: string; torrent: Torrent }>;
  stop(): Promise<void>;
};
type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;
type BridgeServer = {
  listen(port: number, host: string, callback: () => void): unknown;
  close(callback: () => void): unknown;
};
type BridgeLogger = Pick<Console, 'log' | 'warn' | 'error'>;
type BridgeProcess = {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  exit(code: number): never;
};
type BridgeServices = {
  bridge: Bridge;
  readFile?: (filePath: string) => Promise<Buffer>;
  logger?: BridgeLogger;
  maxTorrentBytes?: number;
};
type StartServices = Partial<BridgeServices> & {
  bridgeFactory?: (dataDir: string) => Bridge;
  createServer?: (handler: RequestHandler) => BridgeServer;
  mkdir?: (directory: string, options: { recursive: true }) => Promise<unknown>;
  process?: BridgeProcess;
  host?: string;
  port?: number;
  dataDir?: string;
};

function reply(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value) as string);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function replyBytes(response: ServerResponse, status: number, body: Buffer): void {
  response.writeHead(status, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        reject(new Error('torrent metadata exceeds the development bridge limit'));
        request.destroy();
        return;
      }
      chunks.push(bytes);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function torrentReady(torrent: Torrent): Promise<Torrent> {
  if (Array.isArray(torrent.files) && torrent.files.length) return Promise.resolve(torrent);
  return new Promise((resolve, reject) => {
    torrent.once('ready', () => resolve(torrent));
    torrent.once('error', reject);
  });
}

function createJoinTorrent(bridge: Bridge, logger: BridgeLogger) {
  return async function joinTorrent(bytes: Buffer, wantedFile: string): Promise<Torrent> {
    const torrent = await bridge.addPublic(bytes, { deselect: true });
    torrent.on('warning', (warning: unknown) => logger.warn(`[webtorrent bridge] ${warning instanceof Error ? warning.message : String(warning)}`));
    torrent.on('error', (error: unknown) => logger.error(`[webtorrent bridge] ${error instanceof Error ? error.message : String(error)}`));
    await torrentReady(torrent);
    const file = torrent.files.find((candidate: Torrent['files'][number]) => (
      path.basename(String(candidate.path || candidate.name || '')).toLowerCase() === wantedFile
    ));
    if (!file) throw new Error(`${wantedFile} is absent from the repository torrent`);
    if (!file.select) throw new Error(`${wantedFile} does not support file selection`);
    file.select(10);
    return torrent;
  };
}

export function createBridgeRequestHandler({ bridge, readFile: readFileBytes = readFile, logger = console, maxTorrentBytes = MAX_TORRENT_BYTES }: BridgeServices): RequestHandler {
  const joinTorrent = createJoinTorrent(bridge, logger);
  return async (request, response) => {
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
      const torrentBytes = await readBody(request, maxTorrentBytes);
      if (url.pathname === '/download') {
        const result = await bridge.downloadSelected(torrentBytes, {
          fileName: wantedFile,
          maxBytes: 512 * 1024 * 1024,
        });
        const body = await readFileBytes(result.filePath);
        logger.log(`[webtorrent bridge] downloaded ${wantedFile} from ${result.torrent.infoHash}`);
        return replyBytes(response, 200, body);
      }
      const torrent = await joinTorrent(torrentBytes, wantedFile);
      logger.log(`[webtorrent bridge] joined ${torrent.infoHash} for ${wantedFile}`);
      return reply(response, 200, {
        infoHash: torrent.infoHash,
        file: wantedFile,
        peers: torrent.numPeers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[webtorrent bridge] ${message}`);
      return reply(response, 500, { error: message });
    }
  };
}

function defaultBridgeFactory(dataDir: string): Bridge {
  const require = createRequire(import.meta.url);
  const { WebTorrentBridge } = require('../desktop/webtorrent-bridge.js') as typeof import('../desktop/src/webtorrent-bridge.js');
  return new WebTorrentBridge({ dataDir });
}

export async function startWebTorrentDevBridge(services: StartServices = {}): Promise<{ bridge: Bridge; server: BridgeServer; shutdown: () => void }> {
  const host = services.host || HOST;
  const port = services.port ?? PORT;
  const dataDir = services.dataDir || DOWNLOAD_DIR;
  await (services.mkdir || mkdir)(dataDir, { recursive: true });
  const bridge = services.bridge || (services.bridgeFactory || defaultBridgeFactory)(dataDir);
  const handler = createBridgeRequestHandler({
    bridge,
    ...(services.readFile ? { readFile: services.readFile } : {}),
    ...(services.logger ? { logger: services.logger } : {}),
    ...(services.maxTorrentBytes !== undefined ? { maxTorrentBytes: services.maxTorrentBytes } : {}),
  });
  const server = (services.createServer || (requestHandler => http.createServer(requestHandler)))(handler);
  const processService = services.process || process;
  const shutdown = () => server.close(() => { void bridge.stop().finally(() => processService.exit(0)); });
  processService.on('SIGINT', shutdown);
  processService.on('SIGTERM', shutdown);
  server.listen(port, host, () => {
    (services.logger || console).log(`[webtorrent bridge] ready on http://${host}:${port}`);
  });
  return { bridge, server, shutdown };
}

export async function invokeIfMain(moduleURL: string, entrypoint: string | undefined, start: () => Promise<unknown> = startWebTorrentDevBridge): Promise<boolean> {
  const invokedURL = entrypoint ? pathToFileURL(path.resolve(entrypoint)).href : '';
  if (moduleURL !== invokedURL) return false;
  await start();
  return true;
}

await invokeIfMain(import.meta.url, process.argv[1], startWebTorrentDevBridge);
