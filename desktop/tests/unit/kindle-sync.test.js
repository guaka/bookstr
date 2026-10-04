'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LibraryStore } = require('../../library-store');
const { KindleSync, MountedKindles, safeFilename } = require('../../kindle-sync');
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

test('MTP transport uses its packaged helper and verifies copied bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-mtp-'));
  const helper = path.join(root, 'kindle-mtp');
  await fs.writeFile(helper, 'fixture');
  const remote = new Map([['17', Buffer.from('remote PDF')]]);
  const calls = [];
  const runner = async (_executable, args) => {
    calls.push(args);
    if (args[0] === 'devices') return { stdout: '[{"id":"1-2","name":"Kindle Scribe"}]' };
    if (args[0] === 'files') return { stdout: '[{"id":"17","name":"old.pdf","size":10}]' };
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
  assert.match(body, /device_entry\.vendor_id != 0x1949/);
  assert.doesNotMatch(body, /LIBMTP_Open_Raw_Device_Uncached|LIBMTP_Get_Folder_List|documents_folder/);
  assert.match(source, /Kindle MTP open failed/);
  assert.match(source, /Kindle Documents folder could not be read during preview/);
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
    const transport = new MountedKindles({ roots: [root], platform: 'darwin' });
    await fs.writeFile(path.join(documents, 'book.pdf'), 'existing file');
    await assert.rejects(() => transport.copy(device, book, 'book.pdf'), /EEXIST/);
    assert.equal(await fs.readFile(path.join(documents, 'book.pdf'), 'utf8'), 'existing file');
    await assert.rejects(() => transport.copy(device, { ...book, sha256: digest('wrong') }, 'new.pdf'), /verification failed/);
    assert.deepEqual(await fs.readdir(documents), ['book.pdf']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
