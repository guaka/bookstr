import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

test('Android APK builds have separate sequential steps on the same runner', async () => {
  const workflow = await readWorkflow('android.yml');
  const packaging = workflow.match(/^  package-apks:\n([\s\S]*?)(?=^  emulator-tests:)/m)[1];
  assert.match(packaging, /^    name: Build debug app and test APKs$/m);
  const builds = [...packaging.matchAll(/      - name: (Build[^\n]+)\n        working-directory: android\n        run: (.+)/g)];
  assert.deepEqual(builds.map(match => [match[1], match[2]]), [
    ['Build debug app APK', './gradlew --no-daemon --max-workers=2 assembleDebug -Pbookstr.abis=x86_64 -Pbookstr.cxxCompilerLauncher=ccache'],
    ['Build instrumentation test APK', './gradlew --no-daemon --max-workers=2 assembleDebugAndroidTest -Pbookstr.abis=x86_64 -Pbookstr.cxxCompilerLauncher=ccache'],
  ]);
  assert.ok(packaging.indexOf('name: Stage prebuilt APKs') > builds[1].index);
  assert.match(packaging, /name: Upload prebuilt APKs[\s\S]*?compression-level: 0/);
});

test('Android CI caches Gradle and native compilation while preserving universal releases', async () => {
  const workflow = await readWorkflow('android.yml');
  assert.equal((workflow.match(/uses: gradle\/actions\/setup-gradle@v4/g) || []).length, 3);
  assert.doesNotMatch(workflow, /cache: gradle/);
  assert.match(workflow, /node --test --test-concurrency=1 android\/scripts\/build-configuration\.test\.mjs/);
  assert.match(workflow, /CCACHE_COMPILERCHECK: content/);
  assert.match(workflow, /CCACHE_MAXSIZE: 1G/);
  for (const [job, variant] of [['package-apks', 'debug-x86_64'], ['release', 'release-universal']]) {
    const source = workflow.slice(workflow.indexOf(`  ${job}:`)).split(/\n  [a-z-]+:\n/)[0];
    assert.match(source, /apt-get install -y libboost-dev ccache/);
    assert.match(source, /name: Restore native compiler cache\n        uses: actions\/cache@v4/);
    assert.match(source, /path: \$\{\{ env\.CCACHE_DIR \}\}/);
    assert.ok(source.includes(`-android-ccache-${variant}-v1-`));
    assert.match(source, /hashFiles\('android\/gradle\/wrapper\/gradle-wrapper\.properties', 'android\/app\/build\.gradle\.kts', 'android\/app\/src\/main\/cpp\/CMakeLists\.txt'\)/);
    assert.match(source, /ccache --zero-stats/);
    assert.match(source, /name: Report native cache statistics\n        if: always\(\)\n        run: ccache --show-stats/);
  }
  const release = workflow.slice(workflow.indexOf('  release:'));
  assert.match(release, /assembleRelease -Pbookstr.cxxCompilerLauncher=ccache/);
  assert.doesNotMatch(release, /-Pbookstr\.abis/);
});

test('Android CI has four ordered jobs and the emulator consumes prebuilt APKs', async () => {
  const workflow = await readWorkflow('android.yml');
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
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
  assert.deepEqual([...workflow.matchAll(/^  ([a-z-]+):\n    name:/gm)].map((match) => match[1]).filter((name) => name !== 'changes'), [
    'unit-tests', 'package-apks', 'emulator-tests', 'release',
  ]);
  assert.match(workflow, /testDebugUnitTest jacocoDebugUnitTestReport/);
  assert.match(workflow, /node --test --experimental-test-coverage --test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100 android\/scripts\/instrumentation-results\.test\.mjs/);
  assert.match(workflow, /run: \.\/gradlew --no-daemon --max-workers=2 assembleDebug -Pbookstr.abis=x86_64 -Pbookstr.cxxCompilerLauncher=ccache\n/);
  assert.match(workflow, /needs: unit-tests/);
  assert.match(workflow, /needs: package-apks/);
  assert.match(workflow, /needs: \[unit-tests, package-apks, emulator-tests\]/);
  const emulatorJob = workflow.match(/^  emulator-tests:\n([\s\S]*?)(?=^  release:)/m)[1];
  assert.match(emulatorJob, /script: \|\n[\s\S]*\.\/android\/scripts\/run-connected-e2e\.sh --prebuilt android\/prebuilt-apks\/app-debug\.apk android\/prebuilt-apks\/app-debug-androidTest\.apk/);
  assert.match(workflow, /profile: pixel_2/);
  assert.match(workflow, /-memory 2048 -cores 2/);
  assert.match(workflow, /window_animation_scale 0/);
  assert.doesNotMatch(emulatorJob, /connectedDebugAndroidTest|assembleDebugAndroidTest|gradlew/);
  assert.match(e2eRunner, /require-emulator\.sh/);
  assert.match(e2eRunner, /install -r "\$app_apk"/);
  assert.match(e2eRunner, /install -r "\$test_apk"/);
  assert.match(e2eRunner, /shell am instrument -w -r app\.bookstr\.test\/androidx\.test\.runner\.AndroidJUnitRunner/);
  assert.match(e2eRunner, /rm -f "\$results_dir\/instrumentation\.log"/);
  assert.match(ignore, /^\/android\/e2e-results\/$/m);
  assert.match(ignore, /^\/android\/e2e-screenshots\/$/m);
  assert.match(e2eRunner, /instrumentation-results\.mjs/);
  assert.match(e2eRunner, /instrumentation\.started/);
  assert.match(emulatorJob, /hashFiles\('android\/e2e-results\/instrumentation\.started'\) != ''/);
  assert.match(workflow, /name: Record Android unit test overview\n        if: always\(\) && hashFiles\('android\/app\/build\/test-results\/testDebugUnitTest\/TEST-\*\.xml'\) != ''/);
  assert.match(emulatorJob, /name: Upload Android UI results[\s\S]*?path: android\/e2e-results\//);
  const uploads = [...workflow.matchAll(/uses: actions\/upload-artifact@v4\n([\s\S]*?)(?=\n      - |\n  [a-z-]+:|$)/g)];
  assert.equal(uploads.length, 7);
  for (const upload of uploads) assert.match(upload[1], /overwrite: true/);
  assert.match(e2eRunner, /\$adb_path" pull "\$device_screenshot_dir\/\." "\$host_screenshot_dir"/);
  assert.match(e2eRunner, /Android e2e tests produced no screenshots/);
  assert.match(screenshotRule, /screencap -p \/sdcard\/e2e-screenshots\/\$testName\.png/);
  assert.match(libraryTests, /RuleChain\.outerRule\(composeRule\)\.around\(screenshots\)/);
  assert.match(workflow, /bookstr-e2e-screenshots-android-\$\{\{ github\.run_id \}\}/);
});

test('prebuilt Android runner checks emulator safety before installs and preserves test failures', async () => {
  const root = await mkdtemp(join(process.cwd(), '.tmp-prebuilt-runner-'));
  const bin = join(root, 'bin');
  const sdk = join(root, 'sdk');
  const apkDir = join(root, 'apks');
  await mkdir(join(bin), { recursive: true });
  await mkdir(join(sdk, 'platform-tools'), { recursive: true });
  await mkdir(apkDir);
  const app = join(apkDir, 'app.apk');
  const instrumentation = join(apkDir, 'test.apk');
  await writeFile(app, 'apk');
  await writeFile(instrumentation, 'apk');
  const adbLog = join(root, 'adb.log');
  const adbStub = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$MOCK_ADB_LOG"
if [[ "$1" == devices ]]; then echo 'List of devices attached'; printf '%s\\n' "\${MOCK_DEVICE_OUTPUT:-emulator-5554 device product:emu}"; exit 0; fi
if [[ "$1" == pull ]]; then mkdir -p "$3"; touch "$3/shot.png"; exit 0; fi
if [[ "$1" == install ]]; then exit "\${MOCK_INSTALL_STATUS:-0}"; fi
if [[ "$1" == shell && "$2" == am ]]; then echo 'INSTRUMENTATION_STATUS_CODE: 0'; echo 'INSTRUMENTATION_CODE: -1'; exit "\${MOCK_ADB_STATUS:-0}"; fi
exit 0
`;
  await writeFile(join(sdk, 'platform-tools', 'adb'), adbStub);
  await writeFile(join(bin, 'adb'), adbStub);
  await writeFile(join(bin, 'node'), `#!/usr/bin/env bash
exit "\${MOCK_PARSER_STATUS:-0}"
`);
  await import('node:fs/promises').then(({ chmod }) => Promise.all([
    chmod(join(sdk, 'platform-tools', 'adb'), 0o755), chmod(join(bin, 'adb'), 0o755), chmod(join(bin, 'node'), 0o755),
  ]));
  const runner = new URL('../android/scripts/run-connected-e2e.sh', import.meta.url).pathname;
  try {
    for (const [adbStatus, parserStatus, installStatus, deviceOutput, usePathAdb, expected] of [
      [0, 0, 0, 'emulator-5554 device product:emu', false, 0],
      [0, 1, 0, 'emulator-5554 device product:emu', false, 1],
      [7, 0, 0, 'emulator-5554 device product:emu', false, 1],
      [0, 0, 5, 'emulator-5554 device product:emu', false, 1],
      [0, 0, 0, 'emulator-5554 device product:emu', true, 0],
      [0, 0, 0, 'personal-phone device product:phone', false, 1],
    ]) {
      await rm(adbLog, { force: true });
      const environment = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ANDROID_HOME: sdk,
        MOCK_ADB_LOG: adbLog,
        MOCK_ADB_STATUS: String(adbStatus),
        MOCK_PARSER_STATUS: String(parserStatus),
        MOCK_INSTALL_STATUS: String(installStatus),
        MOCK_DEVICE_OUTPUT: deviceOutput,
      };
      if (usePathAdb) delete environment.ANDROID_HOME;
      const result = spawnSync('bash', [runner, '--prebuilt', app, instrumentation], {
        cwd: root,
        encoding: 'utf8',
        env: environment,
      });
      assert.equal(result.status, expected, result.stderr);
      const commands = (await readFile(adbLog, 'utf8')).trim().split('\n');
      assert.match(commands[0], /^devices -l$/);
      if (deviceOutput.startsWith('emulator-')) {
        if (installStatus === 0) {
          assert.ok(commands.indexOf(`install -r ${app}`) > 0);
          assert.ok(commands.indexOf(`install -r ${instrumentation}`) > 0);
          assert.ok(commands.some((command) => command.startsWith('shell am instrument -w -r ')));
        } else {
          assert.ok(commands.indexOf(`install -r ${app}`) > 0);
          assert.equal(commands.some((command) => command.startsWith('shell am instrument ')), false);
          assert.equal(result.stdout.includes('INSTRUMENTATION_STATUS_CODE'), false);
          assert.equal(await import('node:fs/promises').then(({ access }) => access(join(root, 'android/e2e-results/instrumentation.started')).then(() => true, () => false)), false);
        }
        assert.ok(commands.some((command) => command.startsWith('pull /sdcard/e2e-screenshots/. ')));
      } else {
        assert.equal(commands.some((command) => command.startsWith('install ')), false);
        assert.match(result.stderr, /is not an emulator/);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Android CI rebuilds APKs for Android and bundled reader changes', async () => {
  const workflow = await readWorkflow('android.yml');
  const push = workflow.match(/^  push:\n([\s\S]*?)(?=^  pull_request:)/m)[1];
  const pullRequest = workflow.match(/^  changes:\n([\s\S]*?)(?=^  unit-tests:)/m)[1];

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

test('required native checks are always reported and route only relevant PR paths', async () => {
  for (const [file, platform, job] of [['android.yml', 'android', 'unit-tests'], ['ios.yml', 'ios', 'ios']]) {
    const workflow = await readWorkflow(file);
    const push = workflow.match(/^  push:\n([\s\S]*?)(?=^  pull_request:)/m)[1];
    const routing = workflow.match(/^  changes:\n([\s\S]*?)(?=^  (?:unit-tests|ios):)/m)[1];
    assert.match(workflow, /  pull_request:\n  workflow_dispatch:/);
    assert.doesNotMatch(workflow, /pull_request:\n    paths:/);
    assert.match(routing, /runs-on: ubuntu-latest/);
    assert.match(routing, /permissions:\n      contents: read\n      pull-requests: read/);
    assert.match(routing, /dorny\/paths-filter@0e4a8c6effa4802afeda77dc8d303f8176d7dfad/);
    assert.match(routing, /if: github\.event_name == 'pull_request'/);
    assert.ok(routing.includes(`github.event_name != 'pull_request' || steps.filter.outputs.${platform} == 'true'`));
    const paths = (text) => [...text.matchAll(/- '([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(paths(routing), paths(push));
    const native = workflow.slice(workflow.indexOf(`  ${job}:\n`));
    assert.match(native, /needs: changes/);
    assert.ok(native.includes(`if: needs.changes.outputs.${platform} == 'true'`));
  }
});

test('main protection names real workflow jobs and requires trusted up-to-date checks', async () => {
  const policy = JSON.parse(await readFile(new URL('../.github/required-checks.json', import.meta.url), 'utf8'));
  assert.equal(policy.strict_required_status_checks_policy, true);
  assert.equal(policy.do_not_enforce_on_create, false);
  const workflows = await Promise.all(['ci.yml', 'android.yml', 'ios.yml'].map(readWorkflow));
  const jobNames = workflows.flatMap((workflow) => [...workflow.matchAll(/^    name: (.+)$/gm)].map((match) => match[1]));
  const required = policy.required_status_checks.map((check) => check.context);
  assert.equal(required.length, 11);
  assert.equal(new Set(required).size, 11);
  for (const check of policy.required_status_checks) {
    assert.equal(check.integration_id, 15368);
    assert.equal(jobNames.filter((name) => name === check.context).length, 1, `${check.context} names exactly one job`);
  }
  for (const context of ['Detect web changes', 'Route Android checks', 'Route iOS checks', 'Emulator UI tests', 'iOS']) {
    assert.ok(required.includes(context), `${context} cannot fail while descendants are skipped`);
  }
  assert.doesNotMatch(required.join('\n'), /Publish Android APK/);
  assert.match(workflows[0], /- '\.github\/required-checks\.json'/);
  assert.match(await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8'), /Keep required workflow job names aligned with `\.github\/required-checks\.json`/);
});

test('Android CI uploads both APKs with bounded retention before emulator tests', async () => {
  const workflow = await readWorkflow('android.yml');
  const upload = workflow.match(/      - name: Upload prebuilt APKs\n([\s\S]*?)(?=\n  emulator-tests:)/)[1];

  assert.match(upload, /uses: actions\/upload-artifact@v4/);
  assert.match(upload, /name: bookstr-android-apks-\$\{\{ github\.sha \}\}/);
  assert.match(upload, /path: android\/prebuilt-apks\/\*\.apk/);
  const staging = workflow.match(/      - name: Stage prebuilt APKs\n        run: \|\n([\s\S]*?)(?=      - name: Upload prebuilt APKs)/)[1];
  assert.match(staging, /app\/build\/outputs\/apk\/debug\/app-debug\.apk android\/prebuilt-apks\/app-debug\.apk/);
  assert.match(staging, /app\/build\/outputs\/apk\/androidTest\/debug\/app-debug-androidTest\.apk android\/prebuilt-apks\/app-debug-androidTest\.apk/);
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /retention-days: 14/);
  assert.match(upload, /compression-level: 0/);
  assert.ok(workflow.indexOf('name: Upload prebuilt APKs') < workflow.indexOf('name: Run UI tests against prebuilt APKs'));
  assert.match(workflow, /permissions:\n  contents: read/);
});

test('Android build documentation describes the CI artifact and signing constraints', async () => {
  const documentation = await readFile(new URL('../android/README.md', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(documentation, /actions\/workflows\/android\.yml/);
  assert.match(documentation, /bookstr-android-apks-<commit>/);
  assert.match(documentation, /14 days/);
  assert.match(documentation, /runner's debug signing key/);
  assert.match(documentation, /installs these exact APKs/);
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

  assert.match(release, /needs: \[unit-tests, package-apks, emulator-tests\]/);
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

test('Android setup only requests SDK packages still available from Google', async () => {
  const workflow = await readWorkflow('android.yml');
  const setups = [...workflow.matchAll(/uses: android-actions\/setup-android@v3\n([\s\S]*?)(?=      - )/g)];
  assert.equal(setups.length, 4);
  for (const setup of setups) {
    assert.match(setup[1], /with:\n          packages: platform-tools/);
    assert.doesNotMatch(setup[1], /packages:.*\btools platform-tools\b/);
  }
});

test('Android jobs expose installed host Boost headers to NDK CMake builds', async () => {
  const workflow = await readWorkflow('android.yml');
  const cmake = await readFile(new URL('../android/app/src/main/cpp/CMakeLists.txt', import.meta.url), 'utf8');
  assert.match(workflow, /^env:\n  BOOST_ROOT: \$\{\{ github\.workspace \}\}\/\.ci-boost$/m);
  assert.equal([...workflow.matchAll(/apt-get install -y libboost-dev/g)].length, 3);
  assert.equal([...workflow.matchAll(/mkdir -p "\$BOOST_ROOT\/include"/g)].length, 3);
  assert.equal([...workflow.matchAll(/cp -R \/usr\/include\/boost "\$BOOST_ROOT\/include\/"/g)].length, 3);
  assert.match(cmake, /set\(Boost_INCLUDE_DIR "\$ENV\{BOOST_ROOT\}\/include" CACHE PATH "Boost headers"\)/);
});

test('Obtainium releases use unique increasing versions and latest APK assets', async () => {
  const workflow = await readWorkflow('android.yml');
  const gradle = await readFile(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8');
  const publisher = await readFile(new URL('../android/scripts/publish-obtainium-release.sh', import.meta.url), 'utf8');
  const release = workflow.match(/^  release:\n[\s\S]*$/m)[0];

  assert.match(gradle, /versionCode = providers\.gradleProperty\("bookstr\.versionCode"\)\.orNull\?\.toInt\(\) \?: timestampVersionCode/);
  assert.match(gradle, /versionName = providers\.gradleProperty\("bookstr\.versionName"\)\.orNull \?: "0\.0\.3-\$versionTimestamp"/);
  assert.equal([...release.matchAll(/version="0\.0\.3-ci\.\$RUN_NUMBER"/g)].length, 1);
  assert.match(publisher, /version="0\.0\.3-ci\.\$RUN_NUMBER"/);
  assert.match(release, /code=\$\(\(1000000000 \+ RUN_NUMBER\)\)/);
  assert.match(release, /assembleRelease -Pbookstr.cxxCompilerLauncher=ccache "-Pbookstr\.versionCode=\$code" "-Pbookstr\.versionName=\$version"/);
  assert.match(release, /--no-configuration-cache --max-workers=2 assembleRelease/);
  assert.match(release, /run: bash android\/scripts\/publish-obtainium-release\.sh/);
  assert.match(workflow, /name: Test Android release publisher\n        run: node --test android\/scripts\/publish-obtainium-release\.test\.mjs/);
  assert.match(publisher, /gh release create "\$tag" "\$apk"/);
  assert.match(publisher, /gh release upload "\$tag" "\$apk"/);
  assert.match(publisher, /--target "\$GITHUB_SHA"/);
  assert.match(publisher, /--latest/);
  assert.match(publisher, /size > 0/);
  assert.match(publisher, /does not contain a nonempty/);
  assert.doesNotMatch(publisher, /--prerelease|--draft|assembleDebug/);
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

test('Node.js runtime pin is shared by local development and every workflow', async () => {
  const pin = await readFile(new URL('../.nvmrc', import.meta.url), 'utf8');
  assert.equal(pin, '26.13.0\n');

  const workflowNames = ['ci.yml', 'android.yml', 'ios.yml', 'deploy-web.yml'];
  const workflows = await Promise.all(workflowNames.map(readWorkflow));
  const setupNodeSteps = workflows.flatMap((workflow) =>
    [...workflow.matchAll(/- uses: actions\/setup-node@v4([\s\S]*?)(?=\n      - uses:|\n      - name:|$)/g)].map((match) => match[1]),
  );
  assert.equal(setupNodeSteps.length, 7);
  for (const step of setupNodeSteps) {
    assert.match(step, /node-version-file: \.nvmrc/);
    assert.doesNotMatch(step, /node-version:\s*\d/);
  }

  const ci = workflows[0];
  assert.match(ci, /web:[\s\S]*?- '\.nvmrc'/);
  assert.match(ci, /electron:[\s\S]*?- '\.nvmrc'/);
  for (const name of ['android.yml', 'ios.yml']) {
    const workflow = await readWorkflow(name);
    assert.equal((workflow.match(/- '\.nvmrc'/g) ?? []).length, 2);
  }

  const rootReadme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const desktopReadme = await readFile(new URL('../desktop/README.md', import.meta.url), 'utf8');
  const desktopManifest = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.match(rootReadme, /Node\.js 26\.13\.0 with `nvm use`/);
  assert.match(desktopReadme, /Node\.js 26\.13 or newer/);
  assert.equal(desktopManifest.engines.node, '>=26.13.0');
});

test('failed Android unit runs retain their JUnit exception reports per attempt', async () => {
  const workflow = await readWorkflow('android.yml');
  const reportPath = 'android/app/build/test-results/testDebugUnitTest/TEST-*.xml';
  const upload = workflow.split('      - name: Upload failed JVM test reports\n')[1].split('      - ')[0];
  assert.ok(upload.includes(`if: always() && steps.unit_tests.outcome == 'failure' && hashFiles('${reportPath}') != ''`));
  assert.ok(upload.includes('uses: actions/upload-artifact@v4'));
  assert.ok(upload.includes('name: bookstr-android-unit-failures-${{ github.run_id }}-${{ github.run_attempt }}'));
  assert.ok(upload.includes(`path: ${reportPath}`));
});
