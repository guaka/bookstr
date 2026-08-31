import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const METRICS = [
  ['Statements', ['Statements', 'Instructions']],
  ['Branches', ['Branches']],
  ['Functions', ['Functions', 'Methods']],
  ['Lines', ['Lines']],
];

function markdownText(value) {
  return String(value ?? '').replace(/[|`\r\n]/g, ' ').trim();
}

function metricValue(report, labels) {
  const item = (report.coverage || []).find(candidate => labels.includes(candidate?.label));
  const value = Number(item?.value);
  if (!Number.isFinite(value)) return '—';
  return `${value === 100 ? '🟢' : '🟡'} ${value.toFixed(2)}%`;
}

function testValue(report) {
  const results = report.results && typeof report.results === 'object' ? report.results : {};
  const total = Number(results.tests ?? report.knownTests);
  const passed = Number(results.passed);
  if (Number.isFinite(total) && Number.isFinite(passed)) {
    const failed = Number(results.failed) || 0;
    const flaky = Number(results.flaky) || 0;
    const skipped = Number(results.skipped) || 0;
    const indicator = failed ? '🔴' : flaky || skipped ? '🟡' : passed === total ? '🟢' : '🔴';
    const detail = flaky ? ` (${flaky} flaky)` : skipped ? ` (${skipped} skipped)` : '';
    return `${indicator} ${passed}/${total}${detail}`;
  }
  return Number.isFinite(total) ? String(total) : '—';
}

export function renderCoverageReport({ reports = [], workflow = 'Bookstr', runUrl = '', marker = 'all' } = {}) {
  const safeMarker = markdownText(marker).replace(/\s+/g, '-');
  const safeWorkflow = markdownText(workflow) || 'Bookstr';
  const safeRunUrl = /^https?:\/\//i.test(String(runUrl)) ? String(runUrl) : '';
  const completeReports = [...reports];
  if (safeWorkflow === 'CI') {
    const reportedSuites = new Set(reports.map(report => String(report?.suite || report?.id || '')));
    for (const suite of ['Android', 'iOS']) {
      if (!reportedSuites.has(suite)) completeReports.push({ suite, status: 'not-run' });
    }
  }
  const rows = completeReports
    .filter(report => report && typeof report === 'object')
    .sort((left, right) => String(left.suite || left.id || '').localeCompare(String(right.suite || right.id || '')))
    .map(report => {
      const reportStatus = String(report.status || 'unknown').toLowerCase();
      const flaky = Number(report.results?.flaky) || 0;
      const failed = Number(report.results?.failed) || 0;
      const status = reportStatus === 'not-run'
        ? '⚪ Not run'
        : flaky && !failed ? '🟡 Flaky'
          : reportStatus === 'passing' ? '🟢 Passing' : '🔴 Failing';
      const values = METRICS.map(([, labels]) => metricValue(report, labels));
      return `| ${markdownText(report.suite || report.id || 'Unknown')} | ${status} | ${testValue(report)} | ${values.join(' | ')} |`;
    });
  const lines = [
    `<!-- bookstr-coverage-report:${safeMarker} -->`,
    '## Bookstr coverage',
    safeRunUrl ? `Workflow: **${safeWorkflow}** | [Open workflow run](${safeRunUrl})` : `Workflow: **${safeWorkflow}**`,
    safeRunUrl ? `[Download e2e screenshots](${safeRunUrl}#artifacts)` : '',
    '',
    '| Suite | Status | Tests | Statements | Branches | Functions | Lines |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  lines.push(...(rows.length ? rows : ['| No coverage artifact | — | — | — | — | — | — |']));
  lines.push(
    '',
    '<details><summary>Report details</summary>',
    '',
    '🟢 means all tests passed cleanly or coverage is 100%. 🟡 means a test needed a retry or measured coverage is below 100%. 🔴 means a failing result. ⚪ Not run means no relevant files changed for that client. — means that suite does not emit that metric; e2e suites currently report tests only.',
    '',
    'This report is generated from the Bookstr test-overview artifact and updates in place on reruns.',
    '',
    '</details>',
  );
  return `${lines.join('\n')}\n`;
}

export async function readCoverageReports(inputDir) {
  let names;
  try {
    names = await readdir(inputDir);
  } catch {
    return [];
  }
  const reports = [];
  for (const name of names.filter(candidate => candidate.endsWith('.json'))) {
    try {
      const report = JSON.parse(await readFile(join(inputDir, name), 'utf8'));
      if (report && typeof report === 'object' && !Array.isArray(report)) reports.push(report);
    } catch {
      // A partial test job can leave an empty or incomplete JSON artifact.
    }
  }
  return reports;
}

export function parseArgs(argv) {
  const values = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = String(argv[index] || '').replace(/^--/, '');
    const value = argv[index + 1];
    if (!['input', 'output', 'workflow', 'run-url', 'marker'].includes(key) || value == null || String(value).startsWith('--')) {
      throw new Error('Usage: pr-coverage-report.mjs --input DIR --output FILE --workflow NAME --run-url URL --marker ID');
    }
    values[key] = String(value);
  }
  if (!values.input || !values.output) throw new Error('Both --input and --output are required');
  return values;
}

export async function main(argv = process.argv) {
  const options = parseArgs(argv);
  const reports = await readCoverageReports(options.input);
  await writeFile(options.output, renderCoverageReport({
    reports,
    workflow: options.workflow,
    runUrl: options['run-url'],
    marker: options.marker,
  }));
}

if (process.argv[1] && process.argv[1].endsWith('/pr-coverage-report.mjs')) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
