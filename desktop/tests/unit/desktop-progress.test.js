const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const progress = require('../../../web/desktop-progress');
const desktopRoot = path.join(__dirname, '../..');
const main = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(desktopRoot, 'preload.js'), 'utf8');

test('Electron adapters import the shared desktop progress contract', () => {
  assert.match(main, /require\('\.\.\/web\/desktop-progress'\)/);
  assert.equal(progress.normalizeProgressPayload({ md5: 'A', progression: 2 }).progression, 1);
  assert.equal(progress.normalizeProgressPayload({ md5: '' }), null);
  assert.equal(progress.clampProgress(Number.NaN), 0);
  assert.equal(progress.clampProgress(-1), 0);
  assert.equal(progress.clampProgress(0.4), 0.4);
  assert.equal(progress.normalizeProgressPayload(null), null);
  assert.equal(progress.normalizeProgressPayload({ md5: 'x', progression: 'bad' }).progression, 0);
  assert.equal(
    progress.normalizeProgressPayload({ md5: 'x', progression: 0.2 }, 'missing-profile').language,
    '',
  );
});

test('web progress profile trims aliases and rejects invalid progression', () => {
  assert.equal(progress.normalizeProgressPayload({ bookId: '  AB  ', progression: 'nope' }, 'web'), null);
  const normalized = progress.normalizeProgressPayload({
    book: { md5: ' CdEf ' },
    progression: 1.5,
    format: 'PDF',
    url: ' https://book.test/read ',
    author: 'Ada',
    locator: { furthestProgression: 0.8, locations: { cfi: '/6/2' } },
    source_native_id: 'native-1',
    source_url: 'https://src.test',
    blossom_url: 'https://blossom.test',
    blossom_sha256: 'hash',
    rightsStatus: 'public_domain',
    rights: 'PD',
    licenseUrl: 'https://license.test',
    rightsSource: 'catalog',
    language: 'EN',
  }, 'web');
  assert.deepEqual(normalized, {
    md5: 'cdef',
    readUrl: 'https://book.test/read',
    progression: 1,
    furthestProgression: 0.8,
    cfi: '/6/2',
    title: '',
    authors: 'Ada',
    year: '',
    extension: 'pdf',
    source: '',
    sourceNativeId: 'native-1',
    sourceUrl: 'https://src.test',
    blossomUrl: 'https://blossom.test',
    blossomSha256: 'hash',
    rights_status: 'public_domain',
    license: 'PD',
    license_url: 'https://license.test',
    rights_source: 'catalog',
    language: 'en',
  });
  assert.equal(
    progress.normalizeProgressPayload({
      md5: 'x',
      progression: 0.1,
      locator: { href: '/chapter' },
      furthestProgression: 'bad',
    }, 'web').cfi,
    '/chapter',
  );
  assert.equal(
    progress.normalizeProgressPayload({
      md5: 'x',
      progression: 0.1,
      furthestProgression: 'bad',
    }, 'web').furthestProgression,
    0,
  );
});

test('sandboxed preload preserves its permissive transport shape before main validation', () => {
  const sent = [];
  const context = {
    process: { argv: [] },
    window: { addEventListener() {} },
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld(_name, bridge) { context.bridge = bridge; } },
        ipcRenderer: { on() {}, send(...args) { sent.push(args); }, invoke() { return Promise.resolve(); } },
      };
    },
  };
  vm.runInNewContext(preload, context);
  context.bridge.reportProgress({ md5: '', progression: 'bad' });
  context.bridge.reportProgress({
    md5: ' AABB ', readUrl: ' https://book.test/read ', extension: 'PDF', progression: 0.5,
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), ['bookstr-desktop-report-progress', {
    md5: ' aabb ', readUrl: ' https://book.test/read ', progression: 0.5, cfi: '', title: '', authors: '',
    year: '', extension: 'pdf', source: '', sourceNativeId: '', sourceUrl: '', blossomUrl: '',
    blossomSha256: '', rights_status: 'unknown', license: '', license_url: '', rights_source: '',
    furthestProgression: 0,
  }]);
});
