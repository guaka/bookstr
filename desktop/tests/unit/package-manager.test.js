const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const settings = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');

test('desktop pins pnpm and keeps installation and lifecycle hooks reproducible', () => {
  assert.equal(manifest.packageManager, 'pnpm@10.34.8');
  assert.equal(manifest.engines.node, '>=22.12.0');
  assert.ok(fs.existsSync(path.join(root, 'pnpm-lock.yaml')));
  assert.equal(fs.existsSync(path.join(root, 'package-lock.json')), false);
  assert.match(settings, /^nodeLinker: hoisted$/m);
  assert.match(settings, /^enablePrePostScripts: true$/m);
  assert.match(settings, /^childConcurrency: 1$/m);
  assert.match(settings, /^networkConcurrency: 4$/m);
  assert.match(settings, /onlyBuiltDependencies:[\s\S]*- node-datachannel/);
  assert.match(settings, /patchedDependencies:/);
  assert.match(settings, /app-builder-lib@26\.15\.3: patches\/app-builder-lib@26\.15\.3\.patch/);
  const packagerPatch = fs.readFileSync(path.join(root, 'patches/app-builder-lib@26.15.3.patch'), 'utf8');
  assert.match(packagerPatch, /^\+.*this\.cache\.searchForPackage\(parentPath, pkgName, requiredRange, skipDownwardSearch\)/m);
  const patch = fs.readFileSync(path.join(root, 'patches/node-datachannel@0.32.3.patch'), 'utf8');
  assert.match(patch, /^\+.*install.*prebuild-install -r napi/m);
  assert.doesNotMatch(patch, /^\+.*(?:cmake|npm run _prebuild)/m);
  assert.ok(manifest.optionalDependencies['@roamhq/wrtc']);
  assert.equal(manifest.scripts.postinstall, 'node node_modules/electron/install.js');
  for (const command of Object.values(manifest.scripts)) assert.doesNotMatch(command, /\bnpm (?:run|ci|install)\b/);
});

test('desktop package contains every local runtime module required by its main process', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const bundled = manifest.build.files.find(entry => typeof entry === 'object' && entry.to === 'desktop').filter;
  for (const [, name] of main.matchAll(/require\('\.\/([a-z-]+)'\)/g)) {
    assert.ok(bundled.includes(`${name}.js`), `Missing packaged module: ${name}.js`);
  }
});


test('packaging preserves exact nested dependency versions before accepting overrides', async t => {
  const os = require('node:os');
  const { createRequire } = require('node:module');
  const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
  const { PnpmNodeModulesCollector } = builderRequire('app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-package-versions-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const writePackage = (relative, name, version) => {
    const directory = path.join(fixture, relative);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version }));
    return directory;
  };
  writePackage('node_modules/bencode', 'bencode', '4.0.1');
  const nested = writePackage('node_modules/k-rpc-socket/node_modules/bencode', 'bencode', '2.0.3');
  const collector = new PnpmNodeModulesCollector(fixture, {});
  collector.isHoisted = { value: Promise.resolve(true) };
  const missingVirtualPath = path.join(fixture, 'node_modules/.pnpm/bencode@2.0.3/node_modules/bencode');
  const resolved = await collector.locateFromDepOrRoot('bencode', missingVirtualPath, '2.0.3');
  assert.equal(resolved.packageDir, nested);
  assert.equal(resolved.packageJson.version, '2.0.3');
  assert.equal((await collector.locateFromDepOrRoot('bencode', missingVirtualPath, '2.0.3')).packageDir, nested);
  assert.equal((await collector.locateFromDepOrRoot('bencode', missingVirtualPath, '4.0.1')).packageJson.version, '4.0.1');
  assert.equal((await collector.locateFromDepOrRoot('bencode', nested, '2.0.3')).packageJson.version, '2.0.3');
  assert.equal((await collector.locateFromDepOrRoot('bencode', undefined, '2.0.3')).packageDir, nested);
});

test('packaging still accepts an installed override when no exact version exists', async t => {
  const os = require('node:os');
  const { createRequire } = require('node:module');
  const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
  const { PnpmNodeModulesCollector } = builderRequire('app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-package-override-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const installed = path.join(fixture, 'node_modules/bencode');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: 'bencode', version: '4.0.1' }));
  const collector = new PnpmNodeModulesCollector(fixture, {});
  collector.isHoisted = { value: Promise.resolve(true) };
  const result = await collector.locateFromDepOrRoot('bencode', path.join(fixture, 'missing'), '2.0.3');
  assert.equal(result.packageDir, installed);
  assert.equal(result.packageJson.version, '4.0.1');
});
