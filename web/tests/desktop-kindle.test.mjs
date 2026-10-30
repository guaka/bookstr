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
