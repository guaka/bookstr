function isDevelopmentMode({ isPackaged, nodeEnv, testOverride } = {}) {
  if (nodeEnv === 'test' && testOverride !== undefined) {
    return String(testOverride) === '1';
  }
  return !isPackaged;
}

function visibleLibraryPanes(panes, developmentMode) {
  return developmentMode ? panes : panes.filter(item => item.pane !== 'people');
}

module.exports = { isDevelopmentMode, visibleLibraryPanes };
