import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transferableDownloads, progressText } = require('../desktop-kindle.js');

test('transferable downloads keep completed PDF TXT and comic archives', () => {
  const jobs = transferableDownloads([
    { bookId: '1', status: 'ready', extension: 'pdf', title: 'PDF' },
    { bookId: '2', status: 'seeding', extension: 'txt', title: 'TXT' },
    { bookId: '3', status: 'ready', extension: 'cbz', title: 'Comic' },
    { bookId: '4', status: 'ready', extension: 'epub', title: 'Mislabelled.cbz' },
    { bookId: '5', status: 'downloading', extension: 'pdf', title: 'Busy' },
    { bookId: '6', status: 'ready', extension: 'epub', title: 'Real EPUB' },
  ]);
  assert.deepEqual(jobs.map(job => job.bookId), ['1', '2', '3', '4']);
});

test('progress text includes phase title percent and page counts', () => {
  assert.equal(
    progressText({ phase: 'converting', title: 'Naruto', percent: 12.4, page: 3, pages: 10 }),
    'Converting Naruto · 12% · 3/10 pages',
  );
  assert.equal(progressText({ phase: 'verifying' }), 'Verifying');
});


test('per-device presence rejects stale scans and forgets disconnected devices', () => {
  const { createLibraryPresence } = require('../desktop-kindle.js');
  const state = createLibraryPresence();
  assert.equal(state.has('kindle', 'book'), false);
  assert.equal(state.failed('kindle', 'book'), false);
  const old = state.begin('kindle');
  state.mark('kindle', ['book']);
  assert.equal(state.apply(old, []), false);
  assert.equal(state.has('kindle', 'book'), true);
  state.fail('kindle', 'book');
  assert.equal(state.has('kindle', 'book'), false);
  assert.equal(state.failed('kindle', 'book'), true);
  const scan = state.begin('kindle');
  assert.equal(state.apply(scan, ['book']), true);
  assert.equal(state.failed('kindle', 'book'), false);
  state.fail('kindle', 'book');
  state.mark('kindle', ['book']);
  assert.equal(state.failed('kindle', 'book'), false);
  state.retain(['kindle']);
  assert.equal(state.has('kindle', 'book'), true);
  const disconnectedScan = state.begin('kindle');
  state.retain([]);
  state.begin('kindle');
  assert.equal(state.apply(disconnectedScan, ['book']), false);
  assert.equal(state.has('kindle', 'book'), false);
  assert.equal(state.has('other', 'book'), false);
});


test('transfer overview follows conversion, copy, verified completion and result details', () => {
  const { createTransferOverview } = require('../desktop-kindle.js');
  const overview = createTransferOverview();
  overview.update({ phase: 'copying' });
  assert.equal(overview.snapshot(), undefined);
  overview.start([{ bookId: 'comic', title: 'Manga' }, { bookId: 'existing', title: 'Existing' },
    { bookId: 'unsupported', title: 'Unsupported' }, { bookId: 'failed' }]);
  assert.equal(overview.snapshot().determinate, false);
  overview.update({ phase: 'converting', bookId: 'comic', page: 2, pages: 10 });
  assert.equal(overview.snapshot().value, 20);
  assert.equal(overview.snapshot().items[0].status, 'Converting · 2/10 pages');
  overview.update({ phase: 'copying', bookId: 'comic', percent: 53, completed: 0 });
  assert.equal(overview.snapshot().value, 53);
  overview.update({ phase: 'copied', bookId: 'comic', completed: 1 });
  assert.equal(overview.snapshot().items[0].status, 'Copied');
  assert.equal(overview.snapshot().completed, 1);
  overview.update({ phase: 'failed', bookId: 'failed', error: 'No space' });
  assert.equal(overview.snapshot().items[3].status, 'Failed: No space');
  overview.update({ phase: 'checking' });
  assert.equal(overview.snapshot().determinate, false);
  overview.update({ done: true });
  assert.equal(overview.snapshot().running, true, 'wait for the final result before completing');
  overview.finish({ transferred: ['comic'], alreadyPresent: 1,
    skipped: [{ title: 'Unsupported', reason: 'unsupported format' }], errors: [{ bookId: 'failed', error: 'No space' }] });
  assert.deepEqual(overview.snapshot().items.map(item => item.status), ['Copied', 'Already on Kindle', 'Skipped: unsupported format', 'Failed: No space']);
  assert.equal(overview.snapshot().message, '1 copied · 1 already there · 1 skipped · 1 failed');
  assert.equal(overview.snapshot().running, false);
  overview.update({ phase: 'copying' });
  assert.equal(overview.snapshot().value, 4);
});

test('transfer overview clamps progress, resets on retry, and reports interrupted copies honestly', () => {
  const { createTransferOverview } = require('../desktop-kindle.js');
  const overview = createTransferOverview();
  overview.start([{ bookId: 'copied' }, { bookId: 'pending' }]);
  overview.update({ phase: 'copying', percent: 999, completed: 999 });
  assert.equal(overview.snapshot().value, 100);
  assert.equal(overview.snapshot().completed, 2);
  overview.update({ phase: 'copying', percent: -5, completed: -5 });
  assert.equal(overview.snapshot().value, 0);
  assert.equal(overview.snapshot().completed, 0);
  overview.update({ phase: 'copied', bookId: 'copied', completed: 1 });
  overview.fail(new Error('Disconnected'));
  assert.equal(overview.snapshot().message, 'Disconnected');
  assert.deepEqual(overview.snapshot().items.map(item => item.status), ['Copied', 'Not completed']);
  overview.start([{ bookId: 'retry' }]);
  assert.equal(overview.snapshot().items[0].status, 'Waiting');
  overview.fail('USB error');
  assert.equal(overview.snapshot().message, 'USB error');
  overview.start([{ bookId: 'unknown' }]);
  overview.finish({ transferred: [] });
  assert.equal(overview.snapshot().items[0].status, 'Not completed');
  overview.start([]);
  overview.finish({ transferred: [] });
  assert.equal(overview.snapshot().max, 1);
});
