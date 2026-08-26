import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseIstanbul,
  parseJacoco,
  parseJUnit,
  parseLLVM,
  parsePlaywright,
  parseSwiftTest,
  parseTap,
  parseXCResult,
  parseXCCov,
  renderDashboard,
} from './test-overview.mjs';

test('normalizes platform test reports', () => {
  assert.deepEqual(parseTap('# tests 4\n# pass 3\n# fail 1\n# skipped 0\n# duration_ms 125.5'), {
    tests: 4, passed: 3, failed: 1, skipped: 0, durationMs: 125.5,
  });
  assert.deepEqual(parseJUnit(['<testsuite tests="5" failures="1" errors="1" skipped="1" time="2.5"></testsuite>']), {
    tests: 5, passed: 2, failed: 2, skipped: 1, durationMs: 2500,
  });
  assert.equal(parsePlaywright({ stats: { expected: 6, unexpected: 1, skipped: 2, duration: 900 } }).tests, 9);
  assert.equal(parseXCResult({ totalTestCount: 8, failedTests: 1, skippedTests: 1 }).passed, 6);
  assert.deepEqual(parseSwiftTest("Executed 231 tests, with 0 failures (0 unexpected) in 0.178 (0.190) seconds\n"), {
    tests: 231, passed: 231, failed: 0, skipped: 0, durationMs: 178,
  });
  assert.deepEqual(parseSwiftTest("Executed 5 tests, with 1 test skipped and 1 failure (1 unexpected) in 0.25 seconds\n"), {
    tests: 5, passed: 3, failed: 1, skipped: 1, durationMs: 250,
  });
  assert.deepEqual(parseXCResult({
    devicesAndConfigurations: [{ passedTests: 12, failedTests: 1, skippedTests: 2 }],
    startTime: 1_700_000_000,
    finishTime: 1_700_000_005,
  }), { tests: 15, passed: 12, failed: 1, skipped: 2, durationMs: 5000 });
});

test('normalizes Istanbul and JaCoCo coverage', () => {
  assert.equal(parseIstanbul({ total: { statements: { pct: 90 }, branches: { pct: 80 }, functions: { pct: 70 }, lines: { pct: 60 } } })[0].value, 90);
  const metrics = parseJacoco('<report><counter covered="8" missed="2" type="LINE"/><counter type="METHOD" missed="1" covered="9"/><counter type="BRANCH" missed="3" covered="7"/><counter type="INSTRUCTION" missed="4" covered="6"/></report>');
  assert.deepEqual(metrics.map(metric => metric.value), [60, 70, 90, 80]);
  assert.equal(parseXCCov({ targets: [{ coveredLines: 75, executableLines: 100 }] })[0].value, 75);
  assert.equal(parseXCCov({
    targets: [
      { name: 'BookstrIOS.app', coveredLines: 30, executableLines: 100 },
      { name: 'BookstrIOSTests.xctest', coveredLines: 900, executableLines: 900 },
    ],
  })[0].value, 30);
  assert.deepEqual(parseLLVM({ data: [{ files: [
    { filename: '/repo/ios/BookstrIOS/Sources/Data/Store.swift', summary: {
      regions: { count: 10, covered: 7 }, branches: { count: 4, covered: 2 },
      functions: { count: 5, covered: 4 }, lines: { count: 20, covered: 15 },
    } },
    { filename: '/repo/ios/BookstrIOS/Tests/StoreTests.swift', summary: {
      regions: { count: 100, covered: 100 }, lines: { count: 100, covered: 100 },
    } },
  ] }] }).map(metric => metric.value), [70, 50, 80, 75]);
});

test('renders an accessible dashboard with links and missing suites', () => {
  const html = renderDashboard([{ id: 'web', suite: 'Web', status: 'passing', recorded: '2026-08-24T10:00:00Z', runUrl: 'https://example.com/run', results: { tests: 10, passed: 10 }, coverage: [] }]);
  assert.match(html, /<th scope="row"><a href="https:\/\/example\.com\/run">Web<\/a><\/th>/);
  assert.match(html, /10\/10/);
  assert.match(html, /2026-08-24 10:00/);
  assert.match(html, /status missing/);
  assert.match(html, /class="logo"[^>]+alt="Bookstr"/);
  assert.match(html, /<th>Tests<\/th><th>Pass rate<\/th><th>Duration<\/th>/);
  assert.doesNotMatch(html, /border-radius:999px/);
});

test('renders declared test counts when a suite fails before execution', () => {
  const html = renderDashboard([{ id: 'ios', suite: 'iOS', status: 'failing', knownTests: 42, results: {}, coverage: [] }]);
  assert.match(html, /<strong>0\/42<\/strong>/);
});
