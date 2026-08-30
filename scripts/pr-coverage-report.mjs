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
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : 'n/a';
}

function testValue(report) {
  const results = report.results && typeof report.results === 'object' ? report.results : {};
  const total = Number(results.tests ?? report.knownTests);
  const passed = Number(results.passed);
  if (Number.isFinite(total) && Number.isFinite(passed)) return `${passed}/${total}`;
  return Number.isFinite(total) ? String(total) : 'n/a';
}

export function renderCoverageReport({ reports = [], workflow = 'Bookstr', runUrl = '', marker = 'all' } = {}) {
  const safeMarker = markdownText(marker).replace(/\s+/g, '-');
  const safeWorkflow = markdownText(workflow) || 'Bookstr';
  const safeRunUrl = /^https?:\/\//i.test(String(runUrl)) ? String(runUrl) : '';
  const rows = reports
    .filter(report => report && typeof report === 'object')
    .sort((left, right) => String(left.suite || left.id || '').localeCompare(String(right.suite || right.id || '')))
    .map(report => {
      const status = String(report.status || 'unknown').toLowerCase() === 'passing' ? 'Passing' : 'Failing';
      const values = METRICS.map(([, labels]) => metricValue(report, labels));
      return `| ${markdownText(report.suite || report.id || 'Unknown')} | ${status} | ${testValue(report)} | ${values.join(' | ')} |`;
    });
  const lines = [
    `<!-- bookstr-coverage-report:${safeMarker} -->`,
    '## Bookstr coverage',
    safeRunUrl ? `Workflow: **${safeWorkflow}** | [Open workflow run](${safeRunUrl})` : `Workflow: **${safeWorkflow}**`,
    '',
    '| Suite | Status | Tests | Statements | Branches | Functions | Lines |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  lines.push(...(rows.length ? rows : ['| No coverage artifact | n/a | n/a | n/a | n/a | n/a | n/a |']));
  lines.push('', '<details><summary>Report details</summary>', '', 'This report is generated from the Bookstr test-overview artifact and updates in place on reruns.', '', '</details>');
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
