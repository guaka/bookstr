const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../scripts/electron-e2e.cjs');

test('Linux always launches Playwright on a new virtual display with one worker', () => {
  const calls = [];
  assert.equal(run(['tests/e2e/desktop.smoke.spec.js'], { platform: 'linux', spawn: (...args) => {
    calls.push(args);
    return { status: 0 };
  } }), 0);
  assert.deepEqual(calls[0].slice(0, 2), ['xvfb-run', ['-a', 'pnpm', 'exec', 'playwright', 'test', 'tests/e2e/desktop.smoke.spec.js', '--workers=1']]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].stdio, 'inherit');
});

test('macOS and Windows build and run an isolated Docker test environment', () => {
  for (const platform of ['darwin', 'win32']) {
    const calls = [];
    assert.equal(run(['--headed'], { platform, spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    } }), 0);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].slice(0, 2), ['docker', ['build', '--file', 'desktop/Dockerfile.test', '--tag', 'bookstr-electron-tests', '.']]);
    assert.deepEqual(calls[1].slice(0, 2), ['docker', ['run', '--rm', '--init', '--ipc=host', 'bookstr-electron-tests', 'pnpm', 'run', 'test:e2e', '--headed']]);
  }
});

test('failed builds, interrupted tests and missing isolation tools fail closed', () => {
  let calls = 0;
  assert.equal(run([], { platform: 'darwin', spawn: () => { calls++; return { status: 7 }; } }), 7);
  assert.equal(calls, 1);
  assert.equal(run([], { platform: 'linux', spawn: () => ({ status: null }) }), 1);
  assert.throws(() => run([], { platform: 'linux', spawn: () => ({ error: new Error('missing xvfb-run') }) }), /missing xvfb-run/);
});

test('every desktop GUI test shortcut uses the isolated runner', () => {
  const { scripts } = require('../../package.json');
  for (const name of ['test:e2e', 'test:e2e:smoke', 'test:e2e:transfers', 'test:e2e:reader', 'test:e2e:headed']) {
    assert.match(scripts[name], /^node scripts\/electron-e2e\.cjs(?: |$)/);
  }
});

test('CLI forwards arguments and propagates the isolated process exit status', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const filename = require.resolve('../../scripts/electron-e2e.cjs');
  const main = { exports: {} };
  const fakeProcess = { platform: 'linux', argv: ['node', filename, '--grep', 'reader'] };
  const fakeRequire = name => name === 'node:child_process' ? { spawnSync: (command, args) => {
    assert.equal(command, 'xvfb-run');
    assert.deepEqual(Array.from(args), ['-a', 'pnpm', 'exec', 'playwright', 'test', '--grep', 'reader', '--workers=1']);
    return { status: 9 };
  } } : require(name);
  fakeRequire.main = main;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: fakeRequire, module: main, process: fakeProcess, __dirname: require('node:path').dirname(filename)
  }, { filename });
  assert.equal(fakeProcess.exitCode, 9);
});
