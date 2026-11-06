import { present } from '../../web/tests/test-values.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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

async function fixture({ device = 'emulator', instrumentation = passLog, coverage = 'fresh-coverage', pullFailure = false, nativePullFailure = false, installFailure = '', hostCoverage = null }: {device?: string; instrumentation?: string; coverage?: string | null; pullFailure?: boolean; nativePullFailure?: boolean; installFailure?: string; hostCoverage?: string | null} = {}) {
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
  const fakeApp = join(cwd, 'fake-app');
  const nativeProfile = join(fakeApp, 'cache', 'bookstr-native-coverage-1.profraw');
  const nativeOutput = join(cwd, 'native-coverage');
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
if [[ "\${1:-}" == -s ]]; then shift 2; fi
if [[ "\${1:-}" == devices ]]; then
  printf 'List of devices attached\\n'
  if [[ "$FAKE_DEVICE" == emulator ]]; then printf 'emulator-5554 device product:mock model:emulator\\n';
  else printf 'personal-device device product:phone model:personal\\n'; fi
  exit 0
fi
if [[ "\${1:-}" == get-state ]]; then printf 'device\\n'; exit 0; fi
if [[ "\${1:-}" == get-serialno ]]; then printf '%s\\n' "\${FAKE_SERIAL:-emulator-5554}"; exit 0; fi
if [[ "\${1:-}" == install ]]; then
  if [[ "$FAKE_INSTALL_FAILURE" == app && "$3" == *app.apk ]] || [[ "$FAKE_INSTALL_FAILURE" == test && "$3" == *test.apk ]]; then exit 1; fi
  printf 'Success\\n'
  exit 0
fi
if [[ "\${1:-}" == shell && "\${2:-}" == run-as ]]; then
  if [[ "\${3:-}" == app.bookstr && "\${4:-}" == rm ]]; then
    if [[ "$5" == *.profraw ]]; then rm -f "$FAKE_APP/$5"; else rm -f "$FAKE_DEVICE_COVERAGE"; fi
    exit 0
  fi
  if [[ "\${3:-}" == app.bookstr && "\${4:-}" == mkdir ]]; then
    shift 5
    for directory in "$@"; do mkdir -p "$FAKE_APP/$directory"; done
    exit 0
  fi
  if [[ "\${3:-}" == app.bookstr && "\${4:-}" == find ]]; then
    directory="$FAKE_APP/$5"
    find "$directory" -type f -name 'bookstr-native-coverage-*.profraw' -print | sed "s#^$FAKE_APP/##"
    exit 0
  fi
fi
if [[ "\${1:-}" == shell && "\${2:-}" == rm ]]; then exit 0; fi
if [[ "\${1:-}" == shell && "\${2:-}" == am && "\${3:-}" == instrument ]]; then
  cat "$FAKE_INSTRUMENTATION_LOG"
  case "$FAKE_COVERAGE_MODE" in
    write) printf 'fresh-coverage' > "$FAKE_DEVICE_COVERAGE" ;;
    empty) : > "$FAKE_DEVICE_COVERAGE" ;;
    absent) rm -f "$FAKE_DEVICE_COVERAGE" ;;
  esac
  [[ -z "$FAKE_NATIVE_PROFILE" ]] || { mkdir -p "$(dirname "$FAKE_NATIVE_PROFILE")"; printf 'fresh-native-profile' > "$FAKE_NATIVE_PROFILE"; }
  exit "\${FAKE_INSTRUMENT_STATUS:-0}"
fi
if [[ "\${1:-}" == exec-out ]]; then
  if [[ "$FAKE_PULL_FAILURE" == true ]]; then exit 1; fi
  if [[ "\${*: -1}" == *.profraw ]]; then
    [[ "$FAKE_NATIVE_PULL_FAILURE" != true ]] || exit 1
    [[ -f "$FAKE_NATIVE_PROFILE" ]] || exit 1
    cat "$FAKE_NATIVE_PROFILE"
    exit 0
  fi
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
    nativeOutput,
    async run({ optIn = true, nativeCoverage = false, args = ['--prebuilt', appApk, testApk], ...overrides }: {optIn?: boolean; nativeCoverage?: boolean; args?: string[]; ANDROID_SERIAL?: string; FAKE_INSTRUMENT_STATUS?: string} = {}) {
      const env = {
        ...process.env,
        ANDROID_HOME: sdk,
        FAKE_ADB_LOG: logPath,
        FAKE_DEVICE_COVERAGE: deviceCoverage,
        FAKE_APP: fakeApp,
        FAKE_NATIVE_PROFILE: nativeCoverage ? nativeProfile : '',
        FAKE_INSTRUMENTATION_LOG: instrumentationLog,
        FAKE_DEVICE: device === 'emulator' ? 'emulator' : 'physical',
        FAKE_COVERAGE_MODE: coverage === null ? 'absent' : coverage === '' ? '' : coverage === 'empty' ? 'empty' : 'write',
        FAKE_PULL_FAILURE: String(pullFailure),
        FAKE_NATIVE_PULL_FAILURE: String(nativePullFailure),
        FAKE_SERIAL: overrides.ANDROID_SERIAL || 'emulator-5554',
        FAKE_INSTALL_FAILURE: installFailure,
        ...(optIn ? { BOOKSTR_COVERAGE_FILE: coverageFile } : {}),
        ...(nativeCoverage ? { BOOKSTR_NATIVE_PROFILE_OUTPUT: nativeOutput } : {}),
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
    const instrument = calls.indexOf('shell am instrument -w -r -e coverage true -e coverageFile /data/user/0/app.bookstr/files/bookstr-coverage.ec app.bookstr.test/app.bookstr.BookstrTestRunner');
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

test('native coverage prepares after installs and collects a fresh profile after instrumentation', async () => {
  const f = await fixture({ instrumentation: failedTestLog });
  try {
    const result = await f.run({ nativeCoverage: true });
    assert.equal(result.status, 1, 'instrumentation failures remain visible');
    const profilePath = join(f.nativeOutput, 'raw/cache/bookstr-native-coverage-1.profraw');
    assert.ok(existsSync(profilePath), `${result.stderr}\n${await f.calls().then(calls => calls.join('\n'))}`);
    assert.equal(await readFile(profilePath, 'utf8'), 'fresh-native-profile');
    assert.equal(await readFile(join(f.nativeOutput, 'native-coverage-collected.marker'), 'utf8'), 'collected\n');
    const calls = await f.calls();
    const safety = calls.indexOf('devices -l');
    const appInstall = calls.indexOf(`install -r ${f.appApk}`);
    const testInstall = calls.indexOf(`install -r ${f.testApk}`);
    const prepare = calls.findIndex(call => call.includes('shell run-as app.bookstr mkdir -p cache files/torrent-downloads'));
    const instrument = calls.indexOf('shell am instrument -w -r -e coverage true -e coverageFile /data/user/0/app.bookstr/files/bookstr-coverage.ec app.bookstr.test/app.bookstr.BookstrTestRunner');
    const listProfiles = present(calls.map((call, index) => call.includes('find cache -type f -name bookstr-native-coverage-*.profraw') ? index : -1).filter(index => index >= 0).at(-1));
    const pullProfile = calls.findIndex(call => call.includes('cat cache/bookstr-native-coverage-1.profraw'));
    assert.ok(safety >= 0 && appInstall > safety && testInstall > appInstall);
    assert.ok(prepare > testInstall, 'profile preparation happens after both APK installs');
    assert.ok(instrument > prepare);
    assert.ok(listProfiles > instrument && pullProfile > listProfiles, `fresh profiles are collected after instrumentation; calls: ${calls.join(' | ')}`);
  } finally {
    await f.cleanup();
  }
});

test('native coverage honors ANDROID_SERIAL when selecting among emulators', async () => {
  const f = await fixture();
  try {
    const result = await f.run({ nativeCoverage: true, ANDROID_SERIAL: 'emulator-5556' });
    assert.equal(result.status, 0, result.stderr);
    const calls = await f.calls();
    assert.ok(calls.some(call => call.startsWith('-s emulator-5556 get-state')));
    assert.ok(calls.some(call => call.startsWith('-s emulator-5556 shell run-as app.bookstr mkdir')));
  } finally {
    await f.cleanup();
  }
});

test('native coverage refuses a selected physical serial before installation', async () => {
  const f = await fixture();
  try {
    const result = await f.run({ nativeCoverage: true, ANDROID_SERIAL: 'personal-device' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires the selected Android emulator/);
    const calls = await f.calls();
    assert.equal(calls.some(call => call.startsWith('install -r ')), false);
    assert.equal(calls.some(call => call.includes('shell am instrument')), false);
  } finally {
    await f.cleanup();
  }
});

test('native collection failure leaves no freshness marker or partial raw tree', async () => {
  const f = await fixture({ nativePullFailure: true });
  try {
    const result = await f.run({ nativeCoverage: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not collect fresh native coverage profiles/);
    await assert.rejects(readFile(join(f.nativeOutput, 'native-coverage-collected.marker')));
    await assert.rejects(readFile(join(f.nativeOutput, 'raw/cache/bookstr-native-coverage-1.profraw')));
    assert.deepEqual((await readdir(f.nativeOutput)).filter(name => name.startsWith('.raw-staging.')), []);
  } finally {
    await f.cleanup();
  }
});

test('stale raw profiles prevent collection, clear only freshness marker, and remain untouched', async () => {
  const f = await fixture();
  try {
    const staleRaw = join(f.nativeOutput, 'raw', 'cache', 'bookstr-native-coverage-old.profraw');
    const unrelated = join(f.nativeOutput, 'unrelated.txt');
    const marker = join(f.nativeOutput, 'native-coverage-collected.marker');
    await mkdir(dirname(staleRaw), { recursive: true });
    await Promise.all([
      writeFile(staleRaw, 'old profile'),
      writeFile(unrelated, 'keep'),
      writeFile(marker, 'old marker'),
    ]);
    const result = await f.run({ nativeCoverage: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to overwrite existing native profiles/);
    await assert.rejects(readFile(marker));
    assert.equal(await readFile(staleRaw, 'utf8'), 'old profile');
    assert.equal(await readFile(unrelated, 'utf8'), 'keep');
    assert.equal(existsSync(f.logPath), false, 'stale host data is rejected before adb is invoked');
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

test('nonzero instrumentation exit remains a failure despite a passing protocol and fresh coverage', async () => {
  const f = await fixture();
  try {
    const result = await f.run({ FAKE_INSTRUMENT_STATUS: '7' });
    assert.equal(result.status, 1);
    assert.match(await readFile(join(f.cwd, 'android/e2e-results/instrumentation.xml'), 'utf8'), /failures="0"/);
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
    assert.ok(calls.includes('shell am instrument -w -r app.bookstr.test/app.bookstr.BookstrTestRunner'));
    assert.equal(calls.some(call => call.includes('coverageFile')), false);
    assert.equal(calls.some(call => call.startsWith('exec-out ')), false);
    assert.equal(calls.some(call => call.includes('run-as app.bookstr rm -f files/bookstr-coverage.ec')), false);
  } finally {
    await f.cleanup();
  }
});
