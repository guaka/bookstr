'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(desktopRoot, 'tests', 'native');

test('Amazon USB descriptor enumeration fixture compiles and passes without USB libraries', async t => {
  if (process.platform === 'win32') {
    t.skip('The native fixture requires a POSIX C compiler invocation.');
    return;
  }

  const compiler = process.platform === 'darwin' ? 'clang' : 'cc';
  const version = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
  if (version.error || version.status !== 0) {
    t.skip(`${compiler} is unavailable; native fixture compiler check cannot run.`);
    return;
  }

  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-kindle-usb-test-'));
  const executable = path.join(temporary, 'kindle-usb-test');
  try {
    const compile = spawnSync(compiler, [
      '-std=c11', '-Wall', '-Wextra', '-Werror', '-Werror=implicit-function-declaration',
      '-I', path.join(fixtureRoot, 'include'),
      '-I', path.join(desktopRoot, 'native'),
      path.join(fixtureRoot, 'kindle-usb.test.c'), '-o', executable,
    ], { encoding: 'utf8' });
    assert.equal(compile.status, 0, `C fixture compile failed:\n${compile.stderr || compile.stdout}`);

    const result = spawnSync(executable, [], { encoding: 'utf8' });
    assert.equal(result.status, 0, `C fixture failed:\n${result.stderr || result.stdout}`);
    assert.match(result.stdout, /kindle-usb native fixture: ok/);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
