'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LibraryStore } = require('../../library-store');
const { KindleSync, MountedKindles, safeFilename, defaultRoots } = require('../../kindle-sync');
const { MtpKindles } = require('../../kindle-mtp');

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

test('Kindle preview hashes existing files and transfer copies only missing supported books', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-'));
  const documents = path.join(root, 'Kindle', 'documents');
  const library = path.join(root, 'library');
  await fs.mkdir(documents, { recursive: true });
  await fs.mkdir(library);
  const store = new LibraryStore({ dbPath: path.join(library, 'library.sqlite'), libraryRoot: library });
  const files = new Map();
  try {
    for (const [id, title, extension, bytes] of [
      ['a', 'Already There', 'pdf', 'existing PDF bytes'],
      ['b', 'New PDF', 'pdf', 'different PDF bytes'],
      ['c', 'EPUB skipped', 'epub', 'an EPUB'],
    ]) {
      const filePath = path.join(library, `${id}.${extension}`);
      await fs.writeFile(filePath, bytes);
      files.set(id, filePath);
      store.upsertBook({ id, title, authors: 'Author', extension, sha256: digest(bytes) });
      store.registerLibraryFile({ bookId: id, relativePath: `${id}.${extension}`, sha256: digest(bytes), size: bytes.length });
      store.setDownload({ bookId: id, status: 'ready', bytes: bytes.length, totalBytes: bytes.length });
    }
    await fs.writeFile(path.join(documents, 'renamed-existing.pdf'), 'existing PDF bytes');
    const transport = new MountedKindles({ roots: [root], platform: 'darwin' });
    const sync = new KindleSync({ store, resolveFile: async id => ({ filePath: files.get(id) }), transports: [transport] });
    const [device] = await sync.devices();
    assert.equal(device.name, 'Kindle');
    const plan = await sync.preview(device.id);
    assert.deepEqual(plan.missing.map(item => item.title), ['New PDF']);
    assert.equal(plan.alreadyPresent, 1);
    assert.match(plan.skipped[0].reason, /epub is not supported/);
    assert.deepEqual((await sync.preview(device.id, 'b')).missing.map(item => item.bookId), ['b']);
    assert.equal((await sync.preview(device.id, 'a')).alreadyPresent, 1);
    await assert.rejects(() => sync.preview(device.id, 'c'), /epub is not supported/);
    await assert.rejects(() => sync.transfer(device.id, 'unknown'), /not found/);
    store.setDownload({ bookId: 'b', status: 'downloading', bytes: 4, totalBytes: 20 });
    await assert.rejects(() => sync.preview(device.id, 'b'), /Book is not downloaded/);
    store.setDownload({ bookId: 'b', status: 'ready', bytes: 20, totalBytes: 20 });
    const missingFile = new KindleSync({ store, resolveFile: async () => { throw new Error('Local file is missing'); }, transports: [transport] });
    await assert.rejects(() => missingFile.preview(device.id, 'b'), /Local file is missing/);
    const single = await sync.transfer(device.id, 'b');
    assert.deepEqual(single.transferred, ['b']);
    assert.equal((await sync.transfer(device.id, 'b')).alreadyPresent, 1);
    const result = await sync.transfer(device.id);
    assert.deepEqual(result.transferred, []);
    assert.equal((await sync.preview(device.id)).missing.length, 0);
    assert.equal(await fs.readFile(path.join(documents, 'renamed-existing.pdf'), 'utf8'), 'existing PDF bytes');
    assert.match(safeFilename({ title: 'A/B', authors: 'C:D', extension: 'pdf' }, digest('bytes')), /^A B - C D - [a-f0-9]{16}\.pdf$/);
    await fs.rm(path.join(root, 'Kindle'), { recursive: true });
    await assert.rejects(() => sync.preview(device.id), /disconnected/);
  } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Kindle presence scans export names once, caches per device, expires, and clears on disconnect', async () => {
  const bytes = Buffer.from('exported PDF');
  const sha256 = digest(bytes);
  const wrongSizeBytes = Buffer.from('other exported PDF');
  const wrongSizeSha = digest(wrongSizeBytes);
  const job = { bookId: 'book', title: 'Updated title', authors: 'Updated author', extension: 'pdf', status: 'ready', sha256 };
  const wrongSizeJob = { bookId: 'wrong-size', title: 'Wrong size', authors: 'Writer', extension: 'pdf', status: 'ready', sha256: wrongSizeSha };
  let connected = true;
  let fileScans = 0;
  let sessions = 0;
  let now = 1_000;
  const store = { downloads: () => [job, wrongSizeJob], libraryFile: id => id === 'book'
    ? ({ sha256, sizeBytes: bytes.length }) : ({ sha256: wrongSizeSha, sizeBytes: wrongSizeBytes.length }) };
  const transport = {
    devices: async () => connected ? [{ id: 'device', name: 'Kindle', kind: 'test' }] : [],
    files: async (_device, sizes) => {
      fileScans++;
      assert.deepEqual([...sizes].sort((a, b) => a - b), [bytes.length, wrongSizeBytes.length].sort((a, b) => a - b));
      return [
        { id: 'remote-1', name: `Old title - Old author - ${sha256.slice(0, 16)}.pdf`, size: bytes.length },
        { id: 'remote-wrong-size', name: `A different exported title - ${sha256.slice(0, 16)}.pdf`, size: wrongSizeBytes.length },
      ];
    },
    async withSession(_device, operation) { sessions++; return operation(); },
  };
  const sync = new KindleSync({ store, resolveFile: async () => assert.fail('presence must use stored metadata'),
    transports: [transport], now: () => now, presenceTtlMs: 60_000 });
  const first = await sync.presence('device');
  assert.deepEqual(first, { deviceId: 'device', bookIds: ['book'] });
  assert.deepEqual(await sync.presence('device'), first);
  assert.equal(fileScans, 1);
  assert.equal(sessions, 1);
  now += 60_001;
  await sync.presence('device');
  assert.equal(fileScans, 2, 'expired cache should rescan the connected device');
  connected = false;
  assert.deepEqual(await sync.devices(), []);
  await assert.rejects(() => sync.presence('device'), /disconnected/);
  connected = true;
  await sync.presence('device');
  assert.equal(fileScans, 3, 'disconnect clears the cached inventory');
});

test('preview and successful transfers retain verified IDs but still perform the first metadata inventory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-presence-verified-'));
  const source = path.join(root, 'book.pdf');
  const bytes = Buffer.from('verified by preview');
  await fs.writeFile(source, bytes);
  const sha256 = digest(bytes);
  const job = { bookId: 'verified', title: 'Verified', authors: 'Writer', extension: 'pdf', status: 'ready', sha256 };
  const store = { downloads: () => [job], libraryFile: () => ({ sha256, sizeBytes: bytes.length }) };
  let filesCalls = 0;
  let transferFilesCalls = 0;
  let copies = 0;
  let hashes = 0;
  const transport = {
    devices: async () => [{ id: 'device', name: 'Kindle', kind: 'test' }],
    files: async () => { filesCalls++; return [{ id: 'remote', name: 'renamed.pdf', size: bytes.length }]; },
    hash: async () => { hashes++; return sha256; },
    copy: async () => { copies++; },
  };
  try {
    const sync = new KindleSync({ store, resolveFile: async () => ({ filePath: source }), transports: [transport] });
    await sync.preview('device');
    assert.deepEqual((await sync.presence('device')).bookIds, ['verified']);
    assert.equal(filesCalls, 2, 'verified preview results must not suppress the first complete inventory');
    assert.equal(hashes, 1);

    const absentTransport = { ...transport, files: async () => { transferFilesCalls++; return []; }, hash: async () => '', copy: async () => { copies++; } };
    const transferred = new KindleSync({ store, resolveFile: async () => ({ filePath: source }), transports: [absentTransport] });
    assert.deepEqual((await transferred.transfer('device')).transferred, ['verified']);
    assert.deepEqual((await transferred.presence('device')).bookIds, ['verified']);
    assert.equal(copies, 1);
    assert.equal(transferFilesCalls, 2, 'transfer planning and subsequent first presence call both list metadata');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('presence uses only existing cached comic PDFs and ignores uncached comics', async () => {
  const comicSha = digest('comic archive');
  const cachedSha = digest('cached PDF');
  const jobs = [
    { bookId: 'cached-comic', title: 'Cached.cbz', authors: 'Writer', extension: 'cbz', status: 'ready', sha256: comicSha },
    { bookId: 'uncached-comic', title: 'Uncached.cbr', authors: 'Writer', extension: 'cbr', status: 'ready', sha256: digest('other archive') },
  ];
  const store = { downloads: () => jobs };
  let cacheLookups = 0;
  let scans = 0;
  const comicConverter = {
    cached: async sourceSha => {
      cacheLookups++;
      return sourceSha === comicSha ? { path: '/cache/comic.pdf', sha256: cachedSha, size: 10 } : null;
    },
    convert: async () => assert.fail('presence must never convert a comic'),
  };
  const transport = {
    devices: async () => [{ id: 'device', name: 'Kindle', kind: 'test' }],
    files: async (_device, sizes) => {
      scans++;
      assert.deepEqual([...sizes], [10]);
      return [{ id: 'remote', name: safeFilename({ ...jobs[0], extension: 'pdf' }, cachedSha), size: 10 }];
    },
  };
  const sync = new KindleSync({ store, resolveFile: async () => assert.fail('presence must not resolve comics'),
    transports: [transport], comicConverter });
  assert.deepEqual((await sync.presence('device')).bookIds, ['cached-comic']);
  assert.equal(cacheLookups, 2);
  assert.equal(scans, 1);
});

test('MTP transfer keeps its session when the first candidate is already present and copies the next', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-mtp-persistent-'));
  const helper = path.join(root, 'kindle-mtp');
  const library = path.join(root, 'library');
  await fs.mkdir(library);
  await fs.writeFile(helper, 'fixture');
  const store = new LibraryStore({ dbPath: path.join(library, 'library.sqlite'), libraryRoot: library });
  const contents = new Map();
  const localFiles = new Map();
  let sessionOpens = 0;
  try {
    for (const [bookId, bytes] of [['already', 'already present bytes'], ['next', 'copy this next']]) {
      const filePath = path.join(library, `${bookId}.pdf`);
      await fs.writeFile(filePath, bytes);
      localFiles.set(bookId, filePath);
      store.upsertBook({ id: bookId, title: bookId, extension: 'pdf', sha256: digest(bytes) });
      store.registerLibraryFile({ bookId, relativePath: `${bookId}.pdf`, sha256: digest(bytes), size: Buffer.byteLength(bytes) });
      store.setDownload({ bookId, status: 'ready', bytes: Buffer.byteLength(bytes), totalBytes: Buffer.byteLength(bytes) });
    }
    contents.set('11', Buffer.from('already present bytes'));
    const transport = new MtpKindles({ platform: 'darwin', resourcesPath: root, stagingRoot: path.join(root, 'staging'),
      runner: async (_executable, args) => args[0] === 'devices'
        ? { stdout: '[{"id":"1-2","name":"Kindle"}]' }
        : { stdout: '[]' },
      sessionFactory: ({ deviceId }) => {
        sessionOpens++;
        return {
          deviceId,
          freeBytes: 10000,
          command: async (action, ...args) => {
            if (action === 'files') return [...contents].map(([id, bytes]) => ({ id, name: `${id}.pdf`, size: bytes.length }));
            if (action === 'get') { await fs.writeFile(args[1], contents.get(args[0])); return { ok: true }; }
            if (action === 'put') {
              const id = '12';
              contents.set(id, await fs.readFile(args[0]));
              return { id };
            }
            throw new Error(`unexpected ${action}`);
          },
          close: async () => {},
        };
      },
    });
    const sync = new KindleSync({ store, resolveFile: async id => ({ filePath: localFiles.get(id) }), transports: [transport] });
    const [device] = await sync.devices();
    const result = await sync.transfer(device.id);
    assert.deepEqual(result.transferred, ['next']);
    assert.equal(result.alreadyPresent, 1);
    assert.equal(sessionOpens, 1);
    assert.equal(contents.get('12').toString(), 'copy this next');
    await sync.close();
  } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('MTP transport uses its packaged helper and verifies copied bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-mtp-'));
  const helper = path.join(root, 'kindle-mtp');
  await fs.writeFile(helper, 'fixture');
  const remote = new Map([['17', Buffer.from('remote PDF')]]);
  const calls = [];
  const runner = async (_executable, args) => {
    calls.push(args);
    if (args[0] === 'devices') return { stdout: 'Device 0 is a Kindle Scribe.\n[{"id":"1-2","name":"Kindle Scribe"}]\n' };
    if (args[0] === 'files') return { stdout: 'Device 0 is a Kindle Scribe.\n[{"id":"17","name":"old.pdf","size":10}]\n' };
    if (args[0] === 'get') { await fs.writeFile(args[3], remote.get(args[2])); return { stdout: '{"ok":true}' }; }
    if (args[0] === 'put') { remote.set('18', await fs.readFile(args[2])); return { stdout: '{"id":"18"}' }; }
    throw new Error('unexpected command');
  };
  try {
    const transport = new MtpKindles({ platform: 'darwin', resourcesPath: root, stagingRoot: path.join(root, 'staging'), runner });
    const [device] = await transport.devices();
    assert.equal(device.kind, 'mtp');
    const [file] = await transport.files(device, new Set([10]));
    assert.equal(await transport.hash(file), digest('remote PDF'));
    const source = path.join(root, 'new.pdf');
    await fs.writeFile(source, 'new PDF');
    await transport.copy(device, { path: source, sha256: digest('new PDF') }, 'new.pdf');
    assert.equal(remote.get('18').toString(), 'new PDF');
    assert.ok(calls.some(call => call[0] === 'put'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('MTP discovery reports bounded adapter diagnostics without hiding the device-list failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-mtp-discovery-'));
  const helper = path.join(root, 'kindle-mtp');
  const originalWrite = process.stderr.write;
  let diagnostics = '';
  process.stderr.write = chunk => { diagnostics += String(chunk); return true; };
  try {
    await fs.writeFile(helper, 'fixture');
    for (const [error, expected] of [
      [Object.assign(new Error('helper failed'), { stderr: 'Kindle MTP open failed.\n', code: 'EIO' }), /Kindle MTP open failed/],
      [Object.assign(new Error('helper failed'), { code: 'ETIMEDOUT' }), /ETIMEDOUT/],
      [new Error('helper failed'), /adapter error/],
      [Object.assign(new Error('helper failed'), { stderr: 'x'.repeat(300) }), /x{200}/],
    ]) {
      diagnostics = '';
      const transport = new MtpKindles({ platform: 'darwin', resourcesPath: root, stagingRoot: path.join(root, 'staging'),
        runner: async () => { throw error; } });
      assert.deepEqual(await transport.devices(), []);
      assert.match(diagnostics, expected);
      assert.ok(diagnostics.length <= 240);
    }
  } finally {
    process.stderr.write = originalWrite;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native MTP discovery lists Amazon USB ids without opening or scanning folders', async () => {
  const source = await fs.readFile(path.join(__dirname, '../../native/kindle-mtp.c'), 'utf8');
  const body = source.match(/static int list_devices\(void\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(body, 'native device-list function is present');
  assert.match(body, /kindle_raw_devices\(&raw, &count\)/);
  assert.doesNotMatch(source, /LIBMTP_Detect_Raw_Devices/);
  assert.match(body, /device_entry\.vendor_id != 0x1949/);
  assert.doesNotMatch(body, /LIBMTP_Open_Raw_Device_Uncached|LIBMTP_Get_Folder_List|documents_folder/);
  assert.match(source, /Kindle MTP open failed/);
  assert.match(source, /Kindle Documents folder could not be read during preview/);
});

test('refreshing Kindle devices never opens a preview or starts a transfer', async () => {
  const source = await fs.readFile(path.join(__dirname, '../../../web/index.html'), 'utf8');
  const body = source.split('async function refreshKindleOffer() {')[1]?.split("desktopKindleDevice.addEventListener('change'")[0];
  assert.ok(body, 'Kindle device refresh handler is present');
  assert.match(body, /await desktopBridge\.kindle\.devices\(\)/);
  assert.doesNotMatch(body, /\.kindle\.(?:preview|transfer)\(/);
});

test('overlapping refreshes share discovery and a later refresh sees fresh devices', { timeout: 2000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-mtp-refresh-'));
  let release;
  let calls = 0;
  try {
    await fs.writeFile(path.join(root, 'kindle-mtp'), 'fixture');
    const transport = new MtpKindles({ platform: 'darwin', resourcesPath: root, stagingRoot: root,
      runner: async () => {
        calls++;
        if (calls === 1) await new Promise(resolve => { release = resolve; });
        return { stdout: calls === 1 ? '[{"id":"1-2","name":"Kindle"}]' : '[]' };
      } });
    const first = transport.devices();
    const second = transport.devices();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    assert.deepEqual(await first, await second);
    assert.equal(calls, 1);
    assert.deepEqual(await transport.devices(), []);
    assert.equal(calls, 2);
    transport.runner = async () => { calls++; throw new Error('disconnected'); };
    const originalWrite = process.stderr.write;
    process.stderr.write = () => true;
    try { assert.deepEqual(await transport.devices(), []); }
    finally { process.stderr.write = originalWrite; }
    assert.equal(transport.discovery, null);
    transport.runner = async () => { calls++; return { stdout: '[{"id":"1-3"}]' }; };
    assert.equal((await transport.devices())[0].helperId, '1-3');
    assert.equal(calls, 4);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('mounted Kindle refuses low space and never overwrites a destination', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-space-'));
  const documents = path.join(root, 'Kindle', 'documents');
  await fs.mkdir(documents, { recursive: true });
  const source = path.join(root, 'source.pdf');
  await fs.writeFile(source, 'PDF bytes');
  const book = { path: source, size: 9, sha256: digest('PDF bytes') };
  try {
    const lowSpace = new MountedKindles({ roots: [root], platform: 'darwin', statfs: async () => ({ bavail: 1, bsize: 1 }) });
    const [device] = await lowSpace.devices();
    await assert.rejects(() => lowSpace.copy(device, book, 'book.pdf'), /out of space/);
    assert.deepEqual(await fs.readdir(documents), []);
    const unavailableStats = new MountedKindles({ roots: [root], platform: 'darwin', statfs: async () => { throw new Error('statfs unavailable'); } });
    await unavailableStats.copy(device, book, 'stats-unavailable.pdf');
    assert.equal(await fs.readFile(path.join(documents, 'stats-unavailable.pdf'), 'utf8'), 'PDF bytes');
    const originalUnlink = fs.unlink;
    fs.unlink = async () => { throw new Error('temporary file already removed'); };
    try { await unavailableStats.copy(device, book, 'unlink-fallback.pdf'); }
    finally { fs.unlink = originalUnlink; }
    const transport = new MountedKindles({ roots: [root], platform: 'darwin' });
    await fs.writeFile(path.join(documents, 'book.pdf'), 'existing file');
    await assert.rejects(() => transport.copy(device, book, 'book.pdf'), /EEXIST/);
    assert.equal(await fs.readFile(path.join(documents, 'book.pdf'), 'utf8'), 'existing file');
    await assert.rejects(() => transport.copy(device, { ...book, sha256: digest('wrong') }, 'new.pdf'), /verification failed/);
    const names = await fs.readdir(documents);
    assert.deepEqual(names.filter(name => !name.endsWith('.part')).sort(), ['book.pdf', 'stats-unavailable.pdf', 'unlink-fallback.pdf']);
    assert.equal(names.filter(name => name.endsWith('.part')).length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('mounted Kindle covers platform roots, volume labels, and bounded document walks', async () => {
  assert.deepEqual(defaultRoots('darwin'), ['/Volumes']);
  const username = os.userInfo().username;
  assert.deepEqual(defaultRoots('linux'), [`/media/${username}`, `/run/media/${username}`, '/media', '/mnt']);
  assert.deepEqual(defaultRoots('win32'), Array.from({ length: 23 }, (_, index) => `${String.fromCharCode(68 + index)}:\\`));
  assert.deepEqual(defaultRoots('freebsd'), []);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-walk-'));
  const documents = path.join(root, 'Kindle', 'documents');
  await fs.mkdir(documents, { recursive: true });
  await fs.writeFile(path.join(documents, 'book.PDF'), 'four');
  await fs.writeFile(path.join(documents, 'ignored.epub'), 'four');
  await fs.mkdir(path.join(documents, 'nested'));
  await fs.writeFile(path.join(documents, 'nested', 'note.txt'), 'four');
  await fs.symlink(path.join(documents, 'book.PDF'), path.join(documents, 'linked.pdf'));
  let deepest = documents;
  for (let index = 0; index < 9; index += 1) {
    deepest = path.join(deepest, `level-${index}`);
    await fs.mkdir(deepest);
  }
  await fs.writeFile(path.join(deepest, 'too-deep.pdf'), 'four');
  try {
    const mounted = new MountedKindles({ roots: [root, path.join(root, 'missing')], platform: 'darwin' });
    const [device] = await mounted.devices();
    assert.equal((await mounted.files(device, new Set([4]))).map(file => file.name).sort().join(','), 'book.PDF,note.txt');

    const childProcess = require('node:child_process');
    const util = require('node:util');
    const originalExecFile = childProcess.execFile;
    const originalCustom = Object.getOwnPropertyDescriptor(originalExecFile, util.promisify.custom);
    const labels = ['Kindle Scribe', 'USB drive', 'failed'];
    const stubExecFile = (...args) => {
      const label = labels.shift();
      if (label === 'failed') throw Object.assign(new Error('failed'), { code: 'EIO' });
      return { stdout: label, stderr: '' };
    };
    stubExecFile[util.promisify.custom] = async (...args) => stubExecFile(...args);
    childProcess.execFile = stubExecFile;
    try {
      const windows = new MountedKindles({ roots: ['D:\\'], platform: 'win32' });
      assert.equal(await windows.isWindowsKindleVolume('D:\\'), true);
      assert.equal(await windows.isWindowsKindleVolume('D:\\'), false);
      assert.equal(await windows.isWindowsKindleVolume('D:\\'), false);
      assert.deepEqual(await windows.devices(), []);
    } finally {
      childProcess.execFile = originalExecFile;
      if (originalCustom) Object.defineProperty(originalExecFile, util.promisify.custom, originalCustom);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('comic transfer conversion and transfer copy failures are reported', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-comic-'));
  const source = path.join(root, 'comic.cbz');
  const converted = path.join(root, 'comic.pdf');
  await fs.writeFile(source, 'comic archive');
  await fs.writeFile(converted, 'converted PDF');
  const job = { bookId: 'comic', title: 'Comic.cbz', extension: 'epub', status: 'ready', sha256: digest('comic archive') };
  const store = { downloads: () => [job] };
  const transport = { devices: async () => [{ id: 'device', name: 'Kindle', kind: 'test' }],
    files: async () => [], hash: async () => '',
    copy: async () => { throw new Error('copy rejected'); } };
  try {
    const missingConverter = new KindleSync({ store, resolveFile: async () => ({ filePath: source }), transports: [transport] });
    assert.match((await missingConverter.localBooks()).skipped[0].reason, /Comic PDF conversion is unavailable/);
    await assert.rejects(() => missingConverter.localBooks('comic'), /Comic PDF conversion is unavailable/);

    const conversionProgress = [];
    const sync = new KindleSync({ store, resolveFile: async () => ({ filePath: source }), transports: [transport],
      comicConverter: { convert: async (_filePath, _sha256, onProgress) => {
        onProgress({ percent: 50 });
        return { path: converted, sha256: digest('converted PDF'), size: 13 };
      } },
      onProgress: progress => conversionProgress.push(progress) });
    const local = await sync.localBooks();
    assert.equal(local.books[0].extension, 'pdf');
    assert.equal(local.books[0].path, converted);
    assert.deepEqual(conversionProgress, [
      { phase: 'converting', bookId: 'comic', title: 'Comic.cbz' },
      { percent: 50, phase: 'converting', bookId: 'comic', title: 'Comic.cbz' },
    ]);
    const transfer = await sync.transfer('device');
    assert.deepEqual(transfer.errors, [{ bookId: 'comic', title: 'Comic.cbz', error: 'copy rejected' }]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('comic conversion checksum failures are skipped for all books and rejected for a selected book', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-checksum-'));
  const source = path.join(root, 'comic.cbr');
  await fs.writeFile(source, 'comic archive');
  const store = { downloads: () => [{ bookId: 'comic', title: 'Comic.cbr', extension: 'cbr', status: 'ready', sha256: digest('different') }] };
  const sync = new KindleSync({ store, resolveFile: async () => ({ filePath: source }), transports: [],
    comicConverter: { convert: async () => assert.fail('converter must not receive a mismatched archive') } });
  try {
    assert.match((await sync.localBooks()).skipped[0].reason, /checksum mismatch/);
    await assert.rejects(() => sync.localBooks('comic'), /checksum mismatch/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('selected Kindle book IDs are validated and transfer uses one session lease', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-selection-'));
  const source = path.join(root, 'book.pdf');
  await fs.writeFile(source, 'selected PDF');
  const store = { downloads: () => [
    { bookId: 'keep', title: 'Keep', extension: 'pdf', status: 'ready', sha256: digest('selected PDF') },
    { bookId: 'skip', title: 'Skip', extension: 'pdf', status: 'ready', sha256: digest('selected PDF') },
  ] };
  let sessionDepth = 0;
  let maxDepth = 0;
  const transport = {
    devices: async () => [{ id: 'device', name: 'Kindle', kind: 'test' }],
    files: async () => [],
    hash: async () => '',
    copied: [],
    async withSession(_device, operation) {
      sessionDepth += 1;
      maxDepth = Math.max(maxDepth, sessionDepth);
      try { return await operation(); } finally { sessionDepth -= 1; }
    },
    ensureSpace(bytes) { this.requiredSpace = bytes; },
    async copy(_device, book) { this.copied.push(book.bookId); },
  };
  try {
    const sync = new KindleSync({ store, resolveFile: async () => ({ filePath: source }), transports: [transport] });
    await assert.rejects(() => sync.localBooks(['']), /Invalid Kindle book selection/);
    await assert.rejects(() => sync.localBooks(['missing']), /Downloaded book was not found/);
    const result = await sync.transfer('device', ['keep']);
    assert.deepEqual(result.transferred, ['keep']);
    assert.deepEqual(transport.copied, ['keep']);
    assert.equal(transport.requiredSpace, Buffer.byteLength('selected PDF'));
    assert.equal(maxDepth, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Kindle operations serialize and normalize non-Error copy failures', async () => {
  const sync = new KindleSync({ store: { downloads: () => [] }, resolveFile: async () => ({}), transports: [] });
  let active = 0;
  let maximum = 0;
  let order = [];
  const first = sync.serialize(async () => {
    active++;
    maximum = Math.max(maximum, active);
    order.push('first-start');
    await new Promise(resolve => setImmediate(resolve));
    order.push('first-end');
    active--;
  });
  const second = sync.serialize(async () => {
    active++;
    maximum = Math.max(maximum, active);
    order.push('second');
    active--;
  });
  await Promise.all([first, second]);
  assert.equal(maximum, 1);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);

  const store = { downloads: () => [{ bookId: 'pdf', title: 'PDF', extension: 'pdf', status: 'ready' }] };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-copy-error-'));
  const source = path.join(root, 'book.pdf');
  await fs.writeFile(source, 'book');
  const transport = { devices: async () => [{ id: 'device', name: 'Kindle', kind: 'test' }], files: async () => [], hash: async () => '',
    copy: async () => { throw {}; } };
  try {
    const syncWithCopyError = new KindleSync({ store, resolveFile: async () => ({ filePath: source }), transports: [transport] });
    const result = await syncWithCopyError.transfer('device');
    assert.deepEqual(result.errors, [{ bookId: 'pdf', title: 'PDF', error: '[object Object]' }]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Kindle sync shutdown closes every transport and rejects later actions', async () => {
  let closed = 0;
  const sync = new KindleSync({ store: { downloads: () => [] }, resolveFile: async () => ({}),
    transports: [{ close: async () => { closed++; } }, { close: async () => { closed++; } }] });
  await sync.close();
  assert.equal(closed, 2);
  await assert.rejects(() => sync.preview('device'), /sync is closed/);
  const main = await fs.readFile(path.join(__dirname, '../../main.js'), 'utf8');
  const shutdown = main.split("app.on('before-quit'")[1]?.split("app.on('will-quit'")[0];
  assert.ok(shutdown, 'app quit handler is present');
  assert.match(shutdown, /event\.preventDefault\(\)/);
  assert.match(shutdown, /kindleSync\.close\(\)/);
  assert.match(shutdown, /app\.quit\(\)/);
});

test('Windows MTP copies through a temporary staged file and removes the staging directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-mtp-win-'));
  const helper = path.join(root, 'kindle-wpd.ps1');
  const source = path.join(root, 'source.pdf');
  const stagingRoot = path.join(root, 'staging');
  await fs.writeFile(helper, 'fixture');
  await fs.writeFile(source, 'new PDF');
  let stagedPath;
  let remote = Buffer.from('new PDF');
  const runner = async (_executable, args) => {
    const action = args[6];
    if (action === 'put') { stagedPath = args[8]; assert.equal(await fs.readFile(stagedPath, 'utf8'), 'new PDF'); return { stdout: '{"id":"18"}' }; }
    if (action === 'get') { await fs.writeFile(args[9], remote); return { stdout: '{"ok":true}' }; }
    throw new Error(`unexpected action ${action}`);
  };
  try {
    const transport = new MtpKindles({ platform: 'win32', resourcesPath: root, stagingRoot, runner });
    const device = { helperId: '1-2' };
    await transport.copy(device, { path: source, sha256: digest('new PDF') }, 'new.pdf');
    await assert.rejects(() => fs.stat(stagedPath), { code: 'ENOENT' });
    remote = Buffer.from('wrong bytes');
    await assert.rejects(() => transport.copy(device, { path: source, sha256: digest('new PDF') }, 'bad.pdf'), /verification failed/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
