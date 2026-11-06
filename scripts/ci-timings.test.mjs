import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { collectTimings, duration, formatDuration, renderTimings } from './ci-timings.mjs';

const at = seconds => new Date(Date.UTC(2026, 10, 6, 0, 0, seconds)).toISOString();
const step = (name, start, end, conclusion = 'success', status = 'completed') => ({
  name, started_at: at(start), completed_at: end === null ? null : at(end), conclusion, status,
});
const job = (name, start, end, steps, conclusion = 'success', status = 'completed') => ({
  ...step(name, start, end, conclusion, status), steps,
});
const run = { id: 42, run_attempt: 2, created_at: at(-600), run_started_at: at(0), updated_at: at(9999) };

test('collector paginates only the triggering attempt and propagates API failures', async () => {
  const method = () => {};
  const repo = { owner: 'guaka', repo: 'bookstr' };
  const jobs = [job('Android', 5, 20, [])];
  const github = { rest: { actions: { listJobsForWorkflowRunAttempt: method } }, paginate: async (endpoint, parameters) => {
    assert.equal(endpoint, method);
    assert.deepEqual(parameters, { ...repo, run_id: 42, attempt_number: 2, per_page: 100 });
    return jobs;
  } };
  assert.deepEqual(await collectTimings(github, repo, run), { run, jobs });
  github.paginate = async () => { throw new Error('rate limit'); };
  await assert.rejects(collectTimings(github, repo, run), /rate limit/);
});

test('formats zero, rounded and missing times without inventing durations', () => {
  assert.equal(duration(at(0), at(0)), 0);
  assert.equal(duration(at(0), at(61)), 61000);
  for (const pair of [[null, null], [at(2), at(1)], ['bad', at(1)]]) assert.equal(duration(...pair), null);
  assert.equal(formatDuration(0), '0m 00s');
  assert.equal(formatDuration(59999), '1m 00s');
  assert.equal(formatDuration(null), '—');
});

test('reports parallel job cost, elapsed scheduling time and ranked steps separately', () => {
  const report = renderTimings({ run, jobs: [
    job('Unit', 10, 130, [step('Coverage', 10, 125), step('Upload', 125, 130)]),
    job('Package', 15, 140, [step('Build', 15, 140, 'failure')], 'failure'),
    job('Emulator', 145, 745, Array.from({ length: 7 }, (_, i) => step(`UI ${i}`, 145 + i, 240 + i))),
    job('Skipped', 0, 9000, [step('Skipped step', 0, 9000, 'skipped')], 'skipped'),
    job('<Running|[x]>', 0, null, [step('Pending', 0, null, null, 'in_progress')], null, 'in_progress'),
    job('Missing timestamps', 0, null, [step('Unknown', 0, null)]),
  ] });
  assert.match(report, /Attempt 2/);
  assert.match(report, /elapsed time/i);
  assert.match(report, /\*\*12m 25s\*\*/);
  assert.match(report, /Accumulated job time: \*\*14m 05s\*\*/);
  assert.match(report, /\| Skipped \| skipped \| — \|/);
  assert.match(report, /&#60;Running&#124;&#91;x&#93;&#62; \| in&#95;progress \| —/);
  const top = report.split('**Slowest completed steps**')[1].split('<details>')[0];
  assert.equal(top.split('\n').filter(line => /^\| .*m \d\ds \|$/.test(line)).length, 5);
  assert.ok(top.indexOf('Package / Build') < top.indexOf('Unit / Coverage'));
  assert.match(report, /Package \/ Build \| failure \| 2m 05s/);
  assert.match(report, /Emulator \/ UI 6/);
  assert.doesNotMatch(report, /Skipped step|Pending|Unknown/);
});

test('empty and skipped-only runs explicitly lack elapsed timing', () => {
  for (const jobs of [[], [job('Not relevant', 0, 0, [], 'skipped')]]) {
    const report = renderTimings({ run, jobs });
    assert.match(report, /dependencies: \*\*—\*\*/);
    assert.match(report, /Accumulated job time: \*\*0m 00s\*\*/);
  }
});

test('trusted reporting appends timings, archives raw data and preserves coverage on API errors', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pr-coverage.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /ref:.*head_sha/);
  assert.match(workflow, /path: \|\n            pr-coverage.md\n            ci-timings.json/);
  const source = workflow.split('      - name: Append CI timing measurements\n')[1]
    .split('      - name: Upload PR coverage report\n')[0].split('          script: |\n')[1]
    .replace(/^            /gm, '');
  const execute = new Function('require', 'context', 'github', 'core', 'process', `return (async () => {${source}})()`);
  for (const fail of [false, true]) {
    const files = new Map([['pr-coverage.md', 'Existing coverage\n']]);
    const warnings = [];
    const fs = {
      writeFileSync: (path, contents) => files.set(path, contents),
      appendFileSync: (path, contents) => files.set(path, files.get(path) + contents),
    };
    await execute(() => fs, { repo: { owner: 'guaka', repo: 'bookstr' }, payload: { workflow_run: run } }, {
      rest: { actions: { listJobsForWorkflowRunAttempt: () => {} } },
      paginate: async () => { if (fail) throw new Error('rate limit'); return []; },
    }, { warning: message => warnings.push(message) }, {
      env: { GITHUB_WORKSPACE: new URL('..', import.meta.url).pathname.replace(/\/$/, '') },
    });
    assert.ok(files.get('pr-coverage.md').startsWith('Existing coverage\n'));
    if (fail) {
      assert.match(files.get('pr-coverage.md'), /CI timings unavailable for this attempt/);
      assert.deepEqual(warnings, ['CI timings unavailable: rate limit']);
      assert.equal(files.has('ci-timings.json'), false);
    } else {
      assert.match(files.get('pr-coverage.md'), /### CI timings/);
      assert.deepEqual(JSON.parse(files.get('ci-timings.json')), { run, jobs: [] });
      assert.deepEqual(warnings, []);
    }
  }
});
