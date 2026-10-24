'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform === 'win32') process.exit(0);

const root = __dirname;
const output = path.join(root, 'kindle-mtp');
const libRoot = path.join(root, 'lib');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`);
  }
  return result.stdout;
}

function dependencies(file) {
  const output = process.platform === 'darwin' ? run('otool', ['-L', file]) : run('ldd', [file]);
  return output.split('\n').map(line => {
    if (process.platform === 'darwin') return line.match(/^\s+(\/[^\s]+)\s+\(/)?.[1] || '';
    return line.match(/=>\s+(\/[^\s]+)\s+\(/)?.[1] || '';
  }).filter(Boolean);
}

function bundleDependency(file) {
  if (process.platform === 'darwin' && (file.startsWith('/System/') || file.startsWith('/usr/lib/'))) return;
  if (process.platform === 'linux' && /\/lib(?:c|m|dl|pthread|rt|resolv|gcc_s|stdc\+\+|z)\.so|\/ld-linux/.test(file)) return;
  const target = path.join(libRoot, path.basename(file));
  if (fs.existsSync(target)) return;
  fs.copyFileSync(file, target);
  for (const dependency of dependencies(file)) bundleDependency(dependency);
}

try {
  const flags = run('pkg-config', ['--cflags', '--libs', 'libmtp', 'libusb-1.0']).trim().split(/\s+/).filter(Boolean);
  const compiler = process.platform === 'darwin' ? 'clang' : 'cc';
  run(compiler, ['-std=c11', '-D_DEFAULT_SOURCE', '-O2', '-Wall', '-Wextra',
    path.join(root, 'kindle-mtp.c'), '-o', output, ...flags]);
  fs.rmSync(libRoot, { recursive: true, force: true });
  fs.mkdirSync(libRoot, { recursive: true });
  for (const dependency of dependencies(output)) bundleDependency(dependency);
  for (const target of [output, ...fs.readdirSync(libRoot).map(name => path.join(libRoot, name))]) {
    const relativePrefix = target === output ? '@loader_path/lib/' : '@loader_path/';
    if (process.platform === 'darwin') {
      for (const dependency of dependencies(target)) {
        const bundled = path.join(libRoot, path.basename(dependency));
        if (fs.existsSync(bundled)) run('install_name_tool', ['-change', dependency, `${relativePrefix}${path.basename(dependency)}`, target]);
      }
      run('codesign', ['--force', '--sign', '-', target]);
    } else {
      run('patchelf', ['--set-rpath', target === output ? '$ORIGIN/lib' : '$ORIGIN', target]);
    }
  }
  process.stdout.write(`Built Kindle MTP adapter: ${output}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\nInstall libmtp, pkg-config, and (on Linux) patchelf to package Kindle USB support.\n`);
  process.exitCode = 1;
}
