import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const runner = resolve(here, 'run-connected-e2e.sh');
const passLog = [
  'INSTRUMENTATION_STATUS: class=app.bookstr.ExampleTest',
  'INSTRUMENTATION_STATUS: test=passes',
  'INSTRUMENTATION_STATUS: numtests=1',
  'INSTRUMENTATION_STATUS_CODE: 1',
  'INSTRUMENTATION_STATUS_CODE: 0',
  'INSTRUMENTATION_CODE: -1',
].join('\n');
const failedTestLog = [
  'INSTRUMENTATION_STATUS: class=app.bookstr.ExampleTest',
  'INSTRUMENTATION_STATUS: test=fails',
  'INSTRUMENTATION_STATUS: numtests=1',
  'INSTRUMENTATION_STATUS_CODE: 1',
  'INSTRUMENTATION_STATUS: stack=java.lang.AssertionError: expected failure',
  'INSTRUMENTATION_STATUS_CODE: -2',
  'INSTRUMENTATION_CODE: -1',
].join('\n');

async function fixture({ device = 'emulator', instrumentation = passLog, coverage = 'fresh-coverage', pullFailure = false, installFailure = '', hostCoverage = null } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'connected-e2e-contract-'));
  const sdk = join(cwd, 'sdk');
  const platformTools = join(sdk, 'platform-tools');
  const apkDir = join(cwd, 'apks');
  const appApk = join(apkDir, 'app.apk');
  const testApk = join(apkDir, 'test.apk');
  const logPath = join(cwd, 'adb.log');
  const deviceCoverage = join(cwd, 'device-coverage.ec');
  const instrumentationLog = join(cwd, 'instrumentation.log');
  const coverageFile = join(cwd, 'coverage', 'full.ec');
  await Promise.all([mkdir(platformTools, { recursive: true }), mkdir(apkDir, { recursive: true })]);
  await Promise.all([
    writeFile(appApk, 'app apk'),
    writeFile(testApk, 'test apk'),
    writeFile(instrumentationLog, instrumentation),
  ]);
  if (hostCoverage !== null) {
    await mkdir(dirname(coverageFile), { recursive: true });
    await writeFile(coverageFile, hostCoverage);
  }
  const adb = join(platformTools, 'adb');
  await writeFile(adb, `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "$FAKE_ADB_LOG"
if [[ "\${1:-}" == devices ]]; then
  printf 'List of devices attached\\n'
  if [[ "$FAKE_DEVICE" == emulator ]]; then printf 'emulator-5554 device product:mock model:emulator\\n';
  else printf 'personal-device device product:phone model:personal\\n'; fi
  exit 0
fi
if [[ "\${1:-}" == install ]]; then
  if [[ "$FAKE_INSTALL_FAILURE" == app && "$3" == *app.apk ]] || [[ "$FAKE_INSTALL_FAILURE" == test && "$3" == *test.apk ]]; then exit 1; fi
  printf 'Success\\n'
  exit 0
fi
if [[ "\${1:-}" == shell && "\${2:-}" == run-as ]]; then
  if [[ "\${3:-}" == app.bookstr && "\${4:-}" == rm ]]; then rm -f "$FAKE_DEVICE_COVERAGE"; exit 0; fi
fi
if [[ "\${1:-}" == shell && "\${2:-}" == rm ]]; then exit 0; fi
if [[ "\${1:-}" == shell && "\${2:-}" == am && "\${3:-}" == instrument ]]; then
  cat "$FAKE_INSTRUMENTATION_LOG"
  case "$FAKE_COVERAGE_MODE" in
    write) printf 'fresh-coverage' > "$FAKE_DEVICE_COVERAGE" ;;
    empty) : > "$FAKE_DEVICE_COVERAGE" ;;
    absent) rm -f "$FAKE_DEVICE_COVERAGE" ;;
  esac
  exit "\${FAKE_INSTRUMENT_STATUS:-0}"
fi
if [[ "\${1:-}" == exec-out ]]; then
  if [[ "$FAKE_PULL_FAILURE" == true ]]; then exit 1; fi
  [[ -f "$FAKE_DEVICE_COVERAGE" ]] || exit 1
  cat "$FAKE_DEVICE_COVERAGE"
  exit 0
fi
if [[ "\${1:-}" == pull ]]; then
  target="\${@: -1}"
  mkdir -p "$target"
  printf 'png' > "$target/screenshot.png"
  exit 0
fi
exit 1
`);
  await chmod(adb, 0o755);
  await writeFile(deviceCoverage, 'stale-device-coverage');
  return {
    cwd,
    appApk,
    testApk,
    logPath,
    deviceCoverage,
    coverageFile,
    async run({ optIn = true, args = ['--prebuilt', appApk, testApk], ...overrides } = {}) {
      const env = {
        ...process.env,
        ANDROID_HOME: sdk,
        FAKE_ADB_LOG: logPath,
        FAKE_DEVICE_COVERAGE: deviceCoverage,
        FAKE_INSTRUMENTATION_LOG: instrumentationLog,
        FAKE_DEVICE: device === 'emulator' ? 'emulator' : 'physical',
        FAKE_COVERAGE_MODE: coverage === null ? 'absent' : coverage === '' ? '' : coverage === 'empty' ? 'empty' : 'write',
        FAKE_PULL_FAILURE: String(pullFailure),
        FAKE_INSTALL_FAILURE: installFailure,
        ...(optIn ? { BOOKSTR_COVERAGE_FILE: coverageFile } : {}),
        ...overrides,
      };
      return spawnSync('bash', [runner, ...args], { cwd, env, encoding: 'utf8' });
    },
    async calls() { return (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean); },
    async cleanup() { await rm(cwd, { recursive: true, force: true }); },
  };
}

test('prebuilt coverage succeeds, clears stale device data after installs, and atomically writes fresh bytes', async () => {
  const f = await fixture();
  try {
    const result = await f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(f.coverageFile, 'utf8'), 'fresh-coverage');
    const calls = await f.calls();
    const safety = calls.indexOf('devices -l');
    const appInstall = calls.indexOf(`install -r ${f.appApk}`);
    const testInstall = calls.indexOf(`install -r ${f.testApk}`);
    const clearCoverage = calls.indexOf('shell run-as app.bookstr rm -f files/bookstr-coverage.ec');
    const instrument = calls.indexOf('shell am instrument -w -r -e coverage true -e coverageFile /data/user/0/app.bookstr/files/bookstr-coverage.ec app.bookstr.test/androidx.test.runner.AndroidJUnitRunner');
    const pullCoverage = calls.indexOf('exec-out run-as app.bookstr cat files/bookstr-coverage.ec');
    assert.ok(safety >= 0 && appInstall > safety && testInstall > appInstall);
    assert.ok(clearCoverage > testInstall, 'old device coverage is removed only after both APK installs');
    assert.ok(instrument > clearCoverage);
    assert.ok(pullCoverage > instrument);
    assert.deepEqual((await readdir(join(f.cwd, 'coverage'))).filter(name => name.includes('.tmp.')), []);
  } finally {
    await f.cleanup();
  }
});

test('test failures remain failures while fresh partial coverage is still collected', async () => {
  const f = await fixture({ instrumentation: failedTestLog });
  try {
    const result = await f.run();
    assert.equal(result.status, 1);
    assert.match(await readFile(join(f.cwd, 'android/e2e-results/instrumentation.xml'), 'utf8'), /failures="1"/);
    assert.equal(await readFile(f.coverageFile, 'utf8'), 'fresh-coverage');
  } finally {
    await f.cleanup();
  }
});

test('parser failures remain failures while fresh coverage is still collected', async () => {
  const f = await fixture({ instrumentation: 'not instrumentation output' });
  try {
    const result = await f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No Android instrumentation protocol/);
    assert.equal(await readFile(f.coverageFile, 'utf8'), 'fresh-coverage');
  } finally {
    await f.cleanup();
  }
});

test('failed coverage pull fails the run and removes an older host coverage file', async () => {
  const f = await fixture({ pullFailure: true, hostCoverage: 'previous-run-coverage' });
  try {
    const result = await f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not pull fresh emulator coverage data/);
    await assert.rejects(readFile(f.coverageFile));
    assert.equal((await f.calls()).some(call => call.startsWith('pull ')), true, 'screenshots still pull after coverage failure');
  } finally {
    await f.cleanup();
  }
});

test('empty device coverage fails instead of saving an empty host artifact', async () => {
  const f = await fixture({ coverage: 'empty', hostCoverage: 'previous-run-coverage' });
  try {
    const result = await f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Emulator produced an empty coverage file/);
    await assert.rejects(readFile(f.coverageFile));
  } finally {
    await f.cleanup();
  }
});

test('coverage opt-in refuses physical devices before installs or device coverage deletion', async () => {
  const f = await fixture({ device: 'physical', hostCoverage: 'previous-run-coverage' });
  try {
    const result = await f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not an emulator/);
    assert.deepEqual(await f.calls(), ['devices -l']);
    await assert.rejects(readFile(f.coverageFile));
    assert.equal(await readFile(f.deviceCoverage, 'utf8'), 'stale-device-coverage');
  } finally {
    await f.cleanup();
  }
});

test('failed instrumentation APK installation preserves device coverage and skips the run', async () => {
  const f = await fixture({ installFailure: 'test', hostCoverage: 'previous-run-coverage' });
  try {
    const result = await f.run();
    assert.equal(result.status, 1);
    const calls = await f.calls();
    assert.ok(calls.includes(`install -r ${f.appApk}`));
    assert.ok(calls.includes(`install -r ${f.testApk}`));
    assert.equal(calls.some(call => call.includes('run-as app.bookstr rm -f files/bookstr-coverage.ec')), false);
    assert.equal(calls.some(call => call.includes('shell am instrument')), false);
    assert.equal(await readFile(f.deviceCoverage, 'utf8'), 'stale-device-coverage');
    await assert.rejects(readFile(f.coverageFile));
  } finally {
    await f.cleanup();
  }
});

test('coverage opt-in requires prebuilt mode without invoking adb', async () => {
  const f = await fixture();
  try {
    const result = await f.run({ args: [] });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires --prebuilt APP_APK TEST_APK/);
    await assert.rejects(readFile(f.logPath));
  } finally {
    await f.cleanup();
  }
});

test('prebuilt mode without coverage opt-in keeps instrumentation arguments and skips coverage operations', async () => {
  const f = await fixture();
  try {
    const result = await f.run({ optIn: false });
    assert.equal(result.status, 0, result.stderr);
    const calls = await f.calls();
    assert.ok(calls.includes('shell am instrument -w -r app.bookstr.test/androidx.test.runner.AndroidJUnitRunner'));
    assert.equal(calls.some(call => call.includes('coverageFile')), false);
    assert.equal(calls.some(call => call.startsWith('exec-out ')), false);
    assert.equal(calls.some(call => call.includes('run-as app.bookstr rm -f files/bookstr-coverage.ec')), false);
  } finally {
    await f.cleanup();
  }
});
