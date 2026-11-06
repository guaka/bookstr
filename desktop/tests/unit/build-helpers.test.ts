const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
const vm: typeof import('node:vm') = require('node:vm');

const root = path.resolve(__dirname, '../..');

interface NativeCommandResult {
  error?: Error;
  status?: number | null;
  stdout?: string;
  stderr?: string;
}
interface NativeBuildResult {
  commands: Array<[string, string[]]>;
  copied: Set<string>;
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}
interface StampContext {
  module: { exports: () => Promise<void> };
  __dirname: string;
  require(name: string): { writeFile?: (...args: string[]) => Promise<void> } | typeof path;
}

test('packaging stamps one timestamp per invocation and propagates write failures', async () => {
  const writes: string[][] = [];
  let writeError: Error | undefined;
  const context: StampContext = {
    module: { exports: {} as () => Promise<void> }, __dirname: root,
    require(name: string) {
      if (name === 'node:path') return path;
      assert.equal(name, 'node:fs/promises');
      return { async writeFile(...args: string[]) { if (writeError) throw writeError; writes.push(args); } };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'stamp-build.js'), 'utf8'), context as import('node:vm').Context, { filename: path.join(root, 'stamp-build.js') });
  assert.equal(writes.length, 0);
  await context.module.exports();
  await context.module.exports();
  assert.equal(writes.length, 2);
  assert.equal(writes[0]![0], path.join(root, 'build-info.json'));
  assert.equal(writes[0]![1], writes[1]![1]);
  assert.ok(writes[0]![1]!.endsWith('\n'));
  assert.equal(new Date(JSON.parse(writes[0]![1]!).builtAt).toISOString(), JSON.parse(writes[0]![1]!).builtAt);
  writeError = new Error('disk full');
  await assert.rejects(context.module.exports(), writeError);
});

function nativeBuild(platform: string, failure?: NativeCommandResult): NativeBuildResult {
  const commands: Array<[string, string[]]> = [];
  const copied = new Set<string>();
  let stdout = '';
  let stderr = '';
  const exited = new Error('exit');
  const context = {
    __dirname: path.join(root, 'native'), exports: {},
    process: {
      platform, exitCode: undefined as number | undefined, exit(code: number): never { assert.equal(code, 0); throw exited; },
      stdout: { write(value: string) { stdout += value; } },
      stderr: { write(value: string) { stderr += value; } },
    },
    require(name: string) {
      if (name === 'node:path') return path;
      if (name === 'node:fs') return {
        existsSync(file: string) { return copied.has(file); },
        copyFileSync(_from: string, to: string) { copied.add(to); },
        rmSync() {}, mkdirSync() {},
        readdirSync() { return [...copied].map(file => path.basename(file)); },
      };
      assert.equal(name, 'node:child_process');
        return { spawnSync(command: string, args: readonly string[], options: { encoding: string }): NativeCommandResult {
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
    vm.runInNewContext(fs.readFileSync(path.join(root, 'native/build-kindle-mtp.js'), 'utf8'), context as import('node:vm').Context, { filename: path.join(root, 'native/build-kindle-mtp.js') });
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
