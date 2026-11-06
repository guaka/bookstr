const { test } = require('node:test') as typeof import('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs = require('node:fs/promises') as typeof import('node:fs/promises');
const path = require('node:path') as typeof import('node:path');
const vm = require('node:vm') as typeof import('node:vm');
const crypto = require('node:crypto') as typeof import('node:crypto');
const { hashFile } = require('../../library-import') as typeof import('../../src/library-import');

test('main IPC registration derives authorization from the current live library window', async () => {
  const main = await fs.readFile(path.join(__dirname, '../../main.js'), 'utf8');
  const start = main.indexOf('function setupIpcHandlers()');
  const end = main.indexOf("authorizedIpcMain.handle('bookstr-desktop-catalog-current'", start);
  assert.ok(start > 0 && end > start);
  let expected: (() => unknown[]) | undefined;
  const contents = { isDestroyed: () => false };
  const window = { isDestroyed: () => false, webContents: contents };
  const context: Record<string, unknown> = {
    mainWindow: window, ipcMain: {}, APP_ORIGIN: 'app://bookstr',
    require: (name: string) => {
      assert.equal(name, './ipc-authorization');
      return { createAuthorizedIpcMain: (_ipc: unknown, getter: () => unknown[], origin: string) => {
        assert.equal(origin, 'app://bookstr');
        expected = getter;
        return {};
      } };
    },
  };
  vm.runInNewContext(`${main.slice(start, end)} } setupIpcHandlers();`, context);
  assert.deepEqual(Array.from(expected!()), [contents]);
  contents.isDestroyed = () => true;
  assert.deepEqual(Array.from(expected!()), []);
  contents.isDestroyed = () => false;
  window.isDestroyed = () => true;
  assert.deepEqual(Array.from(expected!()), []);
  context.mainWindow = null;
  assert.deepEqual(Array.from(expected!()), []);
  const replacement = { isDestroyed: () => false };
  context.mainWindow = { isDestroyed: () => false, webContents: replacement };
  assert.deepEqual(Array.from(expected!()), [replacement]);
});

test('public torrent IPC verifies the downloaded file through the streaming hash helper', async t => {
  const root = await fs.mkdtemp(path.join(__dirname, '.torrent-hash-'));
  try {
    const contents = Buffer.alloc(256 * 1024, 42);
    const digest = crypto.createHash('sha256').update(contents).digest('hex');
    await fs.writeFile(path.join(root, 'book.pdf'), contents);
    const main = await fs.readFile(path.join(__dirname, '../../main.js'), 'utf8');
    const start = main.indexOf("authorizedIpcMain.handle('bookstr-desktop-transfer-download-public'");
    const end = main.indexOf("authorizedIpcMain.handle('bookstr-desktop-transfer-add-private'", start);
    assert.ok(start > 0 && end > start);
    let handler: (_event: unknown, request: unknown) => Promise<unknown>;
    const registered: unknown[] = [];
    const book = { id: 'book', sha256: digest, filesize_bytes: contents.length };
    const store = {
      getBook: () => book,
      registerLibraryFile: (file: unknown) => registered.push(file),
      openReader: () => ({ token: 'reader-token' }),
    };
    let hashCalls = 0;
    const context = {
      authorizedIpcMain: { handle: (_channel: string, callback: typeof handler) => { handler = callback; } },
      isRecord: (value: unknown) => value !== null && typeof value === 'object',
      getLibraryStore: () => store,
      normalizeHex: (value: string) => value,
      Buffer, path, fs, libraryDataDir: root, APP_ORIGIN: 'app://bookstr',
      getTorrentBridge: () => ({ downloadPublic: async () => ({ files: [{ path: 'book.pdf' }], infoHash: 'torrent' }) }),
      libraryRelativePath: (value: string) => value,
      hashFile: async (filename: string) => { hashCalls += 1; return hashFile(filename); },
    };
    vm.runInNewContext(main.slice(start, end), context);
    t.mock.method(fs, 'readFile', async () => { throw new Error('whole-file reads are forbidden during verification'); });
    const request = { bookId: 'book', torrentId: 'magnet:?xt=fixture', sha256: digest };
    const result = await handler!(null, request);
    assert.equal(hashCalls, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(registered)), [{ bookId: 'book', relativePath: 'book.pdf', size: contents.length, sha256: digest }]);
    assert.equal((result as { url: string }).url, 'app://bookstr/api/library-file/reader-token');
    book.sha256 = 'a'.repeat(64);
    await assert.rejects(handler!(null, { ...request, sha256: book.sha256 }), /SHA-256 does not match/);
    assert.equal(registered.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('main state adapters delegate to the queued store and propagate save failures', async () => {
  const main = await fs.readFile(path.join(__dirname, '../../main.js'), 'utf8');
  const start = main.indexOf('async function loadState()');
  const end = main.indexOf('async function torrentPreferences()', start);
  assert.ok(start > 0 && end > start);
  const saved: unknown[] = [];
  const state = { desktopNostr: { mode: 'local' } };
  const context = vm.createContext({
    desktopStateStore: { load: async () => state, save: async (patch: unknown) => { saved.push(patch); } },
    isRecord: (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value),
  });
  vm.runInContext(main.slice(start, end), context);
  assert.equal(await vm.runInContext('loadState()', context), state);
  await vm.runInContext('saveState(null)', context);
  await vm.runInContext('saveState({ windowBounds: { width: 900 } })', context);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ windowBounds: { width: 900 } }]);
  const failure = new Error('disk full');
  context.desktopStateStore.save = async () => { throw failure; };
  await assert.rejects(vm.runInContext('saveState({ next: true })', context), failure);
});

test('window event state saves log persistence errors instead of rejecting event callbacks', async () => {
  const main = await fs.readFile(path.join(__dirname, '../../main.js'), 'utf8');
  const start = main.indexOf("mainWindow.on('resize'");
  const end = main.indexOf('\n}', start);
  assert.ok(start > 0 && end > start);
  const handlers = new Map<string, () => void>();
  const failure = new Error('disk full');
  const errors: unknown[][] = [];
  const patches: unknown[] = [];
  let fail = false;
  const context = {
    mainWindow: {
      on: (name: string, handler: () => void) => handlers.set(name, handler),
      isMinimized: () => false, isMaximized: () => false, isDestroyed: () => false,
      getBounds: () => ({ width: 900 }),
    },
    saveState: async (patch: unknown) => { if (fail) throw failure; patches.push(patch); },
    console: { error: (...args: unknown[]) => errors.push(args) },
  };
  vm.runInNewContext(main.slice(start, end), context);
  for (const name of ['resize', 'close']) handlers.get(name)!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(patches.length, 2);
  fail = true;
  for (const name of ['resize', 'close']) handlers.get(name)!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors.length, 2);
  assert.equal(errors[0]![1], failure);
  assert.equal(errors[1]![1], failure);
});
