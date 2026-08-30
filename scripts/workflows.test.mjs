import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  assert.match(workflow, /npm run test:coverage \| tee electron-tests\.tap/);
  assert.match(workflow, /xvfb-run -a npx playwright test tests\/e2e\/desktop\.smoke\.spec\.js/);
  assert.match(workflow, /--coverage-format node --coverage desktop\/electron-tests\.tap/);
  assert.match(workflow, /bookstr-test-overview-electron-\$\{\{ github\.run_id \}\}/);
  assert.match(deploy, /latest_run_with_artifact ci\.yml bookstr-test-overview-electron-/);
  assert.match(deploy, /pattern: bookstr-test-overview-electron-\*/);
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
});

test('CodeQL scans every main push while gating pull requests by language', async () => {
  const workflow = await readWorkflow('codeql.yml');

  for (const language of [
    'actions',
    'java-kotlin',
    'javascript-typescript',
    'python',
    'swift',
  ]) {
    assert.match(workflow, new RegExp(`name: Analyze \\(${language}\\)`));
    const output = language.replaceAll('-', '_');
    assert.match(
      workflow,
      new RegExp(`needs\\.changes\\.outputs\\.${output} == 'true'`),
    );
  }

  assert.equal([...workflow.matchAll(/event_name != 'pull_request'/g)].length, 5);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(workflow, /runs-on: macos-26[\s\S]*languages: swift/);
  assert.match(workflow, /languages: java-kotlin\n\s+build-mode: manual/);
  assert.match(workflow, /run: \.\/gradlew --no-daemon assembleDebug/);
});

test('Android CI shares one cached Gradle invocation across unit build tasks', async () => {
  const workflow = await readWorkflow('android.yml');
  const properties = await readFile(new URL('../android/gradle.properties', import.meta.url), 'utf8');

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
