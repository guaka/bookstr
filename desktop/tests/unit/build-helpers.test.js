const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');

test('packaging stamps one timestamp per invocation and propagates write failures', async () => {
  const writes = [];
  let writeError;
  const context = {
    module: { exports: {} }, __dirname: root,
    require(name) {
      if (name === 'node:path') return path;
      assert.equal(name, 'node:fs/promises');
      return { async writeFile(...args) { if (writeError) throw writeError; writes.push(args); } };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'stamp-build.js'), 'utf8'), context, { filename: path.join(root, 'stamp-build.js') });
  assert.equal(writes.length, 0);
  await context.module.exports();
  await context.module.exports();
  assert.equal(writes.length, 2);
  assert.equal(writes[0][0], path.join(root, 'build-info.json'));
  assert.equal(writes[0][1], writes[1][1]);
  assert.ok(writes[0][1].endsWith('\n'));
  assert.equal(new Date(JSON.parse(writes[0][1]).builtAt).toISOString(), JSON.parse(writes[0][1]).builtAt);
  writeError = new Error('disk full');
  await assert.rejects(context.module.exports(), writeError);
});

function nativeBuild(platform, failure) {
  const commands = [];
  const copied = new Set();
  let stdout = '';
  let stderr = '';
  const exited = new Error('exit');
  const context = {
    __dirname: path.join(root, 'native'), exports: {},
    process: {
      platform, exit(code) { assert.equal(code, 0); throw exited; },
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
    },
    require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:fs') return {
        existsSync(file) { return copied.has(file); },
        copyFileSync(_from, to) { copied.add(to); },
        rmSync() {}, mkdirSync() {},
        readdirSync() { return [...copied].map(file => path.basename(file)); },
      };
      assert.equal(name, 'node:child_process');
      return { spawnSync(command, args, options) {
        commands.push([command, Array.from(args)]);
        assert.equal(options.encoding, 'utf8');
        if (failure) return failure;
        if (command === 'pkg-config') return { status: 0, stdout: '-I/include -L/lib -lmtp\n' };
        if (command === 'ldd') return { status: 0, stdout: 'libmtp.so => /opt/lib/libmtp.so (0x01)\nlibc.so => /lib/libc.so (0x02)\n' };
        if (command === 'otool') return { status: 0, stdout: `${args[1]}:\n /opt/lib/libmtp.dylib (compatibility version 1.0)\n /usr/lib/libSystem.dylib (compatibility version 1.0)\n /System/Library/Frameworks/Test (compatibility version 1.0)\n` };
        return { status: 0, stdout: '' };
      } };
    },
  };
  try {
    vm.runInNewContext(fs.readFileSync(path.join(root, 'native/build-kindle-mtp.js'), 'utf8'), context, { filename: path.join(root, 'native/build-kindle-mtp.js') });
  } catch (error) { if (error !== exited) throw error; }
  return { commands, copied, stdout, stderr, exitCode: context.process.exitCode };
}

test('native build skips Windows and bundles Linux dependencies with relative lookup paths', () => {
  assert.equal(nativeBuild('win32').commands.length, 0);
  const result = nativeBuild('linux');
  assert.equal(result.exitCode, undefined);
  assert.equal(result.stderr, '');
  assert.equal(result.copied.size, 1);
  assert.ok(result.stdout.includes('Built Kindle MTP adapter:'));
  assert.ok(result.commands.some(([command, args]) => command === 'cc' && args.includes('-lmtp')));
  assert.ok(result.commands.some(([command, args]) => command === 'patchelf' && args.includes('$ORIGIN/lib')));
  assert.ok(result.commands.some(([command, args]) => command === 'patchelf' && args.includes('$ORIGIN')));
});

test('native macOS build rewrites and signs bundled dependencies', () => {
  const result = nativeBuild('darwin');
  assert.equal(result.exitCode, undefined);
  assert.equal(result.copied.size, 1);
  assert.ok(result.commands.some(([command]) => command === 'clang'));
  assert.ok(result.commands.some(([command, args]) => command === 'install_name_tool' && args.some(arg => arg.startsWith('@loader_path/lib/'))));
  assert.ok(result.commands.some(([command, args]) => command === 'install_name_tool' && args.some(arg => arg === '@loader_path/libmtp.dylib')));
  assert.equal(result.commands.filter(([command]) => command === 'codesign').length, 2);
});

test('native build reports command failures with actionable dependency requirements', () => {
  for (const failure of [
    { error: new Error('missing executable') },
    { status: 2, stderr: 'missing libraries' },
    { status: 2, stdout: 'compiler failed' },
    { status: 2 },
  ]) {
    const result = nativeBuild('linux', failure);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /pkg-config failed:/);
    assert.match(result.stderr, /Install libmtp, pkg-config/);
  }
});
