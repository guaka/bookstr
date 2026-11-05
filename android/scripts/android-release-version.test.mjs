import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatUtcReleaseTimestamp,
  latestPublishedAndroidRunNumber,
  resolveAndroidReleaseVersion,
} from './android-release-version.mjs';

const run = {
  runStartedAt: '2026-11-05T19:32:48Z',
  runNumber: '42',
  runId: '90042',
};

test('formats workflow start timestamps in UTC to the release minute', () => {
  assert.equal(formatUtcReleaseTimestamp(run.runStartedAt), '20261105-1932');
  assert.equal(formatUtcReleaseTimestamp('2026-11-05T21:32:48+02:00'), '20261105-1932');
  assert.throws(() => formatUtcReleaseTimestamp('not a timestamp'), /valid ISO timestamp/);
  assert.throws(() => formatUtcReleaseTimestamp(undefined), /valid ISO timestamp/);
});

test('allocates the base release version when its timestamp is unused', () => {
  assert.equal(resolveAndroidReleaseVersion({ ...run, releases: [] }), '0.1-20261105-1932');
  assert.equal(resolveAndroidReleaseVersion({ ...run, releases: [{ tagName: 'v0.1-20261105-1931' }] }), '0.1-20261105-1932');
});

test('retries reuse the version tag owned by the same workflow run', () => {
  assert.equal(resolveAndroidReleaseVersion({
    ...run,
    releases: [{ tagName: 'v0.1-20261105-1932', body: 'Bookstr Android workflow run ID: 90042' }],
  }), '0.1-20261105-1932');
  assert.equal(resolveAndroidReleaseVersion({
    ...run,
    releases: [
      { tag_name: 'v0.1-20261105-1932', body: 'Another workflow run' },
      { tag_name: 'v0.1-20261105-1932-r42', body: 'Bookstr Android workflow run ID: 90042' },
    ],
  }), '0.1-20261105-1932-r42');
});

test('uses a deterministic run-number suffix when another run owns the timestamp tag', () => {
  assert.equal(resolveAndroidReleaseVersion({
    ...run,
    releases: [{ tagName: 'v0.1-20261105-1932', body: 'Bookstr Android workflow run ID: 90041' }],
  }), '0.1-20261105-1932-r42');
  assert.equal(resolveAndroidReleaseVersion({
    ...run,
    releases: [{ tagName: 'v0.1-20261105-1932', body: null }],
  }), '0.1-20261105-1932-r42');
  assert.equal(resolveAndroidReleaseVersion({
    ...run,
    releases: [{ tag_name: 'v0.1-20261105-1932', body: 'Bookstr Android workflow run ID: 90041' }],
  }), '0.1-20261105-1932-r42');
  assert.equal(resolveAndroidReleaseVersion({
    ...run,
    releases: [
      { tagName: 'v0.1-20261105-1932', body: 'Bookstr Android workflow run ID: 90041' },
      {},
    ],
  }), '0.1-20261105-1932-r42');
});

test('refuses to reuse a collision suffix owned by a different workflow run', () => {
  assert.throws(() => resolveAndroidReleaseVersion({
    ...run,
    releases: [
      { tagName: 'v0.1-20261105-1932', body: 'Bookstr Android workflow run ID: 90041' },
      { tagName: 'v0.1-20261105-1932-r42', body: 'Bookstr Android workflow run ID: 90040' },
    ],
  }), /already owned by another workflow run/);
});

test('validates run identity and release-list inputs', () => {
  assert.throws(() => resolveAndroidReleaseVersion({ ...run, runNumber: '0', releases: [] }), /RUN_NUMBER/);
  assert.throws(() => resolveAndroidReleaseVersion({ ...run, runNumber: 'NaN', releases: [] }), /RUN_NUMBER/);
  assert.throws(() => resolveAndroidReleaseVersion({ ...run, runId: '', releases: [] }), /RUN_ID/);
  assert.throws(() => resolveAndroidReleaseVersion({ ...run, runId: 'not-numeric', releases: [] }), /RUN_ID/);
  assert.throws(() => resolveAndroidReleaseVersion({ ...run, runId: 12, releases: [] }), /RUN_ID/);
  assert.throws(() => resolveAndroidReleaseVersion({ ...run, releases: null }), /releases must be an array/);
  assert.equal(resolveAndroidReleaseVersion({ ...run, releases: [null] }), '0.1-20261105-1932');
});

test('finds the highest published Android run number and accepts legacy release tags', () => {
  assert.equal(latestPublishedAndroidRunNumber([]), 0);
  assert.equal(latestPublishedAndroidRunNumber([
    { tagName: 'v0.1-20261105-1932', body: 'Bookstr Android run number: 42' },
    { tag_name: 'v0.0.3-ci.101', body: 'older release without version metadata' },
    { tagName: 'v0.1-20261105-1933', body: 'Bookstr Android run number: 106' },
    { tagName: 'v0.1-20261105-1934', body: 'Bookstr Android run number: invalid' },
    { tagName: 'v0.1-20261105-1935', body: `Bookstr Android run number: ${Number.MAX_SAFE_INTEGER + 1}` },
    null,
    {},
  ]), 106);
  assert.throws(() => latestPublishedAndroidRunNumber(null), /releases must be an array/);
});
