const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
const vm: typeof import('node:vm') = require('node:vm');
const { stripTypeScriptTypes }: typeof import('node:module') = require('node:module');

const root = path.resolve(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'scripts/typescript.cts'), 'utf8');

interface CompileResult {
  error?: Error;
  status?: number | null;
}
interface CompilerOptions {
  stdio: string;
  env: Record<string, string | undefined>;
}
type CompilerCall = [string, string[], CompilerOptions];
function compile(args: string[], result: CompileResult): { calls: CompilerCall[]; exitCode: number | undefined } {
  const calls: CompilerCall[] = [];
  const context = {
    __dirname: path.join(root, 'scripts'),
    process: { argv: ['node', 'typescript.cts', ...args], execPath: '/node', env: { KEEP: 'value' }, exitCode: undefined as number | undefined },
    require(name: string) {
      if (name === 'node:path') return path;
      assert.equal(name, 'node:child_process');
      return { spawnSync(executable: string, args: string[], options: CompilerOptions) { calls.push([executable, args, options]); return result; } };
    },
  };
  vm.runInNewContext(stripTypeScriptTypes(script), context as import('node:vm').Context, { filename: path.join(root, 'scripts/typescript.cts') });
  return { calls, exitCode: context.process.exitCode };
}

test('TypeScript compiler preserves runtime paths and bounds native compiler memory', () => {
  const { calls, exitCode } = compile([], { status: 0 });
  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  const [executable, args, options] = calls[0]!;
  assert.equal(executable, '/node');
  assert.deepEqual(Array.from(args), [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.json')]);
  assert.equal(options.stdio, 'inherit');
  assert.deepEqual({ ...options.env }, { KEEP: 'value', GOMEMLIMIT: '512MiB', GOMAXPROCS: '2' });
});

test('TypeScript compiler forwards configuration, flags and failures', () => {
  const { calls, exitCode } = compile(['tsconfig.type-tests.json', '--noEmit'], { status: 2 });
  assert.equal(exitCode, 2);
  assert.deepEqual(Array.from(calls[0]![1]).slice(2), [path.join(root, 'tsconfig.type-tests.json'), '--noEmit']);
  assert.equal(compile([], { status: null }).exitCode, 1);
  const error = new Error('compiler unavailable');
  assert.throws(() => compile([], { error }), error);
});

test('TypeScript uses strict checks and emits beside existing Electron modules', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'));
  for (const key of ['strict', 'noUncheckedIndexedAccess', 'noUnusedLocals', 'noUnusedParameters', 'noEmitOnError', 'sourceMap', 'inlineSources']) {
    assert.equal(config.compilerOptions[key], true, key);
  }
  assert.ok(config.compilerOptions.lib.includes('DOM.AsyncIterable'));
  assert.equal(config.compilerOptions.rootDir, 'src');
  assert.equal(config.compilerOptions.outDir, '.');
  assert.ok(config.exclude.includes('node_modules'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as import('../types/package-manifest').DesktopPackageManifest;
  assert.match(manifest.scripts.typecheck!, /tsconfig.type-tests.json --noEmit$/);
  for (const name of ['prestart', 'prepack', 'predist', 'pretest:unit', 'pretest:coverage', 'pretest:e2e']) {
    assert.match(manifest.scripts[name]!, /pnpm run build:typescript/);
  }
  const ignored = fs.readFileSync(path.join(root, '../.gitignore'), 'utf8');
  const bundled = manifest.build.files.find((entry): entry is import('../types/package-manifest').BundledDirectory => typeof entry !== 'string' && entry.to === 'desktop')!.filter;
  for (const name of ['bounded-response', 'desktop-state', 'ipc-authorization', 'preload', 'catalog-invitations', 'security-policy', 'dictionary-proxy', 'main', 'catalog-proxy', 'speech-model-store', 'webtorrent-bridge', 'library-store', 'library-import', 'library-cover', 'acquisition-manager', 'download-queue', 'library-downloads', 'kindle-sync', 'kindle-mtp', 'mtp-session', 'comic-pdf', 'comic-image', 'device-pairing']) {
    assert.ok(ignored.includes(`/desktop/${name}.js`));
    assert.ok(bundled.includes(`${name}.js`));
    assert.ok(fs.existsSync(path.join(root, 'src', `${name}.ts`)));
  }
  assert.ok(bundled.includes('*.js.map'));
  const webFiles = manifest.build.files.find((entry): entry is import('../types/package-manifest').BundledDirectory => typeof entry !== 'string' && entry.to === 'web')!.filter;
  assert.ok(webFiles.includes('**/*'));
  for (const directory of ['tests', 'node_modules', 'src', 'templates', 'scripts', 'types', 'site-dist', 'coverage']) {
    assert.ok(webFiles.includes(`!${directory}/**/*`), directory);
  }
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig*.json', 'build-manifest.json']) {
    assert.ok(webFiles.includes(`!${file}`), file);
  }
});

test('all packaged Electron modules and build helpers have TypeScript sources', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as import('../types/package-manifest').DesktopPackageManifest;
  const bundled = manifest.build.files.find((entry): entry is import('../types/package-manifest').BundledDirectory => typeof entry !== 'string' && entry.to === 'desktop')!.filter;
  for (const file of bundled.filter((entry: string) => /^[a-z-]+\.js$/.test(entry))) {
    assert.ok(fs.existsSync(path.join(root, 'src', file.replace(/\.js$/, '.ts'))), file);
  }
  const ignored = fs.readFileSync(path.join(root, '../.gitignore'), 'utf8');
  for (const file of ['stamp-build', 'playwright.config', 'native/build-kindle-mtp']) {
    assert.ok(fs.existsSync(path.join(root, 'src', `${file}.ts`)), file);
    assert.ok(ignored.includes(`/desktop/${file}.js`), file);
  }
});


test('strict checks include native TypeScript launchers and converted tests', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.type-tests.json'), 'utf8'));
  for (const pattern of ['scripts/**/*.cts', 'tests/unit/*.test.ts', 'tests/e2e/**/*.ts', 'tests/packaged/*.cts']) {
    assert.ok(config.include.includes(pattern), pattern);
  }
  const testFiles = fs.readdirSync(path.join(root, 'tests'), {recursive:true});
  assert.deepEqual(testFiles.filter(file => /\.(?:js|cjs)$/.test(String(file))), []);
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(config.compilerOptions.moduleDetection, 'force');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of ['build:typescript', 'typecheck']) {
    assert.match(manifest.scripts[name], /scripts\/typescript\.cts /);
  }
  for (const name of ['test:unit', 'test:coverage']) {
    assert.match(manifest.scripts[name], /tests\/unit\/\*\.test\.ts/);
    assert.doesNotMatch(manifest.scripts[name], /tests\/unit\/\*\.test\.js/);
  }
});
