import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const helper = new URL('./publish-obtainium-release.sh', import.meta.url);

async function runPublisher({ exists = '0', size = 'missing', uploadFail = '0', uploadEmpty = '0', createEmpty = '0', createMissing = '0', createFail = '0', verifyFail = '0', removeApk = false, emptyApk = false, missingEnv = '', releaseVersion = '0.1-20261105-1932', runNumber = '42', releases = '[]' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bookstr-release-'));
  const apkDirectory = path.join(directory, 'android');
  const binDirectory = path.join(directory, 'bin');
  const stateFile = path.join(directory, 'release-state');
  const viewCountFile = path.join(directory, 'view-count');
  const logFile = path.join(directory, 'gh.log');
  const apkPath = path.join(apkDirectory, `bookstr-${releaseVersion}.apk`);
  const ghPath = path.join(binDirectory, 'gh');

  await Promise.all([mkdir(apkDirectory), mkdir(binDirectory)]);
  await writeFile(apkPath, 'signed apk bytes');
  await writeFile(stateFile, `${exists} ${size}\n`);
  await writeFile(viewCountFile, '0\n');
  await writeFile(ghPath, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$GH_LOG"
if [[ "$1" == "api" ]]; then
  printf '%s\\n' "$GH_RELEASES"
elif [[ "$1 $2" == "release view" ]]; then
  view_count=$(($(cat "$GH_VIEW_COUNT") + 1))
  printf '%s\\n' "$view_count" > "$GH_VIEW_COUNT"
  [[ "$VERIFY_FAIL" == 0 || "$view_count" == 1 ]] || exit 1
  read -r current_exists current_size < "$GH_STATE"
  [[ "$current_exists" == 1 ]] || exit 1
  if [[ "$current_size" != missing ]]; then
    printf '%s\\t%s\\n' "$EXPECTED_ASSET" "$current_size"
  fi
elif [[ "$1 $2" == "release create" ]]; then
  [[ "$CREATE_FAIL" == 0 ]] || exit 1
  read -r current_exists _ < "$GH_STATE"
  [[ "$current_exists" == 0 ]] || exit 1
  if [[ "$CREATE_MISSING" == 1 ]]; then
    printf '1 missing\\n' > "$GH_STATE"
  elif [[ "$CREATE_EMPTY" == 1 ]]; then
    printf '1 0\\n' > "$GH_STATE"
  else
    printf '1 %s\\n' "$(wc -c < "$4" | tr -d ' ')" > "$GH_STATE"
  fi
elif [[ "$1 $2" == "release upload" ]]; then
  [[ "$UPLOAD_FAIL" == 0 ]] || exit 1
  read -r current_exists _ < "$GH_STATE"
  [[ "$current_exists" == 1 ]] || exit 1
  if [[ "$UPLOAD_EMPTY" == 1 ]]; then
    printf '1 0\\n' > "$GH_STATE"
  else
    printf '1 %s\\n' "$(wc -c < "$4" | tr -d ' ')" > "$GH_STATE"
  fi
else
  exit 2
fi
`);
  await chmod(ghPath, 0o755);
  if (removeApk) await unlink(apkPath);
  if (emptyApk) await writeFile(apkPath, '');

  const env = {
    ...process.env,
    PATH: `${binDirectory}:${process.env.PATH}`,
    GH_LOG: logFile,
    GH_STATE: stateFile,
    GH_VIEW_COUNT: viewCountFile,
    EXPECTED_ASSET: path.basename(apkPath),
    RELEASE_VERSION: releaseVersion,
    RUN_NUMBER: runNumber,
    RUN_ID: '90042',
    GITHUB_SHA: 'abc123',
    GITHUB_REPOSITORY: 'guaka/bookstr',
    GH_RELEASES: releases,
    UPLOAD_FAIL: uploadFail,
    UPLOAD_EMPTY: uploadEmpty,
    CREATE_EMPTY: createEmpty,
    CREATE_MISSING: createMissing,
    CREATE_FAIL: createFail,
    VERIFY_FAIL: verifyFail,
  };
  if (missingEnv) delete env[missingEnv];
  const result = spawnSync('bash', [helper.pathname], {
    cwd: directory,
    encoding: 'utf8',
    env,
  });
  const log = await readFile(logFile, 'utf8').catch(() => '');
  const state = await readFile(stateFile, 'utf8');
  await rm(directory, { recursive: true, force: true });
  return { ...result, log, state };
}

test('creates a release with its signed APK and verifies the asset', async () => {
  const result = await runPublisher();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /^release create v0\.1-20261105-1932 android\/bookstr-0\.1-20261105-1932\.apk/m);
  assert.match(result.log, /--latest/);
  assert.match(result.log, /Bookstr Android workflow run ID: 90042/);
  assert.match(result.log, /Bookstr Android version code: 1000000042/);
  assert.match(result.stdout, /Verified bookstr-0\.1-20261105-1932\.apk on release v0\.1-20261105-1932/);
  assert.match(result.state, /^1 16$/m);
});

test('older retries create their release without marking it latest', async () => {
  const result = await runPublisher({ releases: JSON.stringify([
    { tagName: 'v0.1-20261105-1940', body: 'Bookstr Android run number: 43', draft: false, prerelease: false },
  ]) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /--latest=false/);
  assert.doesNotMatch(result.log, /--latest(?: |\\n|$)/);
});

test('preserves an existing nonempty APK without creating or replacing assets', async () => {
  const result = await runPublisher({ exists: '1', size: '2048' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already has a nonempty/);
  assert.doesNotMatch(result.log, /release (create|upload)/);
});

test('uploads the expected APK to an existing release when it is missing', async () => {
  const result = await runPublisher({ exists: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /^release upload v0\.1-20261105-1932 android\/bookstr-0\.1-20261105-1932\.apk$/m);
  assert.match(result.stdout, /Verified bookstr-0\.1-20261105-1932\.apk/);
  assert.match(result.state, /^1 16$/m);
});

test('replaces an empty expected asset and verifies the replacement', async () => {
  const result = await runPublisher({ exists: '1', size: '0' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /^release upload v0\.1-20261105-1932 android\/bookstr-0\.1-20261105-1932\.apk --clobber$/m);
  assert.match(result.state, /^1 16$/m);
});

test('fails when uploading the repair fails', async () => {
  const result = await runPublisher({ exists: '1', uploadFail: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.log, /release upload/);
  assert.match(result.state, /^1 missing$/m);
});

test('fails if publishing completes without a nonempty expected asset', async () => {
  const result = await runPublisher({ exists: '1', uploadEmpty: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not contain a nonempty/);
});

test('fails if a newly created release has an empty expected asset', async () => {
  const result = await runPublisher({ createEmpty: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not contain a nonempty/);
});

test('fails if the release exists after creation but has no expected APK', async () => {
  const result = await runPublisher({ createMissing: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not contain a nonempty/);
});

test('requires the version and release identity environment', async () => {
  for (const variable of ['RUN_NUMBER', 'RUN_ID', 'RELEASE_VERSION', 'GITHUB_SHA', 'GITHUB_REPOSITORY']) {
    const result = await runPublisher({ missingEnv: variable });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`${variable} is required`));
    assert.equal(result.log, '');
  }
});

test('refuses to publish a missing or empty local APK', async () => {
  for (const options of [{ removeApk: true }, { emptyApk: true }]) {
    const result = await runPublisher(options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release APK is missing or empty/);
    assert.equal(result.log, '');
  }
});

test('does not claim success when the release cannot be verified', async () => {
  const result = await runPublisher({ exists: '0', verifyFail: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not verify release/);
});

test('propagates release creation failures', async () => {
  const result = await runPublisher({ createFail: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.log, /release create/);
});
