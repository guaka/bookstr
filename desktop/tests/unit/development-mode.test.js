const test = require('node:test');
const assert = require('node:assert/strict');

const { isDevelopmentMode, visibleLibraryPanes } = require('../../development-mode');

test('source builds enable development mode and packaged builds disable it', () => {
  assert.equal(isDevelopmentMode({ isPackaged: false }), true);
  assert.equal(isDevelopmentMode({ isPackaged: true }), false);
});

test('tests can explicitly exercise either development-mode branch', () => {
  assert.equal(isDevelopmentMode({ isPackaged: false, nodeEnv: 'test', testOverride: '0' }), false);
  assert.equal(isDevelopmentMode({ isPackaged: true, nodeEnv: 'test', testOverride: '1' }), true);
  assert.equal(isDevelopmentMode({ isPackaged: false, nodeEnv: 'production', testOverride: '0' }), true);
});

test('production panes exclude People without changing the development pane list', () => {
  const panes = [{ pane: 'home' }, { pane: 'people' }, { pane: 'words' }];
  assert.equal(visibleLibraryPanes(panes, true), panes);
  assert.deepEqual(visibleLibraryPanes(panes, false), [{ pane: 'home' }, { pane: 'words' }]);
});
