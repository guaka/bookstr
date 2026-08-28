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
});

test('sandboxed preload preserves its permissive transport shape before main validation', () => {
  const sent = [];
  const context = {
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
