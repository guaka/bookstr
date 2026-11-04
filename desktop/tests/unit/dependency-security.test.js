const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

test('locked dependency graph contains only patched minimatch and no ip package', () => {
  const lock = fs.readFileSync(path.resolve(__dirname, '../../pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(lock, /^  ip@/m);
  const versions = [...lock.matchAll(/^  minimatch@([^:]+):/gm)].map(match => match[1]);
  assert.ok(versions.length);
  assert.ok(versions.every(version => version === '11.0.4'));
});

test('UDP tracker decodes explicit IPv4 bytes and defaults to the sender address', async () => {
  const root = path.resolve(__dirname, '../../node_modules/bittorrent-tracker');
  const { default: parse } = await import(pathToFileURL(path.join(root, 'lib/server/parse-udp.js')));
  const packet = Buffer.alloc(98);
  Buffer.from('0000041727101980', 'hex').copy(packet);
  packet.writeUInt32BE(1, 8);
  packet.writeUInt16BE(6881, 96);
  const sender = { address: '192.0.2.4', port: 7000 };
  assert.equal(parse(packet, sender).ip, sender.address);
  Buffer.from([203, 0, 113, 255]).copy(packet, 84);
  assert.equal(parse(packet, sender).ip, '203.0.113.255');
  packet.writeUInt16BE(0, 96);
  assert.equal(parse(packet, sender).port, sender.port);
});

test('legacy glob, filelist, directory filters and asar unpacking use modern minimatch', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-secure-deps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'native'), { recursive: true });
  fs.writeFileSync(path.join(source, 'native', 'binding.node'), 'fixture');
  fs.writeFileSync(path.join(source, '.hidden'), 'hidden');
  assert.equal(require('glob').sync('**/*.node', { cwd: source }).length, 1);
  assert.deepEqual(await new Promise((resolve, reject) => require('glob')('**/*.node', { cwd: source },
    (error, matches) => error ? reject(error) : resolve(matches))), ['native/binding.node']);
  // glob disables negation by default; exercise its retained negated matcher path too.
  const syncGlob = new (require('glob').GlobSync)('*.node', { cwd: source, noprocess: true });
  syncGlob.minimatch.negate = true;
  syncGlob.matches = [];
  syncGlob._process(syncGlob.minimatch.set[0], 0, false);
  assert.deepEqual(Object.keys(syncGlob.matches[0]), ['native']);
  const asyncGlob = new (require('glob').Glob)('*.node', { cwd: source, noprocess: true });
  asyncGlob.minimatch.negate = true;
  asyncGlob.matches = [];
  await new Promise((resolve, reject) => asyncGlob._process(asyncGlob.minimatch.set[0], 0, false,
    error => error ? reject(error) : resolve()));
  assert.deepEqual(Object.keys(asyncGlob.matches[0]), ['native']);
  const { FileList } = require('filelist');
  const files = new FileList(path.join(source, '**/*'));
  assert.ok(files.toArray().some(file => file.endsWith('.node')));
  files.exclude(/\.node$/);
  assert.ok(!files.toArray().some(file => file.endsWith('.node')));
  const comparison = require('dir-compare').compareSync(source, source, { includeFilter: '*.node' });
  assert.equal(comparison.equalFiles, 1);
  const asar = require('@electron/asar');
  const archive = path.join(root, 'fixture.asar');
  await asar.createPackageWithOptions(source, archive, { unpack: '*.node', unpackDir: '**/native' });
  assert.equal(asar.statFile(archive, 'native/binding.node').unpacked, true);
  assert.equal(asar.extractFile(archive, '.hidden').toString(), 'hidden');
});
