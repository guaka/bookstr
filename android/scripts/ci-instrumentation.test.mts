import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { captureDiagnostics, invokeIfMain, planShards, runCli, timingRecorder, verifySelection } from './ci-instrumentation.mjs';

const cli = resolve('android/scripts/ci-instrumentation.mjs');

function logFor(tests: Array<{ className: string; name: string; time?: number; status?: number }>) {
  return [
    ...tests.flatMap(({ className, name, time, status = 0 }) => [
      `INSTRUMENTATION_STATUS: class=${className}`,
      `INSTRUMENTATION_STATUS: test=${name}`,
      ...(time === undefined ? [] : [`INSTRUMENTATION_STATUS: time=${time}`]),
      'INSTRUMENTATION_STATUS_CODE: 1',
      `INSTRUMENTATION_STATUS_CODE: ${status}`,
    ]),
    'INSTRUMENTATION_RESULT: stream=OK',
    'INSTRUMENTATION_CODE: -1',
  ].join('\n');
}

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'bookstr-ci-instrumentation-'));
}

test('plans discovered tests deterministically with duration balancing and safe defaults', () => {
  const log = logFor([
    { className: 'z.LastTest', name: 'alpha' },
    { className: 'a.FirstTest', name: 'slow' },
    { className: 'b.MiddleTest', name: 'fast' },
    { className: 'c.OtherTest', name: 'tie' },
  ]);
  const seconds = {
    'z.LastTest#alpha': 8,
    'a.FirstTest#slow': 8,
    'b.MiddleTest#fast': 1,
    'c.OtherTest#tie': Number.NaN,
  };
  const shards = planShards(log, seconds, 2);
  assert.deepEqual(shards, [
    { estimatedSeconds: 11, tests: ['a.FirstTest#slow', 'c.OtherTest#tie'] },
    { estimatedSeconds: 9, tests: ['z.LastTest#alpha', 'b.MiddleTest#fast'] },
  ]);
  assert.deepEqual(planShards(log, seconds, 2), shards);
  assert.deepEqual(planShards(logFor([{ className: 'example.Test$Nested', name: 'works' }]), {}, 1)[0]?.tests, ['example.Test$Nested#works']);
  assert.equal(planShards(logFor([
    { className: 'A.Test', name: 'one' }, { className: 'B.Test', name: 'two' },
  ]), { 'A.Test#one': 0, 'B.Test#two': -4 }, 1)[0]?.estimatedSeconds, 6);
});

test('rejects invalid shard counts and incomplete, duplicate, unsupported, or too-small discoveries', () => {
  const oneTest = logFor([{ className: 'example.Test', name: 'one' }]);
  for (const count of [0, -1, 1.5, 100, Number.NaN]) {
    assert.throws(() => planShards(oneTest, {}, count), /Invalid shard count/);
  }
  assert.throws(() => planShards('not instrumentation output', {}, 1), /Incomplete test discovery/);
  assert.throws(() => planShards(oneTest, {}, 2), /More shards than discovered tests/);
  const duplicate = logFor([
    { className: 'example.Test', name: 'repeat' }, { className: 'example.Test', name: 'repeat' },
  ]);
  assert.throws(() => planShards(duplicate, {}, 1), /Duplicate or unsupported/);
  const badIdentifier = logFor([{ className: 'example.Test', name: 'name with space' }]);
  assert.throws(() => planShards(badIdentifier, {}, 1), /Duplicate or unsupported/);
});

test('verifies exact selected identities while leaving assertion failures for the result parser', () => {
  const pass = logFor([
    { className: 'example.A', name: 'one' }, { className: 'example.B$Nested', name: 'two' },
  ]);
  assert.equal(verifySelection(pass, 'example.B$Nested#two, example.A#one\n'), undefined);
  const assertionFailure = logFor([{ className: 'example.A', name: 'one', status: -2 }]);
  assert.equal(verifySelection(assertionFailure, 'example.A#one'), undefined);
});

test('rejects incomplete, missing, extra, duplicate, or empty test selections', () => {
  const one = logFor([{ className: 'example.A', name: 'one' }]);
  assert.throws(() => verifySelection(one, 'example.A#one,example.B#two'), /mismatch; missing: example.B#two/);
  assert.throws(() => verifySelection(logFor([
    { className: 'example.A', name: 'one' }, { className: 'example.B', name: 'two' },
  ]), 'example.A#one'), /mismatch; unexpected: example.B#two/);
  assert.throws(() => verifySelection(logFor([
    { className: 'example.A', name: 'one' }, { className: 'example.A', name: 'one' },
  ]), 'example.A#one'), /Duplicate instrumentation test identifier/);
  assert.throws(() => verifySelection(one, ''), /Invalid test selection/);
  assert.throws(() => verifySelection(one, 'example.A#one,,example.B#two'), /Invalid test selection/);
  assert.throws(() => verifySelection(one, 'example.A#one,example.A#one'), /Invalid test selection/);
  assert.throws(() => verifySelection(one, 'example.A#test with spaces'), /Invalid test selection/);
  assert.throws(() => verifySelection('not instrumentation output', 'example.A#one'), /Incomplete instrumentation result/);
});

test('records runtime-discovered test timing and current-test snapshots for recognized terminal codes', () => {
  let clock = 10;
  const snapshots: string[] = [];
  const recorder = timingRecorder(() => clock, text => snapshots.push(text));
  assert.equal(recorder('INSTRUMENTATION_STATUS: class=example.ReadTest'), 'INSTRUMENTATION_STATUS: class=example.ReadTest');
  assert.equal(recorder('INSTRUMENTATION_STATUS: test=opens book'), 'INSTRUMENTATION_STATUS: test=opens book');
  assert.equal(recorder('INSTRUMENTATION_STATUS_CODE: 1'), 'INSTRUMENTATION_STATUS_CODE: 1');
  clock = 1_260;
  assert.equal(recorder('INSTRUMENTATION_STATUS_CODE: 0'), 'INSTRUMENTATION_STATUS: time=1250\nINSTRUMENTATION_STATUS_CODE: 0');
  assert.equal(recorder('INSTRUMENTATION_STATUS_CODE: -2'), 'INSTRUMENTATION_STATUS_CODE: -2');
  assert.deepEqual(snapshots, ['RUNNING example.ReadTest#opens book\n', 'FINISHED example.ReadTest#opens book: INSTRUMENTATION_STATUS_CODE: 0\n']);

  clock = 20;
  recorder('INSTRUMENTATION_STATUS: test=throws');
  recorder('INSTRUMENTATION_STATUS_CODE: 1');
  clock = 5;
  assert.equal(recorder('INSTRUMENTATION_STATUS_CODE: -1'), 'INSTRUMENTATION_STATUS: time=0\nINSTRUMENTATION_STATUS_CODE: -1');
  assert.equal(recorder('INSTRUMENTATION_STATUS_CODE: -3'), 'INSTRUMENTATION_STATUS_CODE: -3');
  assert.equal(recorder('INSTRUMENTATION_STATUS_CODE: -4'), 'INSTRUMENTATION_STATUS_CODE: -4');
  assert.equal(recorder('INSTRUMENTATION_STATUS_CODE: 2'), 'INSTRUMENTATION_STATUS_CODE: 2');
  assert.equal(recorder('other output'), 'other output');
  assert.deepEqual(snapshots.slice(2), ['RUNNING example.ReadTest#throws\n', 'FINISHED example.ReadTest#throws: INSTRUMENTATION_STATUS_CODE: -1\n']);
});

test('captures bounded adb diagnostics and writes per-command errors without stopping later captures', () => {
  const directory = temporaryDirectory();
  try {
    const calls: Array<{ executable: string; args: readonly string[]; options: unknown }> = [];
    captureDiagnostics('/fake/adb', directory, ((executable: string, args: readonly string[], options: unknown) => {
      calls.push({ executable, args, options });
      if (args[0] === 'exec-out') throw new Error('screenshot failed');
      return Buffer.from(args[0] === 'logcat' ? 'recent logs' : 'top activity');
    }) as typeof execFileSync);
    assert.deepEqual(calls.map(call => call.args), [
      ['logcat', '-d', '-t', '2000'], ['exec-out', 'screencap', '-p'], ['shell', 'dumpsys', 'activity', 'activities'],
    ]);
    for (const call of calls) {
      assert.equal(call.executable, '/fake/adb');
      assert.deepEqual(call.options, { timeout: 10_000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    assert.equal(readFileSync(join(directory, 'logcat.txt'), 'utf8'), 'recent logs');
    assert.equal(readFileSync(join(directory, 'failure.png.error.txt'), 'utf8'), 'Error: screenshot failed');
    assert.equal(readFileSync(join(directory, 'activities.txt'), 'utf8'), 'top activity');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runCli plans a selected shard, emits the full JSON plan, and rejects bad indices and usage', async () => {
  const directory = temporaryDirectory();
  try {
    const log = join(directory, 'discovery.log');
    const history = join(directory, 'history.json');
    const output = join(directory, 'selected.txt');
    writeFileSync(log, logFor([{ className: 'example.A', name: 'one' }, { className: 'example.B', name: 'two' }]));
    writeFileSync(history, JSON.stringify({ seconds: { 'example.A#one': 6, 'example.B#two': 2 } }));
    await runCli(['plan', log, history, '1', '2', output]);
    assert.equal(readFileSync(output, 'utf8'), 'example.B#two');
    assert.deepEqual(JSON.parse(readFileSync(`${output}.json`, 'utf8')), [
      { estimatedSeconds: 6, tests: ['example.A#one'] }, { estimatedSeconds: 2, tests: ['example.B#two'] },
    ]);
    await assert.rejects(runCli(['plan', log, history, '-1', '2', output]), /Invalid shard index/);
    await assert.rejects(runCli(['plan', log, history, '2', '2', output]), /Invalid shard index/);
    await assert.rejects(runCli(['plan', log, history, 'nope', '2', output]), /Invalid shard index/);
    await assert.rejects(runCli(['plan', log, history, '0']), /Usage:/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runCli verify checks log identities against the selection file', async () => {
  const directory = temporaryDirectory();
  try {
    const log = join(directory, 'shard.log');
    const selection = join(directory, 'selection.txt');
    writeFileSync(log, logFor([{ className: 'example.A', name: 'one' }]));
    writeFileSync(selection, 'example.A#one');
    await runCli(['verify', log, selection]);
    writeFileSync(selection, 'example.B#two');
    await assert.rejects(runCli(['verify', log, selection]), /mismatch/);
    await assert.rejects(runCli(['verify', log]), /Usage:.*verify LOG SELECTION_FILE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runCli timings aggregates only passed tests with positive durations', async () => {
  const directory = temporaryDirectory();
  const originalWrite = process.stdout.write;
  let stdout = '';
  try {
    const passing = join(directory, 'passing.log');
    const mixed = join(directory, 'mixed.log');
    writeFileSync(passing, logFor([{ className: 'example.Test', name: 'timed', time: 1_250 }]));
    writeFileSync(mixed, logFor([
      { className: 'example.Test', name: 'zero', time: 0 },
      { className: 'example.Test', name: 'failed', time: 1_000, status: -2 },
    ]));
    process.stdout.write = ((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write;
    await runCli(['timings', passing, mixed]);
    assert.deepEqual(JSON.parse(stdout), { seconds: { 'example.Test#timed': 1.25 } });
    await assert.rejects(runCli(['timings']), /Usage:/);
  } finally {
    process.stdout.write = originalWrite;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('runCli diagnostics dispatches to adb capture using the configured executable', async () => {
  const directory = temporaryDirectory();
  const originalPath = process.env.PATH;
  try {
    const fakeBin = join(directory, 'bin');
    const diagnostics = join(directory, 'diagnostics');
    const adb = join(fakeBin, 'adb');
    mkdirSync(fakeBin);
    writeFileSync(adb, '#!/bin/sh\nprintf "fake adb output"\n', { mode: 0o755 });
    process.env.PATH = `${fakeBin}:${originalPath ?? ''}`;
    await runCli(['diagnostics', 'adb', diagnostics]);
    assert.equal(readFileSync(join(diagnostics, 'logcat.txt'), 'utf8'), 'fake adb output');
    assert.equal(readFileSync(join(diagnostics, 'failure.png'), 'utf8'), 'fake adb output');
    assert.equal(readFileSync(join(diagnostics, 'activities.txt'), 'utf8'), 'fake adb output');
    await assert.rejects(runCli(['diagnostics', 'adb']), /Usage:/);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI stream and diagnostics commands work, and invokeIfMain checks both entry-point branches', async () => {
  const directory = temporaryDirectory();
  try {
    const current = join(directory, 'current-test.txt');
    const streamed = spawnSync(process.execPath, [cli, 'stream', current], {
      input: [
        'INSTRUMENTATION_STATUS: class=example.StreamTest',
        'INSTRUMENTATION_STATUS: test=reads line',
        'INSTRUMENTATION_STATUS_CODE: 1',
        'INSTRUMENTATION_STATUS_CODE: 0',
      ].join('\n') + '\n', encoding: 'utf8',
    });
    assert.equal(streamed.status, 0, streamed.stderr);
    assert.match(streamed.stdout, /INSTRUMENTATION_STATUS_CODE: 0/);
    assert.equal(readFileSync(current, 'utf8').split('\n')[0], 'FINISHED example.StreamTest#reads line: INSTRUMENTATION_STATUS_CODE: 0');

    const adbDirectory = join(directory, 'bin');
    const diagnostics = join(directory, 'diagnostics');
    const adb = join(adbDirectory, 'adb');
    mkdirSync(adbDirectory);
    writeFileSync(adb, '#!/bin/sh\nprintf "fake adb output"\n', { mode: 0o755 });
    const diagnosticsRun = spawnSync(process.execPath, [cli, 'diagnostics', adb, diagnostics], { encoding: 'utf8' });
    assert.equal(diagnosticsRun.status, 0, diagnosticsRun.stderr);
    assert.equal(readFileSync(join(diagnostics, 'logcat.txt'), 'utf8'), 'fake adb output');

    const noOp = await invokeIfMain('file:///different/module.mjs', [process.execPath, cli, 'unsupported']);
    assert.equal(noOp, undefined);
    const invoked = spawnSync(process.execPath, [cli, 'unsupported'], { encoding: 'utf8' });
    assert.equal(invoked.status, 1);
    assert.match(invoked.stderr, /Usage:/);
    const missingPlan = spawnSync(process.execPath, [cli, 'plan', join(directory, 'missing'), 'missing-history', '0', '1', 'output'], { encoding: 'utf8' });
    assert.equal(missingPlan.status, 1);
    assert.match(missingPlan.stderr, /ENOENT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
