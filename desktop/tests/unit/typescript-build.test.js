const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'scripts/typescript.cjs'), 'utf8');

function compile(args, result) {
  const calls = [];
  const context = {
    __dirname: path.join(root, 'scripts'),
    process: { argv: ['node', 'typescript.cjs', ...args], execPath: '/node', env: { KEEP: 'value' } },
    require(name) {
      if (name === 'node:path') return path;
      assert.equal(name, 'node:child_process');
      return { spawnSync(...parameters) { calls.push(parameters); return result; } };
    },
  };
  vm.runInNewContext(script, context, { filename: 'typescript.cjs' });
  return { calls, exitCode: context.process.exitCode };
}

test('TypeScript compiler preserves runtime paths and bounds native compiler memory', () => {
  const { calls, exitCode } = compile([], { status: 0 });
  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  const [executable, args, options] = calls[0];
  assert.equal(executable, '/node');
  assert.deepEqual(Array.from(args), [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.json')]);
  assert.equal(options.stdio, 'inherit');
  assert.deepEqual({ ...options.env }, { KEEP: 'value', GOMEMLIMIT: '512MiB', GOMAXPROCS: '2' });
});

test('TypeScript compiler forwards configuration, flags and failures', () => {
  const { calls, exitCode } = compile(['tsconfig.type-tests.json', '--noEmit'], { status: 2 });
  assert.equal(exitCode, 2);
  assert.deepEqual(Array.from(calls[0][1]).slice(2), [path.join(root, 'tsconfig.type-tests.json'), '--noEmit']);
  assert.equal(compile([], { status: null }).exitCode, 1);
  const error = new Error('compiler unavailable');
  assert.throws(() => compile([], { error }), error);
});

test('TypeScript uses strict checks and emits beside existing Electron modules', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'));
  for (const key of ['strict', 'noUncheckedIndexedAccess', 'noUnusedLocals', 'noUnusedParameters', 'noEmitOnError', 'sourceMap', 'inlineSources']) {
    assert.equal(config.compilerOptions[key], true, key);
  }
  assert.equal(config.compilerOptions.rootDir, 'src');
  assert.equal(config.compilerOptions.outDir, '.');
  assert.ok(config.exclude.includes('node_modules'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(manifest.scripts.typecheck, /tsconfig.type-tests.json --noEmit$/);
  for (const name of ['prestart', 'prepack', 'predist', 'pretest:unit', 'pretest:coverage', 'pretest:e2e']) {
    assert.match(manifest.scripts[name], /pnpm run build:typescript/);
  }
  const ignored = fs.readFileSync(path.join(root, '../.gitignore'), 'utf8');
  const bundled = manifest.build.files.find(entry => entry.to === 'desktop').filter;
  for (const name of ['preload', 'catalog-invitations', 'security-policy', 'dictionary-proxy']) {
    assert.ok(ignored.includes(`/desktop/${name}.js`));
    assert.ok(bundled.includes(`${name}.js`));
    assert.ok(fs.existsSync(path.join(root, 'src', `${name}.ts`)));
  }
  assert.ok(bundled.includes('*.js.map'));
});
