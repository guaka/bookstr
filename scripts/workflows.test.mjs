import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const readWorkflow = (name) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('repository hygiene rejects committed APKs and directs them to release assets', async () => {
  const workflow = await readWorkflow('ci.yml');
  assert.match(workflow, /tracked_apks="\$\(git ls-files '\*\.apk'\)"/);
  assert.match(workflow, /if \[ -n "\$tracked_apks" \]; then[\s\S]*?exit 1/);
  assert.match(workflow, /APK binaries must be published as GitHub Release assets/);
  const script = workflow.match(/      - name: Reject tracked APK binaries\n        run: \|\n([\s\S]*?)(?=\n  workflow-contracts:)/)[1]
    .replace(/^          /gm, '');
  for (const tracked of ['', 'android/bookstr.apk']) {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', 'git() { printf "%s" "$TRACKED_APKS"; }\n' + script], {
      encoding: 'utf8', env: { ...process.env, TRACKED_APKS: tracked },
    });
    assert.equal(result.status, tracked ? 1 : 0, result.stderr);
    assert.equal(result.stdout.includes('APK binaries must be published as GitHub Release assets'), Boolean(tracked));
  }
});

test('agent instructions require gradual coverage improvements without lowering thresholds', async () => {
  const instructions = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  assert.match(instructions, /Gradually increase coverage with each pull request/);
  assert.match(instructions, /existing uncovered behavior in the affected area/);
  assert.match(instructions, /Never lower coverage thresholds/);
});

test('web tests are gated by web-related path changes', async () => {
  const workflow = await readWorkflow('ci.yml');

  assert.match(workflow, /name: Detect web changes/);
  assert.match(workflow, /- 'web\/\*\*'/);
  assert.match(workflow, /- 'shared\/architecture\/\*\*'/);
  assert.match(workflow, /- 'shared\/coverage\/\*\*'/);
  assert.match(workflow, /- 'docs\/CLIENT_CAPABILITIES\.md'/);
  assert.match(workflow, /- 'scripts\/\*\*'/);
  assert.match(workflow, /node scripts\/generate-client-overview\.mjs --check/);
  assert.match(workflow, /node shared\/contracts\/generate-nostr-constants\.mjs --check/);
  assert.match(workflow, /--test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100 scripts\/coverage-ratchet\.test\.mjs/);
  assert.match(workflow, /shared\/contracts\/\*\.test\.mjs/);
  assert.match(workflow, /if: needs\.changes\.outputs\.web == 'true'/);
  assert.match(workflow, /repository-hygiene:/);
  assert.match(workflow, /name: Workflow contracts/);
  assert.match(
    workflow,
    /if: needs\.changes\.outputs\.workflows == 'true'/,
  );
});

test('Electron unit coverage and smoke results are published beside other clients', async () => {
  const workflow = await readWorkflow('ci.yml');
  const deploy = await readWorkflow('deploy-web.yml');

  assert.match(workflow, /electron: \$\{\{ steps\.filter\.outputs\.electron \}\}/);
  const electronJob = workflow.match(/^  electron:\n[\s\S]*$/m)?.[0];
  assert.ok(electronJob, 'Electron job exists');
  assert.match(electronJob, /uses: pnpm\/action-setup@v4/);
  assert.match(electronJob, /version: 10\.34\.8/);
  assert.match(electronJob, /package_json_file: desktop\/package\.json/);
  assert.match(electronJob, /cache: pnpm/);
  assert.ok(electronJob.indexOf('uses: pnpm/action-setup@v4') < electronJob.indexOf('uses: actions/setup-node@v4'));
  assert.match(electronJob, /pnpm install --frozen-lockfile/);
  assert.match(electronJob, /pnpm run typecheck/);
  assert.match(electronJob, /name: Upload Electron Playwright report\n        if: always\(\)\n        uses: actions\/upload-artifact@v4/);
  assert.match(electronJob, /path: desktop\/electron-playwright\.json/);
  assert.ok(electronJob.indexOf('pnpm install --frozen-lockfile') < electronJob.indexOf('pnpm run typecheck'));
  assert.match(electronJob, /pnpm run test:coverage:ci \| tee electron-tests\.tap/);
  assert.match(electronJob, /xvfb-run -a pnpm exec playwright test tests\/e2e\/desktop\.smoke\.spec\.js/);
  assert.doesNotMatch(electronJob, /\bnpm\b|\bnpx\b/);
  assert.match(workflow, /bookstr-e2e-screenshots-web-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /web\/test-results\/\*\*\/\*\.png/);
  assert.match(workflow, /bookstr-e2e-screenshots-electron-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /desktop\/test-results\/\*\*\/\*\.png/);
  assert.match(workflow, /--coverage-format node --coverage desktop\/electron-tests\.tap/);
  assert.match(workflow, /bookstr-test-overview-electron-\$\{\{ github\.run_id \}\}/);
  assert.match(deploy, /latest_run_with_artifact ci\.yml bookstr-test-overview-electron-/);
  assert.match(deploy, /pattern: bookstr-test-overview-electron-\*/);
});

test('Playwright captures every web and Electron e2e test for PR artifacts', async () => {
  const web = await readFile(new URL('../web/playwright.config.mjs', import.meta.url), 'utf8');
  const electron = await readFile(new URL('../desktop/playwright.config.js', import.meta.url), 'utf8');

  assert.match(web, /outputDir: 'test-results'/);
  assert.match(web, /screenshot: 'on'/);
  assert.match(electron, /outputDir: 'test-results'/);
  assert.match(electron, /screenshot: 'on'/);
});

test('trusted PR reporting publishes screenshot galleries on a reusable asset branch', async () => {
  const workflow = await readWorkflow('pr-coverage.yml');

  assert.match(workflow, /contents: write/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /pattern: bookstr-e2e-screenshots-\*/);
  assert.match(workflow, /path: e2e-screenshots/);
  assert.match(workflow, /publishScreenshotGallery/);
});

test('every client enforces the shared coverage baseline', async () => {
  const ci = await readWorkflow('ci.yml');
  const android = await readWorkflow('android.yml');
  const ios = await readWorkflow('ios.yml');

  assert.match(ci, /coverage-ratchet\.mjs --suite web --report test-overview\/web\.json/);
  assert.match(ci, /coverage-ratchet\.mjs --suite electron --report test-overview\/electron\.json/);
  assert.match(android, /- 'shared\/coverage\/\*\*'/);
  assert.match(android, /coverage-ratchet\.mjs --suite android --report test-overview\/android\.json/);
  assert.match(ios, /- 'shared\/coverage\/\*\*'/);
  assert.match(ios, /coverage-ratchet\.mjs --suite ios --report test-overview\/ios\.json/);
  assert.match(ios, /BookstrDebugLogTests/);
  assert.match(ios, /ReaderRelocationTests/);
  assert.match(ios, /NeuralSpeechSessionTests/);
  assert.match(ios, /ReaderPlaybackSessionTests/);
  assert.match(ios, /SnippetRepositoryTests/);
  assert.match(ios, /xcresulttool export attachments --path ios\/E2EResults\.xcresult --output-path ios\/e2e-screenshots/);
  assert.match(ios, /bookstr-e2e-screenshots-ios-\$\{\{ github\.run_id \}\}/);
});

test('CodeQL workflow is disabled', async () => {
  const workflows = await readdir(new URL('../.github/workflows/', import.meta.url));

  assert.equal(workflows.includes('codeql.yml'), false);
});

test('Android CI shares one cached Gradle invocation across unit build tasks', async () => {
  const workflow = await readWorkflow('android.yml');
  const properties = await readFile(new URL('../android/gradle.properties', import.meta.url), 'utf8');
  const e2eRunner = await readFile(new URL('../android/scripts/run-connected-e2e.sh', import.meta.url), 'utf8');
  const screenshotRule = await readFile(
    new URL('../android/app/src/androidTest/java/app/bookstr/E2eScreenshotRule.kt', import.meta.url),
    'utf8',
  );
  const libraryTests = await readFile(
    new URL('../android/app/src/androidTest/java/app/bookstr/ui/LibraryScreenTest.kt', import.meta.url),
    'utf8',
  );

  assert.match(properties, /^org\.gradle\.configuration-cache=true$/m);
  assert.match(
    workflow,
    /\.\/gradlew --no-daemon --continue testDebugUnitTest jacocoDebugUnitTestReport assembleDebug/,
  );
  assert.equal([...workflow.matchAll(/testDebugUnitTest/g)].length, 2);
  assert.equal([...workflow.matchAll(/jacocoDebugUnitTestReport/g)].length, 1);
  assert.equal([...workflow.matchAll(/assembleDebug/g)].length, 1);
  assert.match(workflow, /steps\.android_build\.outcome == 'success'/);
  assert.doesNotMatch(workflow, /steps\.(unit_tests|unit_coverage|assemble)\./);
  assert.match(workflow, /script: \.\/android\/scripts\/run-connected-e2e\.sh/);
  assert.match(workflow, /disk-size: 2048M/);
  assert.match(e2eRunner, /\.\/gradlew --no-daemon connectedDebugAndroidTest/);
  assert.match(e2eRunner, /adb pull "\$device_screenshot_dir\/\." "\$host_screenshot_dir"/);
  assert.match(e2eRunner, /Android e2e tests produced no screenshots/);
  assert.match(screenshotRule, /screencap -p \/sdcard\/e2e-screenshots\/\$testName\.png/);
  assert.match(libraryTests, /RuleChain\.outerRule\(composeRule\)\.around\(screenshots\)/);
  assert.match(workflow, /bookstr-e2e-screenshots-android-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /bookstr-e2e-screenshots-android-[\s\S]*if-no-files-found: error/);
});

test('Android CI rebuilds APKs for Android and bundled reader changes', async () => {
  const workflow = await readWorkflow('android.yml');
  const push = workflow.match(/^  push:\n([\s\S]*?)(?=^  pull_request:)/m)[1];
  const pullRequest = workflow.match(/^  pull_request:\n([\s\S]*?)(?=^  workflow_dispatch:)/m)[1];

  assert.match(push, /branches: \[main\]/);
  for (const trigger of [push, pullRequest]) {
    for (const path of [
      'android/**', 'shared/reader/**', 'web/reader-speech.js',
      'web/reader-typography.js', 'web/reader-chrome.js',
      'web/comic-reader.html', 'web/vendor/libarchive.js',
      'web/vendor/libarchive.wasm', '.github/workflows/android.yml',
    ]) {
      assert.ok(trigger.includes(`- '${path}'`), `${path} triggers an APK build`);
    }
  }
});

test('Android CI uploads the built APK before emulator tests with bounded retention', async () => {
  const workflow = await readWorkflow('android.yml');
  const upload = workflow.match(/      - name: Upload debug APK\n([\s\S]*?)(?=      - name:)/)[1];

  assert.match(upload, /if: steps\.android_build\.outcome == 'success'/);
  assert.match(upload, /uses: actions\/upload-artifact@v4/);
  assert.match(upload, /name: bookstr-android-debug-\$\{\{ github\.sha \}\}/);
  assert.match(upload, /path: android\/app\/build\/outputs\/apk\/debug\/\*\.apk/);
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /retention-days: 14/);
  assert.match(upload, /compression-level: 0/);
  assert.ok(workflow.indexOf('exit "$status"') < workflow.indexOf('name: Upload debug APK'));
  assert.ok(workflow.indexOf('name: Upload debug APK') < workflow.indexOf('name: Compose UI tests'));
  assert.match(workflow, /permissions:\n  contents: read/);
});

test('Android build documentation describes the CI artifact and signing constraints', async () => {
  const documentation = await readFile(new URL('../android/README.md', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(documentation, /actions\/workflows\/android\.yml/);
  assert.match(documentation, /bookstr-android-debug-<commit>/);
  assert.match(documentation, /14 days/);
  assert.match(documentation, /runner's debug signing key/);
  assert.match(documentation, /before emulator\ntests run/);
  assert.match(documentation, /In Obtainium,/);
  assert.match(readme, /https:\/\/github.com\/guaka\/bookstr` to \[Obtainium\]/);
  assert.match(documentation, /https:\/\/github.com\/guaka\/bookstr/);
  assert.match(documentation, /v0\.0\.3-ci\.<run number>/);
  for (const secret of ['BOOKSTR_KEYSTORE_BASE64', 'BOOKSTR_KEYSTORE_PASSWORD', 'BOOKSTR_KEY_ALIAS', 'BOOKSTR_KEY_PASSWORD']) {
    assert.ok(documentation.includes(secret));
  }
});

test('signed Android releases only run after checks on trusted main builds', async () => {
  const workflow = await readWorkflow('android.yml');
  const release = workflow.match(/^  release:\n[\s\S]*$/m)[0];

  assert.match(release, /needs: android/);
  assert.match(release, /if: github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\)/);
  assert.match(release, /permissions:\n      contents: write/);
  const jobEnvironment = release.match(/    env:\n([\s\S]*?)(?=    steps:)/)[1];
  assert.match(jobEnvironment, /BOOKSTR_KEYSTORE_FILE: \$\{\{ github\.workspace \}\}\/bookstr-release\.jks/);
  assert.doesNotMatch(jobEnvironment, /\$\{\{\s*runner\./);
  for (const secret of ['BOOKSTR_KEYSTORE_BASE64', 'BOOKSTR_KEYSTORE_PASSWORD', 'BOOKSTR_KEY_ALIAS', 'BOOKSTR_KEY_PASSWORD']) {
    assert.ok(release.includes(`secrets.${secret}`));
  }
  assert.match(release, /Missing repository secret: \$variable/);
  assert.match(release, /umask 077/);
  assert.match(release, /base64 --decode > "\$BOOKSTR_KEYSTORE_FILE"/);
  assert.match(release, /apksigner" verify --verbose app\/build\/outputs\/apk\/release\/app-release\.apk/);
  assert.match(release, /test "\$certificate" = c82e5af7122119c338db0af37cbf9efca1b6a0880e7b409f5537169fa6ffc477/);
  assert.match(release, /name: Remove release signing key\n        if: always\(\)/);
  assert.match(release, /rm -f "\$BOOKSTR_KEYSTORE_FILE"/);
});

test('Obtainium releases use unique increasing versions and latest APK assets', async () => {
  const workflow = await readWorkflow('android.yml');
  const gradle = await readFile(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8');
  const release = workflow.match(/^  release:\n[\s\S]*$/m)[0];

  assert.match(gradle, /versionCode = providers\.gradleProperty\("bookstr\.versionCode"\)\.orNull\?\.toInt\(\) \?: timestampVersionCode/);
  assert.match(gradle, /versionName = providers\.gradleProperty\("bookstr\.versionName"\)\.orNull \?: "0\.0\.3-\$versionTimestamp"/);
  assert.equal([...release.matchAll(/version="0\.0\.3-ci\.\$RUN_NUMBER"/g)].length, 2);
  assert.match(release, /code=\$\(\(1000000000 \+ RUN_NUMBER\)\)/);
  assert.match(release, /assembleRelease "-Pbookstr\.versionCode=\$code" "-Pbookstr\.versionName=\$version"/);
  assert.match(release, /--no-configuration-cache --max-workers=2 assembleRelease/);
  assert.match(release, /tag="v\$version"/);
  assert.match(release, /if gh release view "\$tag" >\/dev\/null 2>&1; then[\s\S]*?exit 0/);
  assert.match(release, /gh release create "\$tag" "android\/bookstr-\$version\.apk"/);
  assert.match(release, /--target "\$GITHUB_SHA"/);
  assert.match(release, /--latest/);
  assert.doesNotMatch(release, /--prerelease|--draft|assembleDebug/);
});

test('Obtainium publishing creates a latest release once and preserves existing releases', async () => {
  const workflow = await readWorkflow('android.yml');
  const script = workflow.match(/      - name: Publish Obtainium release\n[\s\S]*?        run: \|\n([\s\S]*?)(?=      - name:)/)[1]
    .replace(/^          /gm, '');
  const mock = `gh() {
    if [ "$1 $2" = "release view" ]; then return "$RELEASE_EXISTS_STATUS"; fi
    printf '%s\\n' "$@"
  }\n`;
  for (const exists of [false, true]) {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', mock + script], {
      encoding: 'utf8',
      env: { ...process.env, RUN_NUMBER: '42', GITHUB_SHA: 'abc123', GITHUB_REPOSITORY: 'guaka/bookstr', RELEASE_EXISTS_STATUS: exists ? '0' : '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    if (exists) {
      assert.equal(result.stdout.trim(), 'Release v0.0.3-ci.42 already exists.');
    } else {
      assert.match(result.stdout, /create\nv0\.0\.3-ci\.42\nandroid\/bookstr-0\.0\.3-ci\.42\.apk/);
      assert.match(result.stdout, /--target\nabc123/);
      assert.match(result.stdout, /--latest/);
      assert.match(result.stdout, /https:\/\/github.com\/guaka\/bookstr to Obtainium/);
    }
  }
});

test('release signing fails before writing a keystore when any secret is missing', async () => {
  const workflow = await readWorkflow('android.yml');
  const script = workflow.match(/      - name: Restore release signing key\n[\s\S]*?        run: \|\n([\s\S]*?)(?=      - uses:)/)[1]
    .replace(/^          /gm, '');
  const secrets = { BOOKSTR_KEYSTORE_BASE64: 'present', BOOKSTR_KEYSTORE_PASSWORD: 'present', BOOKSTR_KEY_ALIAS: 'present', BOOKSTR_KEY_PASSWORD: 'present' };
  for (const missing of Object.keys(secrets)) {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      encoding: 'utf8', env: { ...process.env, ...secrets, [missing]: '' },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), `Missing repository secret: ${missing}`);
    assert.equal(result.stdout, '');
  }
});

test('Pages deploys once after CI and does not cancel an active deploy', async () => {
  const workflow = await readWorkflow('deploy-web.yml');

  assert.doesNotMatch(workflow, /^  push:/m);
  assert.match(workflow, /workflows: \[CI\]/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(workflow, /workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /ref: main/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha/);
  assert.match(workflow, /deploy:[\s\S]*permissions:[\s\S]*pages: write[\s\S]*id-token: write/);
  assert.equal(
    [...workflow.matchAll(/uses: actions\/deploy-pages@v4/g)].length,
    1,
  );
});
