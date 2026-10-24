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
