const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
const vm: typeof import('node:vm') = require('node:vm');
const { stripTypeScriptTypes }: typeof import('node:module') = require('node:module');
const filename = require.resolve('../../scripts/electron-e2e.cts');
const source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'));

interface RunnerProcess {
  platform: string;
  argv: string[];
  exitCode?: number;
}
interface RunnerOptions {
  main?: boolean;
  process?: RunnerProcess;
  spawnSync?: (command: string, args: readonly string[]) => { status: number | null };
}
interface RunnerOptionsInput {
  platform: string;
  spawn: (command: string, args: string[], options?: { stdio?: string }) => { status: number | null; error?: Error };
}
interface RunnerExports {
  run(args: string[], options?: RunnerOptionsInput): number;
}
function loadRunner({ main = false, process: runtime = process as unknown as RunnerProcess, spawnSync }: RunnerOptions = {}): RunnerExports {
  const entry: { exports: RunnerExports } = { exports: {} as RunnerExports };
  const fakeRequire = (name: string): unknown => name === 'node:child_process' && spawnSync ? { spawnSync } : require(name);
  fakeRequire.main = main ? entry : undefined;
  vm.runInNewContext(source, {
    require: fakeRequire, module: entry, process: runtime, __dirname: path.dirname(filename),
  }, { filename });
  return entry.exports;
}
const { run } = loadRunner();

test('Linux always launches Playwright on a new virtual display with one worker', () => {
  const calls: Array<[string, string[], { stdio?: string }?]> = [];
  assert.equal(run(['tests/e2e/desktop.smoke.spec.ts'], { platform: 'linux', spawn: (...args) => {
    calls.push(args);
    return { status: 0 };
  } }), 0);
  assert.deepEqual(structuredClone(calls[0]!.slice(0, 2)), ['xvfb-run', ['-a', 'pnpm', 'exec', 'playwright', 'test', 'tests/e2e/desktop.smoke.spec.ts', '--workers=1']]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![2]!.stdio, 'inherit');
});

test('macOS and Windows build and run an isolated Docker test environment', () => {
  for (const platform of ['darwin', 'win32']) {
    const calls: Array<[string, string[], { stdio?: string }?]> = [];
    assert.equal(run(['--headed'], { platform, spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    } }), 0);
    assert.equal(calls.length, 2);
    assert.deepEqual(structuredClone(calls[0]!.slice(0, 2)), ['docker', ['build', '--file', 'desktop/Dockerfile.test', '--tag', 'bookstr-electron-tests', '.']]);
    assert.deepEqual(structuredClone(calls[1]!.slice(0, 2)), ['docker', ['run', '--rm', '--init', '--ipc=host', 'bookstr-electron-tests', 'pnpm', 'run', 'test:e2e', '--headed']]);
  }
});

test('failed builds, interrupted tests and missing isolation tools fail closed', () => {
  let calls = 0;
  assert.equal(run([], { platform: 'darwin', spawn: () => { calls++; return { status: 7 }; } }), 7);
  assert.equal(calls, 1);
  assert.equal(run([], { platform: 'linux', spawn: () => ({ status: null }) }), 1);
  assert.throws(() => run([], { platform: 'linux', spawn: () => ({ status: null, error: new Error('missing xvfb-run') }) }), /missing xvfb-run/);
});

test('every desktop GUI test shortcut uses the isolated runner', () => {
  const { scripts }: import('../types/package-manifest').DesktopPackageManifest = require('../../package.json');
  for (const name of ['test:e2e', 'test:e2e:smoke', 'test:e2e:transfers', 'test:e2e:reader', 'test:e2e:headed']) {
    assert.match(scripts[name]!, /^node scripts\/electron-e2e\.cts(?: |$)/);
  }
});

test('CLI forwards arguments and propagates the isolated process exit status', () => {
  const fakeProcess: RunnerProcess = { platform: 'linux', argv: ['node', filename, '--grep', 'reader'] };
  loadRunner({ main: true, process: fakeProcess, spawnSync(command, args) {
    assert.equal(command, 'xvfb-run');
    assert.deepEqual(Array.from(args), ['-a', 'pnpm', 'exec', 'playwright', 'test', '--grep', 'reader', '--workers=1']);
    return { status: 9 };
  } });
  assert.equal(fakeProcess.exitCode, 9);
});


test('container test failures propagate after a successful image build', () => {
  const calls: Array<[string, string]> = [];
  assert.equal(run([], { platform: 'darwin', spawn: (command, args) => {
    calls.push([command, args[0]!]);
    return { status: args[0] === 'build' ? 0 : 6 };
  } }), 6);
  assert.deepEqual(calls, [['docker', 'build'], ['docker', 'run']]);
});
