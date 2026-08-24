#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function argumentsMap(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    result[values[index].replace(/^--/, '')] = values[index + 1];
  }
  return result;
}

function number(value) {
  const parsed = Number(value?._value ?? value?.value ?? value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(covered, total) {
  return total ? Number(((covered / total) * 100).toFixed(2)) : 0;
}

async function filesBelow(path, extension) {
  if (!path) return [];
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? filesBelow(child, extension) : [child];
    }));
    return nested.flat().filter(file => !extension || extname(file) === extension);
  } catch {
    return [path];
  }
}

export function parseTap(text) {
  const value = key => number(text.match(new RegExp(`^# ${key} (\\d+(?:\\.\\d+)?)`, 'm'))?.[1]);
  return {
    tests: value('tests'),
    passed: value('pass'),
    failed: value('fail'),
    skipped: value('skipped'),
    durationMs: value('duration_ms'),
  };
}

export function parseJUnit(documents) {
  const result = { tests: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 };
  for (const document of documents) {
    const suite = document.match(/<testsuite\s+([^>]+)>/i)?.[1] || '';
    const attribute = name => suite.match(new RegExp(`${name}="([^"]+)"`, 'i'))?.[1];
    const tests = number(attribute('tests'));
    const failed = number(attribute('failures')) + number(attribute('errors'));
    const skipped = number(attribute('skipped'));
    result.tests += tests;
    result.failed += failed;
    result.skipped += skipped;
    result.passed += Math.max(0, tests - failed - skipped);
    result.durationMs += number(attribute('time')) * 1000;
  }
  return result;
}

export function parsePlaywright(report) {
  const stats = report?.stats || {};
  const passed = number(stats.expected);
  const failed = number(stats.unexpected) + number(stats.flaky);
  const skipped = number(stats.skipped);
  return {
    tests: passed + failed + skipped,
    passed,
    failed,
    skipped,
    durationMs: number(stats.duration),
  };
}

export function parseXCResult(summary) {
  const configurations = Array.isArray(summary?.devicesAndConfigurations) ? summary.devicesAndConfigurations : [];
  const count = key => {
    const direct = Array.isArray(summary?.[key]) ? summary[key].length : number(summary?.[key]);
    return direct || configurations.reduce((sum, item) => sum + (Array.isArray(item?.[key]) ? item[key].length : number(item?.[key])), 0);
  };
  const total = number(summary?.totalTestCount ?? summary?.statistics?.find(item => item.title === 'Tests')?.value);
  const failed = count('failedTests');
  const skipped = count('skippedTests');
  const explicitPassed = count('passedTests');
  const timestamp = value => {
    if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
    return new Date(value || 0).valueOf();
  };
  return {
    tests: total || explicitPassed + failed + skipped,
    passed: explicitPassed || Math.max(0, total - failed - skipped),
    failed,
    skipped,
    durationMs: Math.max(0, timestamp(summary?.finishTime) - timestamp(summary?.startTime)),
  };
}

export function parseIstanbul(summary) {
  const total = summary?.total || {};
  return ['statements', 'branches', 'functions', 'lines'].map(key => ({
    label: key[0].toUpperCase() + key.slice(1),
    value: number(total[key]?.pct),
    suffix: '%',
  }));
}

export function parseJacoco(xml) {
  const labels = { INSTRUCTION: 'Instructions', BRANCH: 'Branches', METHOD: 'Methods', LINE: 'Lines' };
  const counters = [...xml.matchAll(/<counter\s+([^>]+)\/?>/g)].map(match => {
    const attributes = Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]));
    return attributes;
  });
  const last = new Map(counters.filter(counter => labels[counter.type]).map(counter => [counter.type, counter]));
  return Object.entries(labels).flatMap(([type, label]) => {
    const counter = last.get(type);
    if (!counter) return [];
    const missed = number(counter.missed);
    const covered = number(counter.covered);
    return { label, value: percent(covered, covered + missed), suffix: '%' };
  });
}

export function parseXCCov(report) {
  const targets = Array.isArray(report?.targets) ? report.targets : [];
  const executable = number(report?.executableLines) || targets.reduce((sum, target) => sum + number(target?.executableLines), 0);
  const covered = number(report?.coveredLines) || targets.reduce((sum, target) => sum + number(target?.coveredLines), 0);
  const coverage = executable ? percent(covered, executable) : number(report?.lineCoverage) * 100;
  return [{ label: 'Lines', value: Number(coverage.toFixed(2)), suffix: '%' }];
}

async function optionalJSON(path) {
  if (!path) return null;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function record(options) {
  let results = { tests: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 };
  if (options['results-format'] === 'tap') {
    results = parseTap(await readFile(options.results, 'utf8').catch(() => ''));
  } else if (options['results-format'] === 'junit') {
    const files = await filesBelow(options.results, '.xml');
    results = parseJUnit(await Promise.all(files.map(file => readFile(file, 'utf8').catch(() => ''))));
  } else if (options['results-format'] === 'playwright') {
    results = parsePlaywright(await optionalJSON(options.results));
  } else if (options['results-format'] === 'xcresult') {
    results = parseXCResult(await optionalJSON(options.results));
  }

  let coverage = [];
  if (options['coverage-format'] === 'istanbul') coverage = parseIstanbul(await optionalJSON(options.coverage));
  if (options['coverage-format'] === 'jacoco') coverage = parseJacoco(await readFile(options.coverage, 'utf8').catch(() => ''));
  if (options['coverage-format'] === 'xccov') coverage = parseXCCov(await optionalJSON(options.coverage));

  const passing = options.status === 'passing' && results.tests > 0 && results.failed === 0;
  const payload = {
    id: options.id,
    suite: options.suite,
    status: passing ? 'passing' : 'failing',
    recorded: options.recorded || new Date().toISOString(),
    runUrl: options['run-url'] || '',
    commit: options.commit || '',
    results,
    coverage: coverage.filter(item => Number.isFinite(item.value)),
  };
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(payload, null, 2)}\n`);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function duration(milliseconds) {
  const seconds = Math.round(number(milliseconds) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function suiteRow(suite) {
  const result = suite.results || {};
  const coverage = new Map((suite.coverage || []).map(item => [item.label, item]));
  const coverageValue = (...labels) => {
    const item = labels.map(label => coverage.get(label)).find(Boolean);
    return item ? `${item.value.toFixed(2)}${item.suffix}` : '';
  };
  const status = suite.status === 'passing' ? 'Passing' : suite.status === 'failing' ? 'Failing' : 'Not recorded';
  const date = suite.recorded ? new Date(suite.recorded) : null;
  const recorded = date && !Number.isNaN(date.valueOf())
    ? `<time datetime="${escapeHTML(suite.recorded)}" title="UTC">${escapeHTML(date.toISOString().slice(0, 16).replace('T', ' '))}</time>`
    : 'Not recorded';
  const suiteName = suite.runUrl
    ? `<a href="${escapeHTML(suite.runUrl)}">${escapeHTML(suite.suite)}</a>`
    : escapeHTML(suite.suite);
  return `<tr>
    <th scope="row">${suiteName}</th>
    <td><span class="status ${suite.status}"><span aria-hidden="true"></span>${status}</span></td>
    <td>${recorded}</td>
    <td class="value">${result.tests ? `<strong>${result.passed}/${result.tests}</strong>${result.skipped ? `<small>${result.skipped} skipped</small>` : ''}` : ''}</td>
    <td class="value">${result.tests ? `<strong>${percent(result.passed, result.tests)}%</strong>` : ''}</td>
    <td class="value">${result.durationMs ? `<strong>${duration(result.durationMs)}</strong>` : ''}</td>
    <td class="value"><strong>${coverageValue('Statements', 'Instructions')}</strong></td>
    <td class="value"><strong>${coverageValue('Branches')}</strong></td>
    <td class="value"><strong>${coverageValue('Functions', 'Methods')}</strong></td>
    <td class="value"><strong>${coverageValue('Lines')}</strong></td>
  </tr>`;
}

export function renderDashboard(suites) {
  const order = ['web', 'web-e2e', 'android', 'android-ui', 'ios'];
  const names = { web: 'Web', 'web-e2e': 'Web e2e', android: 'Android', 'android-ui': 'Android UI', ios: 'iOS' };
  const byId = new Map(suites.map(suite => [suite.id, suite]));
  const complete = order.map(id => byId.get(id) || { id, suite: names[id], status: 'missing', results: {}, coverage: [] });
  const passing = complete.filter(suite => suite.status === 'passing').length;
  const failing = complete.filter(suite => suite.status === 'failing').length;
  const summary = failing ? `${failing} suite${failing === 1 ? '' : 's'} failing` : `${passing} of ${complete.length} suites passing`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f7f3ea">
  <title>Bookstr test overview</title>
  <link rel="icon" href="../public/favicon.svg" type="image/svg+xml">
  <style>
    :root { color-scheme: light; --paper:#f7f3ea; --surface:#fffaf2; --ink:#1c1916; --muted:#6b635a; --sage:#2f5d50; --sage-soft:#e5f1eb; --line:#d8cfc3; --red:#a33a2c; --red-soft:#f7e5e1; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:var(--paper); color:var(--ink); font:15px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(100% - 2rem, 1180px); margin:0 auto; padding:clamp(.75rem,2vw,1.5rem) 0; }
    header { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; margin-bottom:.75rem; }
    .heading { display:flex; align-items:center; gap:.8rem; }
    .logo { width:4.5rem; height:4.5rem; }
    h1 { margin:0; font:700 clamp(1.65rem,4vw,2.4rem)/1.1 "Iowan Old Style",Palatino,Georgia,serif; color:var(--sage); }
    header p { margin:.4rem 0 0; color:var(--muted); }
    .back { color:var(--sage); font-weight:650; text-decoration-thickness:1px; text-underline-offset:.2em; white-space:nowrap; }
    .table-wrap { overflow-x:auto; background:var(--surface); border:1px solid var(--line); box-shadow:0 14px 40px rgba(67,55,43,.07); }
    table { width:100%; border-collapse:collapse; min-width:1180px; }
    th,td { padding:1rem .85rem; text-align:left; border-right:1px solid var(--line); border-bottom:1px solid var(--line); vertical-align:middle; }
    tr > :last-child { border-right:0; }
    thead th { padding-top:.8rem; padding-bottom:.8rem; color:var(--muted); font-size:.72rem; letter-spacing:.09em; text-transform:uppercase; }
    tbody th { width:150px; font-size:1rem; }
    tbody th a { color:var(--ink); text-decoration-color:color-mix(in srgb,var(--sage) 40%,transparent); text-underline-offset:.2em; }
    tbody tr:last-child > * { border-bottom:0; }
    time { white-space:nowrap; }
    .status { display:inline-flex; align-items:center; gap:.45rem; font-size:.75rem; font-weight:750; letter-spacing:.05em; text-transform:uppercase; }
    .status span { width:.45rem; height:.45rem; border-radius:50%; background:currentColor; }
    .status.passing { color:#167b67; }
    .status.failing { color:var(--red); }
    .status.missing { color:var(--muted); }
    .value { color:#168573; white-space:nowrap; }
    .value small { display:block; color:var(--muted); font-size:.72rem; font-weight:400; }
    footer { margin-top:1rem; color:var(--muted); font-size:.82rem; }
    @media (max-width:640px) { main { width:min(100% - 1rem,1180px); padding:1rem 0; } header { align-items:flex-start; } .back { margin-top:.25rem; } }
    @media (prefers-color-scheme:dark) { :root { color-scheme:dark; --paper:#121212; --surface:#1b1a18; --ink:#e8e4dc; --muted:#aaa39a; --sage:#7fb8a7; --sage-soft:#18382f; --line:#3b3833; --red:#f09a87; --red-soft:#40221d; } }
  </style>
</head>
<body>
  <main>
    <header><div class="heading"><img class="logo" src="../public/favicon.svg" alt="Bookstr"><div><h1>Test overview</h1><p>${escapeHTML(summary)} · latest completed run per suite</p></div></div><a class="back" href="../">Back to Bookstr</a></header>
    <div class="table-wrap"><table><thead><tr><th>Suite</th><th>Status</th><th>Recorded (UTC)</th><th>Tests</th><th>Pass rate</th><th>Duration</th><th>Statements / instructions</th><th>Branches</th><th>Functions / methods</th><th>Lines</th></tr></thead><tbody>${complete.map(suiteRow).join('')}</tbody></table></div>
    <footer>Generated automatically by GitHub Actions. Select a suite to inspect its run.</footer>
  </main>
</body>
</html>`;
}

async function render(options) {
  const files = await filesBelow(options.input, '.json');
  const suites = (await Promise.all(files.map(optionalJSON))).filter(value => value?.id);
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, renderDashboard(suites));
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  const options = argumentsMap(values);
  if (command === 'record') return record(options);
  if (command === 'render') return render(options);
  throw new Error('Usage: test-overview.mjs <record|render> [--key value ...]');
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || basename(import.meta.url))).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
