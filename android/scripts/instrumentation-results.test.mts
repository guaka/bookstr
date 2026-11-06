import { present } from '../../web/tests/test-values.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { convert, parseInstrumentation, toJUnit } from './instrumentation-results.mjs';
import { parseJUnit } from '../../scripts/junit.mjs';

const node = process.execPath;
const cli = resolve('android/scripts/instrumentation-results.mjs');

test('connected Android tests invoke the configured Bookstr instrumentation runner', async () => {
  const [gradle, connectedScript] = await Promise.all([
    readFile(resolve('android/app/build.gradle.kts'), 'utf8'),
    readFile(resolve('android/scripts/run-connected-e2e.sh'), 'utf8'),
  ]);
  assert.match(gradle, /testInstrumentationRunner\s*=\s*"app\.bookstr\.BookstrTestRunner"/);
  assert.match(connectedScript, /app\.bookstr\.test\/app\.bookstr\.BookstrTestRunner/);
});

const successLog = [
  'INSTRUMENTATION_STATUS: class=org.example.BookTest',
  'INSTRUMENTATION_STATUS: test=reads & writes <books> "today" \'quietly\'',
  'INSTRUMENTATION_STATUS: numtests=2',
  'INSTRUMENTATION_STATUS_CODE: 1',
  'INSTRUMENTATION_STATUS: stream=',
  'INSTRUMENTATION_STATUS_CODE: 0',
  'INSTRUMENTATION_STATUS: class=org.example.BookTest',
  'INSTRUMENTATION_STATUS: test=loads cover',
  'INSTRUMENTATION_STATUS: numtests=2',
  'INSTRUMENTATION_STATUS_CODE: 1',
  'INSTRUMENTATION_STATUS: stream=',
  'INSTRUMENTATION_STATUS_CODE: 0',
  'INSTRUMENTATION_RESULT: stream=OK (2 tests)',
  'INSTRUMENTATION_CODE: -1',
].join('\n');

test('parses a complete passing run and emits XML escaped for JUnit', () => {
  const parsed = parseInstrumentation(successLog);
  assert.equal(parsed.success, true);
  assert.deepEqual({ passed: parsed.passed, failures: parsed.failures, errors: parsed.errors, skipped: parsed.skipped }, {
    passed: 2, failures: 0, errors: 0, skipped: 0,
  });
  const xml = toJUnit(parsed);
  assert.match(xml, /tests="2" failures="0" errors="0" skipped="0"/);
  assert.match(xml, /classname="org.example.BookTest" name="reads &amp; writes &lt;books&gt; &quot;today&quot; &apos;quietly&apos;"/);
  assert.match(xml, /<testcase[^>]+name="loads cover"[^>]*><\/testcase>/);
  assert.deepEqual(parseJUnit([xml]), { tests: 2, passed: 2, failed: 0, skipped: 0, durationMs: 0 });
});

test('supports class-filtered runs that advertise one test', () => {
  const log = successLog.replaceAll('numtests=2', 'numtests=1')
    .replace(/INSTRUMENTATION_STATUS: class=org\.example\.BookTest\nINSTRUMENTATION_STATUS: test=loads cover[\s\S]*?INSTRUMENTATION_STATUS_CODE: 0\n/, '');
  assert.equal(parseInstrumentation(log).success, true);
});

test('reports an empty run as unsuccessful and writes a run-error testcase', () => {
  const parsed = parseInstrumentation('INSTRUMENTATION_RESULT: stream=\nINSTRUMENTATION_CODE: -1');
  assert.equal(parsed.success, false);
  assert.match(parsed.problems.join(' '), /No tests were reported/);
  assert.match(toJUnit(parsed), /tests="1" failures="0" errors="1"/);
});

test('keeps failed test identity and multiline stack in JUnit', () => {
  const log = [
    'INSTRUMENTATION_STATUS: class=org.example.FailTest',
    'INSTRUMENTATION_STATUS: test=asserts title',
    'INSTRUMENTATION_STATUS: numtests=1',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS: stack=java.lang.AssertionError: expected <a> & got <b>',
    '  at org.example.FailTest.assertsTitle(FailTest.java:41)',
    'INSTRUMENTATION_STATUS_CODE: -2',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n');
  const parsed = parseInstrumentation(log);
  assert.equal(parsed.success, false);
  assert.equal(parsed.failures, 1);
  assert.match(toJUnit(parsed), /<failure message="java\.lang\.AssertionError: expected &lt;a&gt; &amp; got &lt;b&gt;">/);
  assert.match(toJUnit(parsed), /at org\.example\.FailTest\.assertsTitle\(FailTest\.java:41\)/);
  assert.deepEqual(parseJUnit([toJUnit(parsed)]), { tests: 1, passed: 0, failed: 1, skipped: 0, durationMs: 0 });
});

test('maps runner errors and both ignored and assumption-skipped statuses', () => {
  const log = [
    'INSTRUMENTATION_STATUS: class=org.example.RunnerTest',
    'INSTRUMENTATION_STATUS: test=throws',
    'INSTRUMENTATION_STATUS: numtests=3',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS: stack=java.lang.IllegalStateException: broken',
    'INSTRUMENTATION_STATUS_CODE: -1',
    'INSTRUMENTATION_STATUS: class=org.example.RunnerTest',
    'INSTRUMENTATION_STATUS: test=ignored',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS_CODE: -3',
    'INSTRUMENTATION_STATUS: class=org.example.RunnerTest',
    'INSTRUMENTATION_STATUS: test=assumption',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS_CODE: -4',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n');
  const parsed = parseInstrumentation(log);
  assert.equal(parsed.success, false);
  assert.equal(parsed.errors, 1);
  assert.equal(parsed.skipped, 2);
  assert.equal((toJUnit(parsed).match(/<skipped\/>/g) || []).length, 2);
});

test('rejects a run where every reported test was skipped', () => {
  const skipped = parseInstrumentation([
    'INSTRUMENTATION_STATUS: class=org.example.SkipTest',
    'INSTRUMENTATION_STATUS: test=only ignored test',
    'INSTRUMENTATION_STATUS: numtests=1',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS_CODE: -3',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n'));
  assert.equal(skipped.skipped, 1);
  assert.equal(skipped.success, false);
  assert.match(toJUnit(skipped), /tests="1" failures="0" errors="0" skipped="1"/);
});

test('accepts mixed passing and skipped outcomes, but rejects mixed passing and failed outcomes', () => {
  const run = (terminal: number) => parseInstrumentation([
    'INSTRUMENTATION_STATUS: class=org.example.MixedTest',
    'INSTRUMENTATION_STATUS: test=first',
    'INSTRUMENTATION_STATUS: numtests=2',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS_CODE: 0',
    'INSTRUMENTATION_STATUS: class=org.example.MixedTest',
    'INSTRUMENTATION_STATUS: test=second',
    'INSTRUMENTATION_STATUS_CODE: 1',
    `INSTRUMENTATION_STATUS_CODE: ${terminal}`,
    'INSTRUMENTATION_CODE: -1',
  ].join('\n'));
  assert.equal(run(-3).success, true);
  assert.equal(run(-2).success, false);
});

test('marks unfinished starts and count mismatches as incomplete failures', () => {
  const log = [
    'INSTRUMENTATION_STATUS: class=org.example.IncompleteTest',
    'INSTRUMENTATION_STATUS: test=never completes',
    'INSTRUMENTATION_STATUS: numtests=2',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n');
  const parsed = parseInstrumentation(log);
  assert.equal(parsed.success, false);
  assert.equal(parsed.errors, 1);
  assert.match(toJUnit(parsed), /Instrumentation ended before this test completed/);
  assert.match(parsed.problems.join(' '), /Expected 2 tests but observed 1/);
});

test('rejects truncated blocks, malformed fields, missing protocol, and unsupported codes', () => {
  for (const [log, pattern] of [
    ['INSTRUMENTATION_STATUS: test=unfinished', /Truncated instrumentation status block/],
    ['INSTRUMENTATION_STATUS: malformed\nINSTRUMENTATION_CODE: -1', /Malformed instrumentation status field/],
    ['INSTRUMENTATION_RESULT: malformed\nINSTRUMENTATION_CODE: -1', /Malformed instrumentation result field/],
    ['not instrumentation output', /No Android instrumentation protocol/],
    ['INSTRUMENTATION_STATUS: test=x\nINSTRUMENTATION_STATUS_CODE: 7\nINSTRUMENTATION_CODE: -1', /Unsupported instrumentation status code/],
    ['INSTRUMENTATION_STATUS: test=x\nINSTRUMENTATION_STATUS_CODE: nope\nINSTRUMENTATION_CODE: -1', /Invalid instrumentation status code/],
  ] as Array<[string, RegExp]>) {
    const parsed = parseInstrumentation(log);
    assert.equal(parsed.success, false);
    assert.match(parsed.problems.join(' '), pattern);
  }
});

test('rejects missing or unexpected final codes and crash shortMsg', () => {
  const onePass = successLog.replaceAll('numtests=2', 'numtests=1').replace(/INSTRUMENTATION_STATUS: class=org\.example\.BookTest\nINSTRUMENTATION_STATUS: test=loads cover[\s\S]*?INSTRUMENTATION_STATUS_CODE: 0\n/, '');
  assert.match(parseInstrumentation(onePass.replace('INSTRUMENTATION_CODE: -1', '')).problems.join(' '), /Missing final instrumentation code/);
  assert.match(parseInstrumentation(onePass.replace('INSTRUMENTATION_CODE: -1', 'INSTRUMENTATION_CODE: 0')).problems.join(' '), /Unexpected final instrumentation code: 0/);
  const crash = `${onePass}\nINSTRUMENTATION_RESULT: shortMsg=Process crashed`;
  assert.match(parseInstrumentation(crash).problems.join(' '), /Instrumentation crashed: Process crashed/);
});

test('detects terminal status without a start and combines multiline stream output', () => {
  const unmatched = [
    'INSTRUMENTATION_STATUS: test=orphan',
    'INSTRUMENTATION_STATUS: stream=first',
    'second',
    'INSTRUMENTATION_STATUS_CODE: 0',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n');
  const orphan = parseInstrumentation(unmatched);
  assert.equal(orphan.success, false);
  assert.match(orphan.problems.join(' '), /no matching test start/);
});

test('covers default metadata, duration normalization, and unmatched empty terminal blocks', () => {
  const defaulted = parseInstrumentation([
    'irrelevant runner preamble',
    'INSTRUMENTATION_STATUS: test=   ',
    'INSTRUMENTATION_STATUS: class=  ',
    'INSTRUMENTATION_STATUS: numtests=1',
    'INSTRUMENTATION_STATUS: time=-500',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS_CODE: 0',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n'));
  assert.equal(present(defaulted.cases[0]).name, 'unnamed test 1');
  assert.equal(present(defaulted.cases[0]).className, 'AndroidInstrumentation');
  assert.equal(present(defaulted.cases[0]).duration, 0);
  assert.equal(defaulted.success, true);

  const emptyTerminal = parseInstrumentation('INSTRUMENTATION_STATUS_CODE: 0\nINSTRUMENTATION_CODE: -1');
  assert.equal(emptyTerminal.cases.length, 0);
  assert.match(emptyTerminal.problems.join(' '), /No tests were reported/);
});

test('uses runner error fields, positive durations, and case-folded fallback matching', () => {
  const failed = parseInstrumentation([
    'INSTRUMENTATION_STATUS: class=org.example.DetailTest',
    'INSTRUMENTATION_STATUS: test=reported start',
    'INSTRUMENTATION_STATUS: numtests=1',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS: test=updated terminal name',
    'INSTRUMENTATION_STATUS: time=1250',
    'INSTRUMENTATION_STATUS: error=runner diagnostic',
    'INSTRUMENTATION_STATUS: stack=first stack line',
    'INSTRUMENTATION_STATUS: stack=second stack line',
    'INSTRUMENTATION_STATUS_CODE: -1',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n'));
  assert.equal(failed.success, false);
  assert.equal(present(failed.cases[0]).name, 'updated terminal name');
  assert.equal(present(failed.cases[0]).duration, 1.25);
  assert.equal(present(failed.cases[0]).message, 'runner diagnostic');
  assert.match(toJUnit(failed), /first stack line\nsecond stack line/);
});

test('uses a short message on a test and appends repeated stream fields', () => {
  const parsed = parseInstrumentation([
    'INSTRUMENTATION_STATUS: class=org.example.ShortTest',
    'INSTRUMENTATION_STATUS: test=short message',
    'INSTRUMENTATION_STATUS: numtests=1',
    'INSTRUMENTATION_STATUS: shortMsg=method timed out',
    'INSTRUMENTATION_STATUS: stream=first output',
    'INSTRUMENTATION_STATUS: stream=second output',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS_CODE: -1',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n'));
  assert.equal(present(parsed.cases[0]).message, 'method timed out');
  assert.match(toJUnit(parsed), /first output\nsecond output/);
});

test('matches terminal blocks by test and class and handles malformed final codes', () => {
  const parsed = parseInstrumentation([
    'INSTRUMENTATION_STATUS: class=org.example.OriginalTest',
    'INSTRUMENTATION_STATUS: test=stable name',
    'INSTRUMENTATION_STATUS: numtests=1',
    'INSTRUMENTATION_STATUS_CODE: 1',
    'INSTRUMENTATION_STATUS: class=org.example.DifferentTest',
    'INSTRUMENTATION_STATUS: test=stable name',
    'INSTRUMENTATION_STATUS_CODE: 0',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n'));
  assert.equal(parsed.success, true);
  assert.equal(present(parsed.cases[0]).className, 'org.example.DifferentTest');
  const malformed = parseInstrumentation(successLog.replace('INSTRUMENTATION_CODE: -1', 'INSTRUMENTATION_CODE: nope'));
  assert.match(malformed.problems.join(' '), /Unexpected final instrumentation code: NaN/);
});

test('convert writes JUnit before returning a failed result and exposes input errors', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.instrumentation-results-'));
  try {
    const input = join(directory, 'runner.log');
    const output = join(directory, 'results.xml');
    await writeFile(input, successLog.replace('INSTRUMENTATION_CODE: -1', 'INSTRUMENTATION_CODE: 0'));
    const result = await convert(input, output);
    assert.equal(result.success, false);
    assert.match(await readFile(output, 'utf8'), /errors="0"/);
    await assert.rejects(convert(join(directory, 'missing.log'), output));
    await assert.rejects(convert(input, join(directory, 'missing', 'results.xml')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI validates arguments, succeeds only for complete passes, and writes failure XML', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.instrumentation-cli-'));
  try {
    const input = join(directory, 'runner.log');
    const output = join(directory, 'results.xml');
    await writeFile(input, successLog);
    const pass = spawnSync(node, [cli, input, output], { encoding: 'utf8' });
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(await readFile(output, 'utf8'), /tests="2"/);
    const usage = spawnSync(node, [cli], { encoding: 'utf8' });
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /Usage:/);
    await writeFile(input, successLog.replace('INSTRUMENTATION_CODE: -1', 'INSTRUMENTATION_CODE: 0'));
    const fail = spawnSync(node, [cli, input, output], { encoding: 'utf8' });
    assert.equal(fail.status, 1);
    assert.match(fail.stderr, /Unexpected final instrumentation code: 0/);
    assert.match(await readFile(output, 'utf8'), /tests="2"/);
    const missing = spawnSync(node, [cli, join(directory, 'missing.log'), output], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Unable to convert instrumentation results/);
    const writeError = spawnSync(node, [cli, input, join(directory, 'no', 'output.xml')], { encoding: 'utf8' });
    assert.equal(writeError.status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
