import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Module, createRequire, registerHooks } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { Torrent } from '../../desktop/src/torrent-types.js';
import test, { mock } from 'node:test';
import { createBridgeRequestHandler, invokeIfMain, startWebTorrentDevBridge } from '../webtorrent-dev-bridge.mts';

const FILE = 'a'.repeat(32);
const TORRENT_BYTES = Buffer.from('torrent metadata');

class FakeRequest extends EventEmitter {
  destroyed = false;
  readonly method: string;
  readonly url: string;
  constructor(method: string, url: string) { super(); this.method = method; this.url = url; }
  destroy(): this { this.destroyed = true; return this; }
}

class FakeResponse {
  status = 0;
  headers: Record<string, number | string> = {};
  body = Buffer.alloc(0) as Buffer<ArrayBufferLike>;
  writeHead(status: number, headers: Record<string, number | string>): this { this.status = status; this.headers = headers; return this; }
  end(body?: Buffer | string): this { this.body = Buffer.isBuffer(body) ? body : Buffer.from(body || ''); return this; }
}

type Handler = ReturnType<typeof createBridgeRequestHandler>;
type BodyInput = { chunks?: Array<Buffer | string>; error?: Error; afterBody?: () => void };

async function send(handler: Handler, method: string, url: string, { chunks = [], error, afterBody }: BodyInput = {}) {
  const request = new FakeRequest(method, url);
  const response = new FakeResponse();
  const pending = handler(request as unknown as IncomingMessage, response as unknown as ServerResponse);
  if (method === 'POST') {
    setImmediate(() => {
      if (error) request.emit('error', error);
      else {
        for (const chunk of chunks) request.emit('data', chunk);
        request.emit('end');
        if (afterBody) setImmediate(afterBody);
      }
    });
  }
  await pending;
  return { request, response };
}

function responseJSON(response: FakeResponse): unknown {
  return JSON.parse(response.body.toString('utf8'));
}

function fakeTorrent({ files = [], infoHash = 'deadbeef', peers = 4 }: { files?: Torrent['files']; infoHash?: string; peers?: number } = {}): Torrent & EventEmitter {
  return Object.assign(new EventEmitter(), { files, infoHash, numPeers: peers }) as unknown as Torrent & EventEmitter;
}

function fakeBridge(torrent = fakeTorrent()) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const bridge = {
    active() { calls.push({ name: 'active', args: [] }); return [{ infoHash: 'active-hash' }]; },
    async addPublic(...args: [string | Buffer, { deselect?: boolean }]) { calls.push({ name: 'addPublic', args }); return torrent; },
    async downloadSelected(...args: [string | Buffer, { fileName: string; maxBytes: number }]) {
      calls.push({ name: 'downloadSelected', args });
      return { filePath: '/tmp/book.epub', torrent };
    },
    async stop() { calls.push({ name: 'stop', args: [] }); },
  };
  return { bridge, calls };
}

function logger() {
  const messages: Array<{ level: string; message: string }> = [];
  return {
    messages,
    log(message: string) { messages.push({ level: 'log', message }); },
    warn(message: string) { messages.push({ level: 'warn', message }); },
    error(message: string) { messages.push({ level: 'error', message }); },
  };
}

test('health and unsupported routes return stable JSON without reading request bodies', async () => {
  const { bridge } = fakeBridge();
  const handler = createBridgeRequestHandler({ bridge, logger: logger() });
  const health = await send(handler, 'GET', '/health');
  assert.equal(health.response.status, 200);
  assert.deepEqual(responseJSON(health.response), { ok: true, torrents: [{ infoHash: 'active-hash' }] });
  assert.equal(health.response.headers['Cache-Control'], 'no-store');
  for (const [method, url] of [['GET', '/join'], ['POST', '/unknown'], ['OPTIONS', '/health']]) {
    const missing = await send(handler, method!, url!);
    assert.equal(missing.response.status, 404);
    assert.deepEqual(responseJSON(missing.response), { error: 'not found' });
  }
  const defaultPath = await send(handler, 'GET', '');
  assert.equal(defaultPath.response.status, 404);
});

test('join validates file names before body reads and enforces metadata byte limits', async () => {
  const { bridge } = fakeBridge();
  const logs = logger();
  const handler = createBridgeRequestHandler({ bridge, logger: logs, maxTorrentBytes: 3 });
  const invalid = await send(handler, 'POST', '/join?file=../bad', { chunks: ['ignored'] });
  assert.equal(invalid.response.status, 400);
  assert.deepEqual(responseJSON(invalid.response), { error: 'file must be an MD5 torrent file name' });
  const missingFile = await send(handler, 'POST', '/join', { chunks: ['ignored'] });
  assert.deepEqual(responseJSON(missingFile.response), { error: 'file must be an MD5 torrent file name' });
  const oversized = await send(handler, 'POST', `/join?file=${FILE}`, { chunks: [Buffer.from('12'), '34'] });
  assert.equal(oversized.request.destroyed, true);
  assert.equal(oversized.response.status, 500);
  assert.deepEqual(responseJSON(oversized.response), { error: 'torrent metadata exceeds the development bridge limit' });
  assert.equal(logs.messages.at(-1)?.level, 'error');
});

test('download preserves limits, bytes, headers, and bridge errors', async () => {
  const { bridge, calls } = fakeBridge();
  const logs = logger();
  const bytes = Buffer.from('downloaded book');
  const handler = createBridgeRequestHandler({
    bridge,
    logger: logs,
    readFile: async filePath => { assert.equal(filePath, '/tmp/book.epub'); return bytes; },
  });
  const downloaded = await send(handler, 'POST', `/download?file=${FILE}`, { chunks: ['torrent ', 'metadata'] });
  assert.equal(downloaded.response.status, 200);
  assert.deepEqual(downloaded.response.body, bytes);
  assert.equal(downloaded.response.headers['Content-Type'], 'application/octet-stream');
  assert.equal(downloaded.response.headers['Content-Length'], bytes.length);
  assert.deepEqual(calls.find(call => call.name === 'downloadSelected')?.args, [TORRENT_BYTES, { fileName: FILE, maxBytes: 512 * 1024 * 1024 }]);
  assert.match(logs.messages[0]?.message || '', /downloaded/);

  const failingBridge = {
    ...bridge,
    async downloadSelected() { throw 'download rejected'; },
  };
  const failed = await send(createBridgeRequestHandler({ bridge: failingBridge, logger: logs }), 'POST', `/download?file=${FILE}`, { chunks: ['metadata'] });
  assert.equal(failed.response.status, 500);
  assert.deepEqual(responseJSON(failed.response), { error: 'download rejected' });
});

test('join waits for torrent readiness, selects the named file, and logs events', async () => {
  const torrent = fakeTorrent();
  const selected: number[] = [];
  const files = [
    {},
    { name: FILE.toUpperCase(), select(priority: number) { selected.push(priority); } },
  ];
  const mutableTorrent = torrent as unknown as { files: typeof files };
  const { bridge } = fakeBridge(torrent);
  const logs = logger();
  const handler = createBridgeRequestHandler({ bridge, logger: logs });
  const joined = await send(handler, 'POST', `/join?file=${FILE}`, {
    chunks: ['metadata'],
    afterBody: () => {
      mutableTorrent.files = files;
      torrent.emit('ready');
      torrent.emit('warning', new Error('slow peer'));
      torrent.emit('warning', 'retrying');
      torrent.emit('error', new Error('peer error'));
      torrent.emit('error', 'metadata warning');
    },
  });
  assert.equal(joined.response.status, 200, JSON.stringify(responseJSON(joined.response)));
  assert.deepEqual(responseJSON(joined.response), { infoHash: 'deadbeef', file: FILE, peers: 4 });
  assert.deepEqual(selected, [10]);
  assert.equal(logs.messages.filter(message => message.level === 'warn').length, 2);
  assert.equal(logs.messages.filter(message => message.level === 'error').length, 2);
  assert.ok(logs.messages.some(message => message.message.includes('joined deadbeef')));
});

test('join rejects missing and unselectable files and reports ready errors', async () => {
  const missingTorrent = fakeTorrent({ files: [{ name: 'other-file' }] });
  const missing = await send(createBridgeRequestHandler({ bridge: fakeBridge(missingTorrent).bridge, logger: logger() }), 'POST', `/join?file=${FILE}`, { chunks: ['metadata'] });
  assert.equal(missing.response.status, 500);
  assert.deepEqual(responseJSON(missing.response), { error: `${FILE} is absent from the repository torrent` });

  const unselectableTorrent = fakeTorrent({ files: [{ name: FILE }] });
  const unselectable = await send(createBridgeRequestHandler({ bridge: fakeBridge(unselectableTorrent).bridge, logger: logger() }), 'POST', `/join?file=${FILE}`, { chunks: ['metadata'] });
  assert.deepEqual(responseJSON(unselectable.response), { error: `${FILE} does not support file selection` });

  const pendingTorrent = fakeTorrent();
  const readyError = await send(createBridgeRequestHandler({ bridge: fakeBridge(pendingTorrent).bridge, logger: logger() }), 'POST', `/join?file=${FILE}`, {
    chunks: ['metadata'], afterBody: () => pendingTorrent.emit('error', 'metadata failed'),
  });
  assert.deepEqual(responseJSON(readyError.response), { error: 'metadata failed' });
});

test('body stream failures become JSON errors', async () => {
  const { bridge } = fakeBridge();
  const failed = await send(createBridgeRequestHandler({ bridge, logger: logger() }), 'POST', `/join?file=${FILE}`, { error: new Error('request interrupted') });
  assert.equal(failed.response.status, 500);
  assert.deepEqual(responseJSON(failed.response), { error: 'request interrupted' });
});

test('server startup wires the injected bridge, server, and shutdown lifecycle', async () => {
  const { bridge, calls } = fakeBridge();
  const logs = logger();
  const handlers = new Map<string, () => void>();
  let serverHandler: Handler | undefined;
  let listened: [number, string] | undefined;
  let closed = false;
  let exited: number | undefined;
  const server = {
    listen(port: number, host: string, callback: () => void) { listened = [port, host]; callback(); },
    close(callback: () => void) { closed = true; callback(); },
  };
  const started = await startWebTorrentDevBridge({
    bridge,
    mkdir: async (directory, options) => { assert.equal(directory, '/virtual/downloads'); assert.deepEqual(options, { recursive: true }); },
    createServer: handler => { serverHandler = handler; return server; },
    process: {
      on(signal, callback) { handlers.set(signal, callback as () => void); return process; },
      exit(code) { exited = code; return undefined as never; },
    },
    logger: logs,
    readFile: async () => Buffer.alloc(0),
    maxTorrentBytes: 42,
    dataDir: '/virtual/downloads',
    host: '127.0.0.2',
    port: 12345,
  });
  assert.equal(started.bridge, bridge);
  assert.equal(started.server, server);
  assert.equal(serverHandler !== undefined, true);
  assert.deepEqual(listened, [12345, '127.0.0.2']);
  assert.ok(logs.messages.some(message => message.message.includes('ready on http://127.0.0.2:12345')));
  handlers.get('SIGINT')?.();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, true);
  assert.equal(exited, 0);
  assert.equal(calls.filter(call => call.name === 'stop').length, 1);
  assert.equal(typeof started.shutdown, 'function');
});

test('default bridge factory is lazy and entrypoint dispatch is testable without starting clients', async () => {
  const bridgeModuleRequire = createRequire(new URL('../webtorrent-dev-bridge.mts', import.meta.url));
  const virtualAdapterPath = path.join(tmpdir(), 'bookstr-virtual-webtorrent-bridge.js');
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '../desktop/webtorrent-bridge.js') {
        return { url: pathToFileURL(virtualAdapterPath).href, format: 'commonjs', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const adapterPath = bridgeModuleRequire.resolve('../desktop/webtorrent-bridge.js');
  const previous = bridgeModuleRequire.cache[adapterPath];
  const { bridge } = fakeBridge();
  let dataDirectory = '';
  class FakeAdapter extends EventEmitter {
    active = bridge.active;
    addPublic = bridge.addPublic;
    downloadSelected = bridge.downloadSelected;
    stop = bridge.stop;
    constructor(options: { dataDir: string }) { super(); dataDirectory = options.dataDir; }
  }
  const stubModule = new Module(adapterPath);
  stubModule.exports = { WebTorrentBridge: FakeAdapter };
  bridgeModuleRequire.cache[adapterPath] = stubModule;
  const server = {
    listen(_port: number, _host: string, callback: () => void) { callback(); },
    close(callback: () => void) { callback(); },
  };
  const defaultHttpServer = mock.method(http, 'createServer', (requestHandler: RequestListener) => {
    assert.equal(typeof requestHandler, 'function');
    return server as ReturnType<typeof http.createServer>;
  });
  const originalProcessOn = process.on;
  const defaultConsole = mock.method(console, 'log', () => undefined);
  try {
    const defaultDir = path.join(tmpdir(), 'bookstr-webdev-webtorrent');
    let createdDirectory = '';
    process.on = ((signal: string | symbol, _listener: (...args: never[]) => void) => {
      assert.ok(signal === 'SIGINT' || signal === 'SIGTERM');
      return process;
    }) as typeof process.on;
    const started = await startWebTorrentDevBridge({
      mkdir: async directory => { createdDirectory = directory; },
    });
    assert.equal(dataDirectory, defaultDir);
    assert.equal(createdDirectory, defaultDir);
    assert.ok(started.bridge);
    assert.equal(defaultHttpServer.mock.calls.length, 1);
    assert.ok(defaultConsole.mock.calls.length > 0);
    defaultHttpServer.mock.restore();
    process.on = originalProcessOn;

    let called = 0;
    assert.equal(await invokeIfMain('file:///repo/tool.mts', undefined, async () => { called += 1; }), false);
    assert.equal(await invokeIfMain('file:///repo/tool.mts', '/elsewhere/tool.mts', async () => { called += 1; }), false);
    assert.equal(await invokeIfMain('file:///repo/tool.mts', '/repo/tool.mts', async () => { called += 1; }), true);
    assert.equal(called, 1);
  } finally {
    if (previous) bridgeModuleRequire.cache[adapterPath] = previous;
    else delete bridgeModuleRequire.cache[adapterPath];
    hook.deregister();
    defaultConsole.mock.restore();
    defaultHttpServer.mock.restore();
    process.on = originalProcessOn;
  }
});

test('default file reader and default filesystem setup work through injected server services', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bookstr-dev-bridge-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'download.epub');
  await writeFile(filePath, 'default file reader');
  const { bridge } = fakeBridge();
  const fileBridge = {
    ...bridge,
    async downloadSelected() { return { filePath, torrent: fakeTorrent() }; },
  };
  const handlers = new Map<string, () => void>();
  const logs = mock.method(console, 'log', () => undefined);
  let handler: Handler | undefined;
  const fakeServer = {
    listen(_port: number, _host: string, callback: () => void) { callback(); },
    close(callback: () => void) { callback(); },
  };
  const started = await startWebTorrentDevBridge({
    bridge: fileBridge,
    dataDir: directory,
    createServer: requestHandler => { handler = requestHandler; return fakeServer; },
    process: {
      on(signal, callback) { handlers.set(signal, callback as () => void); return process; },
      exit() { return undefined as never; },
    },
  });
  assert.ok(logs.mock.calls.length > 0);
  assert.equal(await readFile(filePath, 'utf8'), 'default file reader');
  assert.ok(handler);
  const result = await send(handler, 'POST', `/download?file=${FILE}`, { chunks: ['torrent metadata'] });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.body.toString('utf8'), 'default file reader');
  assert.equal(typeof started.shutdown, 'function');
});
