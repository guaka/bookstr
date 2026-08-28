import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readWorkflow = (name) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('web tests are gated by web-related path changes', async () => {
  const workflow = await readWorkflow('ci.yml');

  assert.match(workflow, /name: Detect web changes/);
  assert.match(workflow, /- 'web\/\*\*'/);
  assert.match(workflow, /- 'scripts\/\*\*'/);
  assert.match(workflow, /if: needs\.changes\.outputs\.web == 'true'/);
  assert.match(workflow, /repository-hygiene:/);
  assert.match(workflow, /name: Workflow contracts/);
  assert.match(
    workflow,
    /if: needs\.changes\.outputs\.workflows == 'true'/,
  );
});

test('CodeQL gates each language while retaining scheduled full scans', async () => {
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

  assert.match(workflow, /event_name == 'schedule'/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /runs-on: macos-26[\s\S]*languages: swift/);
  assert.match(workflow, /languages: java-kotlin\n\s+build-mode: manual/);
  assert.match(workflow, /run: \.\/gradlew --no-daemon assembleDebug/);
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
