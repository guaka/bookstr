import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { main, parseArgs, readCoverageReports, renderCoverageReport } from './pr-coverage-report.mjs';

test('renders a Bookstr coverage table with portable metric aliases and a stable marker', () => {
  const report = renderCoverageReport({
    marker: 'web',
    workflow: 'CI',
    runUrl: 'https://github.com/guaka/bookstr/actions/runs/42',
    reports: [
      { id: 'web', suite: 'Web', status: 'passing', results: { tests: 10, passed: 10 }, coverage: [
        { label: 'Statements', value: 100 }, { label: 'Branches', value: 99.5 },
        { label: 'Functions', value: 98 }, { label: 'Lines', value: 100 },
      ] },
      { id: 'android', suite: 'Android', status: 'failing', knownTests: 3, coverage: [{ label: 'Instructions', value: 90 }, { label: 'Methods', value: 80 }] },
    ],
  });
  assert.match(report, /<!-- bookstr-coverage-report:web -->/);
  assert.match(report, /\| Web \| Passing \| 10\/10 \| 100\.00% \| 99\.50% \| 98\.00% \| 100\.00% \|/);
  assert.match(report, /\| Android \| Failing \| 3 \| 90\.00% \| n\/a \| 80\.00% \| n\/a \|/);
  assert.match(report, /Report details/);
});

test('renders an explicit empty state and sanitizes markdown values', () => {
  const report = renderCoverageReport({ workflow: 'CI|danger', reports: [{ suite: 'Web|x', status: 'unknown' }] });
  assert.match(report, /Workflow: \*\*CI danger\*\*/);
  assert.match(report, /\| Web x \| Failing \| n\/a \|/);
  assert.doesNotMatch(report, /\[Open workflow run\]/);
  assert.match(renderCoverageReport({ marker: 'android', reports: [] }), /No coverage artifact/);
});

test('reads valid overview JSON while ignoring missing, malformed, and non-object files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bookstr-pr-coverage-'));
  await writeFile(join(directory, 'web.json'), JSON.stringify({ id: 'web' }));
  await writeFile(join(directory, 'broken.json'), '{');
  await writeFile(join(directory, 'array.json'), '[]');
  await writeFile(join(directory, 'notes.txt'), '{}');
  assert.deepEqual(await readCoverageReports(directory), [{ id: 'web' }]);
  assert.deepEqual(await readCoverageReports(join(directory, 'missing')), []);
});

test('parses required CLI options and writes the report file', async () => {
  assert.deepEqual(parseArgs(['node', 'script', '--input', 'in', '--output', 'out', '--workflow', 'CI']), {
    input: 'in', output: 'out', workflow: 'CI',
  });
  assert.throws(() => parseArgs(['node', 'script', '--input']), /Usage/);
  assert.throws(() => parseArgs(['node', 'script', '--bad', 'value']), /Usage/);
  assert.throws(() => parseArgs(['node', 'script', '--input', 'in']), /required/);

  const directory = await mkdtemp(join(tmpdir(), 'bookstr-pr-coverage-main-'));
  const input = join(directory, 'input');
  const output = join(directory, 'report.md');
  await (await import('node:fs/promises')).mkdir(input);
  await writeFile(join(input, 'web.json'), JSON.stringify({ suite: 'Web', status: 'passing', coverage: [] }));
  await main(['node', 'script', '--input', input, '--output', output, '--workflow', 'CI', '--marker', 'web']);
  assert.match(await readFile(output, 'utf8'), /Bookstr coverage/);
});

test('PR workflow consumes all platform overview artifacts with write access isolated to the reporter', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pr-coverage.yml', import.meta.url), 'utf8');
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[CI, Android CI, iOS CI\]/);
  assert.match(workflow, /pattern: bookstr-test-overview-\*/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /github\.rest\.issues\.updateComment/);
  assert.match(workflow, /github\.rest\.issues\.createComment/);
  assert.match(workflow, /REPORT_MARKER: \$\{\{ github\.event\.workflow_run\.name \}\}/);
  assert.match(ci, /pr-coverage:/);
  assert.match(ci, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(ci, /--marker CI/);
  assert.match(ci, /issues: write/);
  assert.match(ci, /github\.rest\.issues\.updateComment/);
  assert.match(ci, /github\.rest\.issues\.createComment/);
});
