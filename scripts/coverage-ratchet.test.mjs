import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  checkReport,
  cli,
  invokeIfMain,
  parseArgs,
  run,
  validateBaselines,
} from './coverage-ratchet.mjs';

const suite = (minimumTests = 2, metrics = { Lines: 90 }) => ({
  minimumTests,
  source: 'https://github.com/guaka/bookstr/actions/runs/1',
  commit: 'a'.repeat(40),
  metrics,
});
const baselines = () => ({
  version: 1,
  capturedAt: '2026-08-28T00:00:00Z',
  suites: Object.fromEntries(['web', 'electron', 'android', 'ios'].map(name => [name, suite()])),
});
const report = () => ({
  id: 'web',
  status: 'passing',
  results: { tests: 2 },
  coverage: [{ label: 'Lines', value: 90 }],
});

test('validates the exact four-client baseline shape', () => {
  const value = baselines();
  assert.equal(validateBaselines(value), value);
  assert.throws(() => validateBaselines(null), /version 1/);
  assert.throws(() => validateBaselines({ ...value, capturedAt: null }), /version 1/);
  assert.throws(() => validateBaselines({ ...value, suites: [] }), /define suites/);
  assert.throws(() => validateBaselines({ ...value, suites: { ...value.suites, web: null } }), /positive minimum/);
  assert.throws(() => validateBaselines({ ...value, suites: { ...value.suites, web: { ...suite(), minimumTests: 0 } } }), /positive minimum/);
  assert.throws(() => validateBaselines({ ...value, suites: { ...value.suites, web: { ...suite(), source: 'local' } } }), /Actions run/);
  assert.throws(() => validateBaselines({ ...value, suites: { ...value.suites, web: { ...suite(), commit: 'short' } } }), /commit hash/);
  assert.throws(() => validateBaselines({ ...value, suites: { ...value.suites, web: { ...suite(), metrics: [] } } }), /coverage metrics/);
  assert.throws(() => validateBaselines({ ...value, suites: { ...value.suites, web: { ...suite(), metrics: {} } } }), /coverage metrics/);
  assert.throws(() => validateBaselines({ ...value, suites: { ...value.suites, web: suite(2, { '': 90 }) } }), /invalid coverage/);
  assert.throws(() => validateBaselines({ ...value, suites: { ...value.suites, web: suite(2, { Lines: 101 }) } }), /invalid coverage/);
  assert.throws(() => validateBaselines({ ...value, suites: { ...value.suites, extra: suite() } }), /exactly the four/);
});

test('accepts matching reports and rejects every regression mode', () => {
  assert.deepEqual(checkReport(baselines(), 'web', report()), {
    suite: 'web', tests: 2, metrics: { Lines: 90 },
  });
  assert.throws(() => checkReport(baselines(), 'missing', report()), /Unknown coverage suite/);
  assert.throws(() => checkReport(baselines(), 'web', null), /not passing/);
  assert.throws(() => checkReport(baselines(), 'web', { ...report(), id: 'android' }), /not passing/);
  assert.throws(() => checkReport(baselines(), 'web', { ...report(), status: 'failing' }), /not passing/);
  assert.throws(() => checkReport(baselines(), 'web', { ...report(), results: { tests: 0 } }), /count 0 is below 2/);
  assert.throws(() => checkReport(baselines(), 'web', { ...report(), results: { tests: 1 } }), /below 2/);
  assert.throws(() => checkReport(baselines(), 'web', { ...report(), results: { tests: 2.5 } }), /below 2/);
  assert.throws(() => checkReport(baselines(), 'web', { ...report(), coverage: undefined }), /missing Lines/);
  assert.throws(() => checkReport(baselines(), 'web', { ...report(), coverage: [] }), /missing Lines/);
  assert.throws(() => checkReport(baselines(), 'web', { ...report(), coverage: [{ label: 'Lines', value: 89.99 }] }), /below 90/);
});

test('parses CLI options and reads both JSON inputs', async () => {
  assert.deepEqual(parseArgs(['--suite', 'web', '--report', 'report.json']), {
    baseline: 'shared/coverage/baselines-v1.json', suite: 'web', report: 'report.json',
  });
  assert.deepEqual(parseArgs(['--baseline', 'base.json', '--report', 'report.json', '--suite', 'web']), {
    baseline: 'base.json', report: 'report.json', suite: 'web',
  });
  assert.throws(() => parseArgs([]), /required/);
  assert.throws(() => parseArgs([undefined]), /Unknown or incomplete argument:/);
  assert.throws(() => parseArgs(['--wat', 'x']), /Unknown or incomplete/);
  assert.throws(() => parseArgs(['--suite']), /Unknown or incomplete/);
  const files = new Map([
    ['/repo/base.json', JSON.stringify(baselines())],
    ['/repo/report.json', JSON.stringify(report())],
  ]);
  const result = await run(['--baseline', 'base.json', '--suite', 'web', '--report', 'report.json'], {
    readFile: async path => files.get(path),
  }, '/repo');
  assert.equal(result.suite, 'web');
});

test('CLI reports success and failure and invokes only matching modules', async () => {
  const output = [];
  const errors = [];
  let failed = false;
  assert.equal(await cli([], { run: async () => ({ suite: 'web' }), writeOutput: value => output.push(value) }), 'passed');
  assert.deepEqual(output, ['web coverage ratchet passed\n']);
  assert.equal(await cli([], {
    run: async () => { throw new Error('boom'); },
    writeError: value => errors.push(value),
    fail: () => { failed = true; },
  }), 'failed');
  assert.deepEqual(errors, ['boom\n']);
  assert.equal(failed, true);
  const previousExitCode = process.exitCode;
  assert.equal(await cli([], {
    run: async () => { throw new Error('expected default failure'); },
    writeError: () => {},
  }), 'failed');
  assert.equal(process.exitCode, 1);
  process.exitCode = previousExitCode;
  assert.equal(await invokeIfMain('file:///tool.mjs', ['node'], async () => 'called'), 'imported');
  assert.equal(await invokeIfMain('file:///tool.mjs', ['node', '/other.mjs'], async () => 'called'), 'imported');
  assert.equal(await invokeIfMain('file:///tool.mjs', ['node', '/tool.mjs'], async () => 'called'), 'called');
});

test('default file and process adapters run the real CLI path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bookstr-coverage-ratchet-'));
  const baselinePath = join(directory, 'baseline.json');
  const reportPath = join(directory, 'report.json');
  await writeFile(baselinePath, JSON.stringify(baselines()));
  await writeFile(reportPath, JSON.stringify(report()));
  const args = ['--baseline', baselinePath, '--suite', 'web', '--report', reportPath];
  try {
    assert.equal((await run(args)).suite, 'web');
    assert.equal(await cli(args), 'passed');
    const modulePath = join(directory, 'tool.mjs');
    assert.equal(await invokeIfMain(pathToFileURL(modulePath).href, ['node', modulePath, ...args]), 'passed');
    const previousExitCode = process.exitCode;
    assert.equal(await cli([]), 'failed');
    assert.equal(process.exitCode, 1);
    process.exitCode = previousExitCode;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
