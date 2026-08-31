import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const readWorkflow = (name) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

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
  assert.match(workflow, /npm run test:coverage(?::ci)? \| tee electron-tests\.tap/);
  assert.match(workflow, /xvfb-run -a npx playwright test tests\/e2e\/desktop\.smoke\.spec\.js/);
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
