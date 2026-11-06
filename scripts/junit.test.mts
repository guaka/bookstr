import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJUnit } from './junit.mjs';

test('JUnit totals sum multiple suites and count errors alongside failures', () => {
  assert.deepEqual(parseJUnit([
    '<testsuite tests="5" failures="1" errors="1" skipped="1" time="2.5"></testsuite>',
    '<testsuite tests="2" failures="0" errors="0" skipped="0" time="0.25"></testsuite>',
  ]), {tests: 7, passed: 4, failed: 2, skipped: 1, durationMs: 2750});
});

test('JUnit totals tolerate absent or non-finite attributes and clamp inconsistent pass counts', () => {
  assert.deepEqual(parseJUnit(['not xml', '<testsuite tests="Infinity" failures="NaN"></testsuite>']), {
    tests: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0,
  });
  assert.equal(parseJUnit(['<testsuite tests="1" failures="3"></testsuite>']).passed, 0);
  assert.equal(parseJUnit([]).tests, 0);
});
