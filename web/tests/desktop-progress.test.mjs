import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { clampProgress, isProgressAhead, progressPosition, normalizeProgressPayload } = require('../desktop-progress.js');

test('clamps desktop progress values into the reader range', () => {
  assert.equal(clampProgress('bad'), 0);
  assert.equal(clampProgress(-0.1), 0);
  assert.equal(clampProgress('0.4'), 0.4);
  assert.equal(clampProgress(4), 1);
});

test('compares remote reading positions by furthest progress, then current progress', () => {
  assert.deepEqual(progressPosition({ progression: 0.4, furthestProgression: 0.7 }), {
    progression: 0.4,
    furthestProgression: 0.7,
  });
  assert.equal(isProgressAhead(
    { progression: 0.5, furthestProgression: 0.8 },
    { progression: 0.7, furthestProgression: 0.7 },
  ), true);
  assert.equal(isProgressAhead(
    { progression: 0.5, furthestProgression: 0.8 },
    { progression: 0.6, furthestProgression: 0.8 },
  ), false);
  assert.equal(isProgressAhead(
    { progression: 0.7, furthestProgression: 0.8 },
    { progression: 0.6, furthestProgression: 0.8 },
  ), true);
});

test('main-process profile keeps Electron transport strict and preserves its values', () => {
  assert.equal(normalizeProgressPayload(null), null);
  assert.equal(normalizeProgressPayload({ md5: '   ' }), null);
  assert.equal(normalizeProgressPayload({ book: { md5: 'a'.repeat(32) }, progression: 0.5 }), null);
  assert.deepEqual(normalizeProgressPayload({ md5: 'sparse', progression: 0.2 }, 'main'), {
    md5: 'sparse', readUrl: '', progression: 0.2, furthestProgression: 0, cfi: '', title: '',
    authors: '', year: '', extension: 'epub', language: '', source: '', sourceNativeId: '',
    sourceUrl: '', blossomUrl: '', blossomSha256: '', rights_status: 'unknown', license: '',
    license_url: '', rights_source: '',
  });

  assert.deepEqual(normalizeProgressPayload({
    bookId: ' ABCD ',
    progression: 'bad',
    furthestProgression: 2,
    readUrl: ' https://book.test/read ',
    cfi: 7,
    title: 'Title',
    authors: 'Author',
    extension: 'PDF',
    language: 'PT-BR',
    source: 'catalog',
    sourceNativeId: 'native',
    sourceUrl: 'https://source.test',
    blossomUrl: 'https://blob.test',
    blossomSha256: 'sha',
    rightsStatus: 'open_license',
    rights: 'CC0',
    licenseUrl: 'https://license.test',
    rightsSource: 'metadata',
  }, 'main'), {
    md5: 'abcd',
    readUrl: ' https://book.test/read ',
    progression: 0,
    furthestProgression: 1,
    cfi: '7',
    title: 'Title',
    authors: 'Author',
    year: '',
    extension: 'PDF',
    language: 'PT-BR',
    source: 'catalog',
    sourceNativeId: 'native',
    sourceUrl: 'https://source.test',
    blossomUrl: 'https://blob.test',
    blossomSha256: 'sha',
    rights_status: 'open_license',
    license: 'CC0',
    license_url: 'https://license.test',
    rights_source: 'metadata',
  });
});

test('web profile retains richer aliases and web progress semantics', () => {
  assert.equal(normalizeProgressPayload({ md5: 'a', progression: 'bad' }, 'web'), null);

  assert.deepEqual(normalizeProgressPayload({
    book: { md5: ' AABB ' },
    url: ' https://book.test/read ',
    progression: -1,
    locator: { locations: { cfi: 'epubcfi(/6/2)' }, furthestProgression: 1.7 },
    author: 'Author alias',
    format: 'PDF',
    source_native_id: 'source-id',
    source_url: 'https://source.test',
    blossom_url: 'https://blossom.test',
    blossom_sha256: 'hash',
  }, 'web'), {
    md5: 'aabb',
    readUrl: 'https://book.test/read',
    progression: 0,
    furthestProgression: 1.7,
    cfi: 'epubcfi(/6/2)',
    title: '',
    authors: 'Author alias',
    year: '',
    extension: 'pdf',
    language: '',
    source: '',
    sourceNativeId: 'source-id',
    sourceUrl: 'https://source.test',
    blossomUrl: 'https://blossom.test',
    blossomSha256: 'hash',
    rights_status: 'unknown',
    license: '',
    license_url: '',
    rights_source: '',
  });

  assert.equal(normalizeProgressPayload({
    md5: 'href', progression: 0.5, locator: { href: 'chapter.xhtml' },
  }, 'web').cfi, 'chapter.xhtml');

  assert.equal(normalizeProgressPayload({ md5: 'FALLBACK', progression: 0.4 }, 'unknown').md5, 'fallback');
});

test('exposes the same dependency-free API to browser scripts', async () => {
  const source = await readFile(new URL('../desktop-progress.js', import.meta.url), 'utf8');
  const context = { globalThis: {} };
  vm.runInNewContext(source, context);
  assert.equal(typeof context.globalThis.BookstrDesktopProgress.normalizeProgressPayload, 'function');
  assert.equal(context.globalThis.BookstrDesktopProgress.clampProgress(3), 1);

});

test('progress comparison normalizes missing and invalid positions', () => {
  assert.deepEqual(progressPosition({}), {
    progression: 0,
    furthestProgression: 0,
  });
  assert.deepEqual(progressPosition({ progression: 'bad', furthestProgression: 2 }), {
    progression: 0,
    furthestProgression: 1,
  });
  assert.equal(isProgressAhead({}, {}), false);
  assert.equal(isProgressAhead({ progression: 0.1 }, { progression: 0.1 }), false);
  assert.equal(isProgressAhead({ furthestProgression: 0.9 }, { furthestProgression: 0.8 }), true);
  assert.deepEqual(progressPosition({ locator: { progression: 0.3, furthestProgression: 0.4 } }), {
    progression: 0.3,
    furthestProgression: 0.4,
  });
});
