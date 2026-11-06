import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import type { ToolBuildApi } from './typescript.cts';
const require = createRequire(import.meta.url);
const build = require('./typescript.cts') as ToolBuildApi;

test('tool compiler bounds resource use and propagates launch and compilation failures', () => {
  build.compiler('tsconfig.json', ['--noEmit'], '/repo/scripts', (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.deepEqual(args, ['/repo/web/node_modules/typescript/bin/tsc', '-p', '/repo/scripts/tsconfig.json', '--noEmit']);
    assert.equal(options.env.GOMEMLIMIT, '512MiB');
    assert.equal(options.env.GOMAXPROCS, '2');
    assert.equal(options.env.NODE_OPTIONS, '--max-old-space-size=512');
    return { status: 0 };
  });
  const failure = new Error('cannot launch compiler');
  assert.throws(() => build.compiler('broken.json', [], '/repo/scripts', () => ({status: null, error: failure})), error => error === failure);
  assert.throws(() => build.compiler('broken.json', [], '/repo/scripts', () => ({status: 1})), /compilation failed: broken.json/);
  assert.throws(() => build.compiler('broken.json', [], '/repo/scripts', () => ({status: null})), /compilation failed/);
});

test('tool generation updates missing outputs and rejects stale checks without writing', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-tool-output-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const outputs = new Map([['sample.mjs', 'export const value = 1;\n']]);
  assert.throws(() => build.writeOutputs(outputs, directory, true), /stale: sample.mjs/);
  assert.equal(fs.existsSync(path.join(directory, 'sample.mjs')), false);
  build.writeOutputs(outputs, directory, false);
  build.writeOutputs(outputs, directory, true);
  fs.writeFileSync(path.join(directory, 'sample.mjs'), 'stale');
  assert.throws(() => build.writeOutputs(outputs, directory, true), /stale/);
  assert.equal(fs.readFileSync(path.join(directory, 'sample.mjs'), 'utf8'), 'stale');
  build.writeOutputs(outputs, directory, false);
});

test('tool builder validates both production and test configurations and cleans failures', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-tool-main-'));
  const scripts = path.join(directory, 'scripts');
  fs.mkdirSync(scripts);
  fs.mkdirSync(path.join(directory, 'android/scripts'), {recursive: true});
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const calls: string[] = [];
  const compile: Parameters<ToolBuildApi['main']>[2] = (configuration, args) => {
    calls.push(configuration);
    const output = args[1];
    if (args[0] === '--outDir') {
      assert.ok(output);
      fs.writeFileSync(path.join(output, 'sample.mjs'), 'export const value = 1;\n');
    }
  };
  build.main([], scripts, compile);
  build.main(['--check'], scripts, compile);
  build.main(['--noEmit'], scripts, compile);
  assert.equal(calls.length, 12);
  assert.ok(calls.includes('../android/scripts/tsconfig.tests.json'));
  let temporary = '';
  assert.throws(() => build.main([], scripts, (_configuration, args) => {
    temporary = args[1] || '';
    throw new Error('expected compilation failure');
  }), /expected compilation failure/);
  assert.equal(fs.existsSync(temporary), false);
  assert.throws(() => build.main(['--unknown'], scripts, compile), /Expected/);
});

test('tool builder reports CLI errors and the production compiler runs against the real project', () => {
  assert.equal(build.formatError(new Error('message')), 'message');
  assert.equal(build.formatError('foreign error'), 'foreign error');
  build.compiler('tsconfig.json', ['--noEmit']);
  const result = spawnSync(process.execPath, [new URL('./typescript.cts', import.meta.url).pathname, '--unknown'], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected/);
});
