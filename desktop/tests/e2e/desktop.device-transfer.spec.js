const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, test, expect } = require('@playwright/test');

function electronArgs() {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, 'device-transfer-user-data-'));
  return [path.join(__dirname, '../..'), `--user-data-dir=${userData}`];
}

test('Electron exposes private device discovery and guarded transfer controls', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const window = await app.firstWindow();
    await window.getByRole('button', { name: 'Devices, Command 4' }).click();
    const panel = window.locator('#device-transfer-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Paired devices' })).toBeVisible();
    await expect(panel).not.toContainText(/torrent|magnet|peer/i);
    await expect(window.locator('#device-transfer-summary')).toContainText('Bookstr desktop');
    await window.getByRole('button', { name: 'Prepare private presence' }).click();
    await expect(window.locator('#device-transfer-result')).toContainText('Private presence prepared');

    await window.locator('#device-private-torrent').fill('book-transfer-code');
    await window.locator('#device-private-peer').fill('paired-device-code');
    await window.locator('#device-private-transfer-form').getByRole('button', { name: 'Receive book privately' }).click();
    await expect(window.locator('#device-transfer-result')).toContainText('Private book transfer could not start');
  } finally {
    await app.close();
  }
});

test('Library sends one manga to Kindle and shows progress, duplicates and errors in place', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const window = await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      const id = '3'.repeat(32);
      for (const channel of ['bookstr-desktop-library-downloads', 'bookstr-desktop-kindle-devices', 'bookstr-desktop-kindle-transfer', 'bookstr-desktop-kindle-presence']) ipcMain.removeHandler(channel);
      ipcMain.handle('bookstr-desktop-library-downloads', () => [{
        bookId: id, md5: id, title: 'Kindle Manga Fixture', authors: 'Fixture',
        extension: 'cbz', status: 'ready', readable: true, completedAt: 1,
      }]);
      ipcMain.handle('bookstr-desktop-kindle-devices', () => [{ id: 'fixture-kindle', name: 'Kindle', kind: 'mtp' }]);
      globalThis.kindlePresenceFixture = [];
      ipcMain.handle('bookstr-desktop-kindle-presence', () => ({ deviceId: 'fixture-kindle', bookIds: globalThis.kindlePresenceFixture }));
      globalThis.kindleCalls = [];
      ipcMain.handle('bookstr-desktop-kindle-transfer', (_event, deviceId, bookId) => {
        globalThis.kindleCalls.push({ deviceId, bookId });
        return new Promise((resolve, reject) => { globalThis.finishKindle = { resolve, reject }; });
      });
    });
    await window.reload();
    await window.getByRole('button', { name: 'Home, Command 1' }).click();
    await window.evaluate(async () => { await refreshDesktopDownloadStates(); renderHome(); });
    const send = window.getByRole('button', { name: 'Send Kindle Manga Fixture to Kindle', exact: true });
    await expect(send).toBeVisible();
    await send.click();
    await expect(send).toHaveText('Sending…');
    await expect(window.locator('#kindle-transfer-overview')).toBeVisible();
    await expect(window.locator('#kindle-transfer-status')).toHaveText('Preparing Kindle transfer…');
    await expect(window.locator('#kindle-transfer-dismiss')).toBeDisabled();
    await expect(send).toHaveAttribute('aria-busy', 'true');
    await expect(send).toBeDisabled();
    await expect.poll(() => app.evaluate(() => globalThis.kindleCalls.length)).toBe(1);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('bookstr-desktop-kindle-progress', {
        phase: 'converting', bookId: '3'.repeat(32), page: 1, pages: 20,
      });
    });
    await expect(window.locator('#desktop-kindle-summary')).toHaveText('Converting · 1/20 pages');
    await expect(send).toHaveAttribute('title', 'Converting · 1/20 pages');
    await expect(window.locator('#kindle-transfer-status')).toHaveText('Converting · 1/20 pages');
    await expect(window.locator('#kindle-transfer-progress')).toHaveJSProperty('value', 5);
    await expect(window.locator('#kindle-transfer-count')).toHaveText('0 / 1 copied');
    await app.evaluate(() => { globalThis.kindlePresenceFixture = ['3'.repeat(32)]; globalThis.finishKindle.resolve({ transferred: ['3'.repeat(32)], alreadyPresent: 0, errors: [] }); });
    await expect(send).toHaveText('On Kindle');
    await expect(send).toBeEnabled();
    await expect(send).not.toHaveAttribute('aria-busy');
    await expect(window.locator('#desktop-kindle-summary')).toHaveText('Copied to Kindle');
    await expect(window.locator('#kindle-transfer-status')).toHaveText('1 copied · 0 already there · 0 skipped · 0 failed');
    await expect(window.locator('#kindle-transfer-items')).toContainText('Kindle Manga Fixture');
    await expect(window.locator('#kindle-transfer-items')).toContainText('Copied');
    await expect(window.locator('#kindle-transfer-progress')).toBeHidden();
    await expect(window.locator('#kindle-transfer-dismiss')).toBeEnabled();
    await window.evaluate(async () => { await refreshDesktopDownloadStates(); renderHome(); await refreshKindleOffer(); });
    await expect(send).toHaveText('On Kindle');

    await send.click();
    await expect(send).toBeDisabled();
    await expect.poll(() => app.evaluate(() => globalThis.kindleCalls.length)).toBe(2);
    await app.evaluate(() => globalThis.finishKindle.resolve({ transferred: [], alreadyPresent: 1, errors: [] }));
    await expect(send).toHaveText('On Kindle');
    await expect(window.locator('#desktop-kindle-summary')).toHaveText('Already on Kindle');

    await send.click();
    await expect(send).toBeDisabled();
    await expect.poll(() => app.evaluate(() => globalThis.kindleCalls.length)).toBe(3);
    await app.evaluate(() => globalThis.finishKindle.reject(new Error('Kindle disconnected.')));
    await expect(send).toHaveText('Retry');
    await expect(send).toBeEnabled();
    await expect(window.locator('#desktop-kindle-summary')).toContainText('Kindle disconnected.');
    await expect(window.locator('#kindle-transfer-status')).toContainText('Kindle disconnected.');
    await window.getByRole('button', { name: 'Dismiss Kindle transfer status' }).click();
    await expect(window.locator('#kindle-transfer-overview')).toBeHidden();
    expect(await app.evaluate(() => globalThis.kindleCalls)).toEqual(Array.from({ length: 3 }, () => ({
      deviceId: 'fixture-kindle', bookId: '3'.repeat(32),
    })));
  } finally { await app.close(); }
});


test('Library marks other exported books from presence without a transfer or repeated checking on filter', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const window = await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      for (const name of ['library-downloads', 'kindle-devices', 'kindle-presence', 'kindle-transfer']) ipcMain.removeHandler(`bookstr-desktop-${name}`);
      ipcMain.handle('bookstr-desktop-library-downloads', () => [{ bookId: 'existing', title: 'Already exported comic', extension: 'cbz', status: 'ready', readable: true }]);
      globalThis.presenceKindleConnected = true;
      ipcMain.handle('bookstr-desktop-kindle-devices', () => globalThis.presenceKindleConnected ? [{ id: 'fixture', name: 'Kindle', kind: 'mtp' }] : []);
      globalThis.presenceReads = 0;
      ipcMain.handle('bookstr-desktop-kindle-presence', () => { globalThis.presenceReads++; return { deviceId: 'fixture', bookIds: ['existing'] }; });
      ipcMain.handle('bookstr-desktop-kindle-transfer', () => { throw new Error('Presence must not transfer books'); });
    });
    await window.reload();
    await window.getByRole('button', { name: 'Home, Command 1' }).click();
    await window.evaluate(async () => { await refreshDesktopDownloadStates(); await refreshKindleOffer(); });
    const button = window.locator('[data-action="send-kindle"][data-kindle-book-id="existing"]');
    await expect(button).toHaveText('On Kindle');
    const reads = await app.evaluate(() => globalThis.presenceReads);
    for (const query of ['comic', 'Already', '']) await window.locator('#home-query-input').fill(query);
    await expect(button).toHaveText('On Kindle');
    expect(await app.evaluate(() => globalThis.presenceReads)).toBe(reads);
    await app.evaluate(() => { globalThis.presenceKindleConnected = false; });
    await window.evaluate(() => refreshKindleOffer());
    await expect(button).toBeHidden();
    await app.evaluate(() => { globalThis.presenceKindleConnected = true; });
    await window.evaluate(() => refreshKindleOffer());
    await expect(button).toBeVisible();
  } finally { await app.close(); }
});

test('Kindle bulk overview shows per-book results and keeps progress when navigating', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const window = await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      for (const channel of ['bookstr-desktop-library-downloads', 'bookstr-desktop-kindle-devices', 'bookstr-desktop-kindle-presence', 'bookstr-desktop-kindle-transfer']) ipcMain.removeHandler(channel);
      ipcMain.handle('bookstr-desktop-library-downloads', () => ['copied', 'existing', 'skipped', 'failed'].map(bookId => ({
        bookId, title: `Book ${bookId}`, extension: 'pdf', status: 'ready', readable: true,
      })));
      ipcMain.handle('bookstr-desktop-kindle-devices', () => [{ id: 'fixture-kindle', name: 'Kindle', kind: 'mtp' }]);
      ipcMain.handle('bookstr-desktop-kindle-presence', () => ({ bookIds: [] }));
      ipcMain.handle('bookstr-desktop-kindle-transfer', () => new Promise(resolve => { globalThis.finishOverview = resolve; }));
    });
    await window.reload();
    await window.evaluate(async () => { await refreshDesktopDownloadStates(); await refreshKindleOffer(); });
    await window.locator('#desktop-kindle-transfer').click();
    await window.locator('#desktop-kindle-select-visible').check();
    await window.locator('#desktop-kindle-selection-send').click();
    await expect(window.locator('#kindle-transfer-overview')).toBeVisible();
    await expect(window.locator('#kindle-transfer-count')).toHaveText('0 / 4 copied');
    await expect.poll(() => app.evaluate(() => typeof globalThis.finishOverview)).toBe('function');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('bookstr-desktop-kindle-progress', {
      phase: 'copying', title: 'Book failed', bookId: 'failed', percent: 42, completed: 1, total: 2,
    }));
    await expect(window.locator('#kindle-transfer-count')).toHaveText('1 / 4 copied');
    await expect(window.locator('#kindle-transfer-progress')).toHaveJSProperty('value', 42);
    await window.getByRole('button', { name: 'Devices, Command 4' }).click();
    await expect(window.locator('#kindle-transfer-overview')).toBeVisible();
    await app.evaluate(() => globalThis.finishOverview({ transferred: ['copied'], alreadyPresent: 1,
      skipped: [{ title: 'Book skipped', reason: 'Unreadable file' }], errors: [{ bookId: 'failed', error: 'Disconnected' }] }));
    await expect(window.locator('#kindle-transfer-status')).toHaveText('1 copied · 1 already there · 1 skipped · 1 failed');
    await expect(window.locator('[data-kindle-transfer-book-id="copied"]')).toContainText('Copied');
    await expect(window.locator('[data-kindle-transfer-book-id="existing"]')).toContainText('Already on Kindle');
    await expect(window.locator('[data-kindle-transfer-book-id="skipped"]')).toContainText('Skipped: Unreadable file');
    await expect(window.locator('[data-kindle-transfer-book-id="failed"]')).toContainText('Failed: Disconnected');
  } finally { await app.close(); }
});
