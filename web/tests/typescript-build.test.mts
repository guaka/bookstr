import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { BrowserBuildApi } from '../scripts/typescript.cts';
import type { BrowserVendorApi } from '../scripts/vendor.cts';

const require = createRequire(import.meta.url);
const build = require('../scripts/typescript.cts') as BrowserBuildApi;
const vendor = require('../scripts/vendor.cts') as BrowserVendorApi;
const root = fileURLToPath(new URL('..', import.meta.url));

function directory(t: TestContext): string {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-web-build-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  return temporary;
}

test('classic output exposes only its browser API and retains CommonJS behavior', () => {
  assert.equal(build.formatError(new Error('compiler failed')), 'compiler failed');
  assert.equal(build.formatError('foreign failure'), 'foreign failure');
  const output = build.servedSource('fixture', 'const privateValue = 4; globalThis.fixture = privateValue;\nexport {};\n', true);
  const context = vm.createContext({});
  vm.runInContext(output, context);
  assert.equal(context.fixture, 4);
  assert.equal(vm.runInContext('typeof privateValue', context), 'undefined');
  assert.doesNotMatch(output, /^export\s/m);
  const commonjs = { module: { exports: {} } };
  vm.runInNewContext(build.servedSource('fixture', 'module.exports = { value: 7 };', true), commonjs);
  assert.equal((commonjs.module.exports as { value: number }).value, 7);
  assert.throws(() => build.servedSource('bad', 'export const value = 1;', true), /module statement/);
  assert.throws(() => build.servedSource('bad', 'import value from "other";', true), /module statement/);
  assert.match(build.servedSource('module', 'export const value = 1;\n', false), /export const/);
});

test('page generation preserves script mode and replaces literal dollar sequences safely', () => {
  const template = '<html><script type="module">/* @bookstr-typescript:page */</script></html>';
  const javascript = 'const text = "$&";';
  assert.equal(build.pageSource(template, 'page', javascript), `<html><script type="module">${javascript}</script></html>`);
  assert.throws(() => build.pageSource('<html/>', 'page', javascript), /one TypeScript marker/);
  assert.throws(() => build.pageSource(template + template, 'page', javascript), /one TypeScript marker/);
  assert.throws(() => build.pageSource(template, 'page', 'const html = "</SCRIPT>";'), /closing tag/);
  const context = vm.createContext({});
  vm.runInContext(build.servedSource('page', 'var publicPageFunction = () => 4;', true, false), context);
  assert.equal(typeof context.publicPageFunction, 'function');
});

test('generated-file checking reports drift without modifying served files', t => {
  const temporary = directory(t);
  const outputs = new Map([['nested/app.js', 'first']]);
  assert.throws(() => build.writeOutputs(outputs, temporary, true), /stale/);
  assert.equal(fs.existsSync(path.join(temporary, 'nested/app.js')), false);
  build.writeOutputs(outputs, temporary, false);
  build.writeOutputs(outputs, temporary, true);
  fs.writeFileSync(path.join(temporary, 'nested/app.js'), 'changed');
  assert.throws(() => build.writeOutputs(outputs, temporary, true), /stale/);
  assert.equal(fs.readFileSync(path.join(temporary, 'nested/app.js'), 'utf8'), 'changed');
  build.writeOutputs(outputs, temporary, false);
  assert.equal(fs.readFileSync(path.join(temporary, 'nested/app.js'), 'utf8'), 'first');
});

test('site output contains static assets and reports while excluding development dependencies', t => {
  const temporary = directory(t);
  for (const name of ['index.html', 'vendor/reader.wasm', 'docs/README.md', 'tests/index.html', 'tests/source.test.mjs', 'src/app.ts', 'templates/index.html', 'scripts/build.cts', 'types/window.d.ts', 'node_modules/tool/index.js', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'build-manifest.json', 'playwright.config.mts', 'webtorrent-dev-bridge.mts', 'tsconfig.json', 'tsconfig.tools.json', 'tsconfig.dev.json', '.hidden']) {
    fs.mkdirSync(path.dirname(path.join(temporary, name)), { recursive: true });
    fs.writeFileSync(path.join(temporary, name), name);
  }
  fs.symlinkSync(path.join(temporary, 'src'), path.join(temporary, 'linked-source'));
  build.stageSite(temporary);
  const files = fs.readdirSync(path.join(temporary, 'site-dist'), { recursive: true }).filter(name => fs.statSync(path.join(temporary, 'site-dist', String(name))).isFile()).sort();
  assert.deepEqual(files, ['docs/README.md', 'index.html', 'tests/index.html', 'vendor/reader.wasm']);
  fs.rmSync(path.join(temporary, 'tests/index.html'));
  build.stageSite(temporary);
  assert.equal(fs.existsSync(path.join(temporary, 'site-dist/tests/index.html')), false);
});

test('the real compiler builds and checks isolated classic, module, and inline page sources', { timeout: 30000 }, t => {
  const temporary = directory(t);
  fs.mkdirSync(path.join(temporary, 'scripts'));
  fs.mkdirSync(path.join(temporary, 'src'));
  fs.mkdirSync(path.join(temporary, 'templates'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'));
  fs.copyFileSync(path.join(root, 'scripts/typescript.cts'), path.join(temporary, 'scripts/typescript.cts'));
  fs.copyFileSync(path.join(root, 'tsconfig.tools.json'), path.join(temporary, 'tsconfig.tools.json'));
  fs.copyFileSync(path.join(root, 'tsconfig.tests.json'), path.join(temporary, 'tsconfig.tests.json'));
  fs.writeFileSync(path.join(temporary, 'tsconfig.dev.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022' }, include: ['dev.ts'] }));
  fs.writeFileSync(path.join(temporary, 'dev.ts'), 'export const developmentFixture: string = "typed";');
  fs.writeFileSync(path.join(temporary, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleDetection: 'force', rootDir: 'src', noEmitOnError: true, skipLibCheck: true }, include: ['src/*.ts'] }));
  const manifest = { classic: ['fixture'], modules: ['module'], pages: [{ source: 'page', template: 'page.html', output: 'index.html', mode: 'classic' }] };
  const writeManifest = () => fs.writeFileSync(path.join(temporary, 'build-manifest.json'), JSON.stringify(manifest));
  writeManifest();
  fs.writeFileSync(path.join(temporary, 'src/fixture.ts'), '(globalThis as unknown as { fixture: number }).fixture = 7;');
  fs.writeFileSync(path.join(temporary, 'src/module.ts'), 'export const value: number = 5;');
  fs.writeFileSync(path.join(temporary, 'src/page.ts'), 'document.body.dataset.ready = "yes";');
  fs.writeFileSync(path.join(temporary, 'templates/page.html'), '<script>/* @bookstr-typescript:page */</script>');
  for (const args of [['--noEmit'], [], ['--check'], ['--site']]) {
    build.main(args, temporary);
  }
  assert.match(fs.readFileSync(path.join(temporary, 'fixture.js'), 'utf8'), /fixture = 7/);
  assert.match(fs.readFileSync(path.join(temporary, 'module.js'), 'utf8'), /export const value/);
  assert.match(fs.readFileSync(path.join(temporary, 'index.html'), 'utf8'), /dataset.ready = "yes"/);
  fs.writeFileSync(path.join(temporary, 'fixture.js'), 'stale');
  assert.throws(() => build.main(['--check'], temporary), /stale/);
  assert.throws(() => build.main(['--unknown'], temporary), /Expected/);
  const cliError = spawnSync(process.execPath, [path.join(root, 'scripts/typescript.cts'), '--unknown'], { encoding: 'utf8' });
  assert.notEqual(cliError.status, 0);
  assert.match(cliError.stderr, /Expected/);
  fs.writeFileSync(path.join(temporary, 'src/fixture.ts'), 'const value: string = 3;');
  assert.throws(() => build.main([], temporary), /compilation failed/);
  assert.equal(fs.readFileSync(path.join(temporary, 'fixture.js'), 'utf8'), 'stale');
  fs.writeFileSync(path.join(temporary, 'src/fixture.ts'), '(globalThis as unknown as { fixture: number }).fixture = 7;');
  manifest.classic.push('fixture');
  writeManifest();
  assert.throws(() => build.main([], temporary), /Invalid browser script manifest/);
  manifest.classic = ['../outside'];
  writeManifest();
  assert.throws(() => build.main([], temporary), /Invalid browser script manifest/);
  manifest.classic = [];
  writeManifest();
  assert.throws(() => build.main([], temporary), /does not match/);
  manifest.classic = ['fixture'];
  manifest.pages[0]!.output = '../../outside.html';
  writeManifest();
  assert.throws(() => build.main([], temporary), /Invalid page output/);
  manifest.pages[0]!.output = 'index.js';
  writeManifest();
  assert.throws(() => build.main([], temporary), /Invalid page output/);
  const executable = process.execPath;
  try {
    process.execPath = path.join(temporary, 'missing-node');
    assert.throws(() => build.main(['--noEmit'], temporary), /ENOENT/);
  } finally { process.execPath = executable; }
});

test('vendor outputs are reproducible and reject an unpinned installed package', t => {
  const first = vendor.vendorOutputs();
  const second = vendor.vendorOutputs();
  assert.deepEqual(first, second);
  for (const [source, output] of [
    ['node_modules/jszip/dist/jszip.min.js', 'jszip.min.js'],
    ['node_modules/sql.js/dist/sql-wasm.js', 'vendor/sql-wasm.js'],
    ['node_modules/sql.js/dist/sql-wasm.wasm', 'vendor/sql-wasm.wasm'],
  ] as const) assert.deepEqual(Buffer.from(first.get(output)!), fs.readFileSync(path.join(root, source)));
  assert.deepEqual(first.get('jszip.min.js'), first.get('../shared/reader/jszip.min.js'));
  assert.deepEqual(first.get('epub.min.js'), first.get('../shared/reader/epub.min.js'));
  assert.ok(first.get('vendor/nostr-tools.js')!.length > 1000);
  const sourceMap = JSON.parse(Buffer.from(first.get('vendor/nostr-tools.js.map')!).toString()) as { sources: string[]; sourcesContent: string[] };
  assert.ok(sourceMap.sources.every(source => source.includes('node_modules/') && !path.isAbsolute(source)));
  assert.equal(sourceMap.sources.length, sourceMap.sourcesContent.length);
  assert.doesNotMatch(Buffer.from(first.get('vendor/licenses/epubjs.txt')!).toString(), /[ \t]+$/m);
  const temporary = directory(t);
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'));
  fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ devDependencies: { jszip: '0.0.0' } }));
  assert.throws(() => vendor.vendorOutputs(temporary), /pinned version/);
  assert.throws(() => vendor.main(['--unknown']), /Expected/);
  vendor.main(['--check']);
});

test('vendor sync restores a matching JavaScript and WASM pair and detects drift', t => {
  const parent = directory(t);
  const temporary = path.join(parent, 'web');
  fs.mkdirSync(temporary);
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'));
  fs.copyFileSync(path.join(root, 'package.json'), path.join(temporary, 'package.json'));
  assert.throws(() => vendor.main(['--check'], temporary), /stale/);
  vendor.main([], temporary);
  vendor.main(['--check'], temporary);
  const wasm = path.join(temporary, 'vendor/sql-wasm.wasm');
  fs.writeFileSync(wasm, 'incorrect wasm');
  assert.throws(() => vendor.main(['--check'], temporary), /sql-wasm.wasm/);
  assert.equal(fs.readFileSync(wasm, 'utf8'), 'incorrect wasm');
  vendor.main([], temporary);
  assert.deepEqual(fs.readFileSync(wasm), fs.readFileSync(path.join(root, 'vendor/sql-wasm.wasm')));
  const cliError = spawnSync(process.execPath, [path.join(root, 'scripts/vendor.cts'), '--unknown'], { encoding: 'utf8' });
  assert.notEqual(cliError.status, 0);
  assert.match(cliError.stderr, /Expected/);
});

test('CI verifies generated assets and Pages publishes the clean static output', () => {
  const ci = fs.readFileSync(path.join(root, '../.github/workflows/ci.yml'), 'utf8');
  const pages = fs.readFileSync(path.join(root, '../.github/workflows/deploy-web.yml'), 'utf8');
  for (const workflow of [ci, pages]) {
    assert.match(workflow, /pnpm --dir web install --frozen-lockfile --ignore-scripts/);
    assert.match(workflow, /pnpm --dir web run check:generated/);
    assert.match(workflow, /pnpm --dir web run check:vendor/);
  }
  assert.match(ci, /pnpm --dir web run typecheck/);
  assert.match(ci, /web\/tests\/\*\.test\.mts/);
  assert.match(ci, /playwright\/test\/cli\.js test --config web\/playwright\.config\.mts --workers=1/);
  assert.match(pages, /pnpm --dir web run build:site/);
  assert.match(pages, /path: web\/site-dist/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build-manifest.json'), 'utf8')) as { classic: string[]; modules: string[]; pages: Array<{ output: string }> };
  const attributes = fs.readFileSync(path.join(root, '../.gitattributes'), 'utf8');
  for (const name of [...manifest.classic, ...manifest.modules]) {
    assert.ok(fs.existsSync(path.join(root, 'src', `${name}.ts`)), name);
    assert.ok(attributes.includes(`web/${name}.js linguist-generated=true`), name);
  }
  for (const page of manifest.pages) {
    const output = path.relative(path.dirname(root), path.resolve(root, page.output)).split(path.sep).join('/');
    assert.ok(attributes.includes(`${output} linguist-generated=true`), output);
  }
});

test('migrated browser suites use strict checking and source-derived global API types', () => {
  const tests = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.tests.json'), 'utf8')) as { extends: string; include: string[] };
  const tools = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.tools.json'), 'utf8')) as { compilerOptions: { strict: boolean; noUncheckedIndexedAccess: boolean } };
  assert.equal(tests.extends, './tsconfig.tools.json');
  assert.ok(tests.include.includes('tests/*.mts'));
  assert.ok(tests.include.includes('tests/*.d.ts'));
  assert.equal(tools.compilerOptions.strict, true);
  assert.equal(tools.compilerOptions.noUncheckedIndexedAccess, true);
  assert.match(fs.readFileSync(path.join(root, 'tests/book-metadata-api.mts'), 'utf8'), /import type \{ BookMetadataApi \} from '\.\.\/src\/book-metadata\.js'/);
});
