const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, test, expect } = require('@playwright/test');

test('Downloads deletes failed and stopped entries using an accessible trash icon', async () => {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, 'delete-download-user-data-'));
  const app = await electron.launch({ args: [path.join(__dirname, '../..'), `--user-data-dir=${profile}`] });
  try {
    const window = await app.firstWindow();
    await app.evaluate(({ app }) => {
      const requireRuntime = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/main.js`);
      const { LibraryStore } = requireRuntime('./library-store');
      const root = `${app.getPath('userData')}/library`;
      const store = new LibraryStore({ dbPath: `${root}/library.sqlite`, libraryRoot: root });
      try {
        for (const status of ['failed', 'stopped', 'downloading', 'ready']) {
          store.upsertBook({ id: status, title: `Book ${status}`, extension: 'pdf' });
          store.setDownload({ bookId: status, status, source: 'fixture' });
        }
      } finally { store.close(); }
    });
    await window.getByRole('button', { name: 'Downloads', exact: true }).click();
    const failed = window.locator('[data-download-id="failed"]');
    const stopped = window.locator('[data-download-id="stopped"]');
    await expect(failed.getByRole('button', { name: 'Retry Book failed', exact: true })).toBeVisible();
    const trash = failed.getByRole('button', { name: 'Delete Book failed from Downloads', exact: true });
    await expect(trash.locator('svg')).toBeVisible();
    await expect(trash).toHaveText('');
    await expect(stopped.getByRole('button', { name: 'Retry Book stopped', exact: true })).toBeVisible();
    await expect(window.locator('[data-download-id="downloading"]').getByRole('button', { name: /Delete/ })).toHaveCount(0);
    expect(await window.evaluate(() => window.bookstrDesktop.library.removeDownload('ready').then(() => false, () => true))).toBe(true);
    await trash.click();
    await expect(failed).toHaveCount(0);
    await stopped.getByRole('button', { name: 'Delete Book stopped from Downloads', exact: true }).click();
    await expect(stopped).toHaveCount(0);
    await window.reload();
    await window.getByRole('button', { name: 'Downloads', exact: true }).click();
    await expect(window.locator('[data-download-id="failed"], [data-download-id="stopped"]')).toHaveCount(0);
    expect(await window.evaluate(async () => (await window.bookstrDesktop.library.getBook('failed')).title)).toBe('Book failed');
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('bookstr-desktop-library-downloads');
      ipcMain.handle('bookstr-desktop-library-downloads', () => [{ bookId: 'error', title: 'Blocked', status: 'failed' }]);
      ipcMain.removeHandler('bookstr-desktop-library-remove-download');
      ipcMain.handle('bookstr-desktop-library-remove-download', () => { throw new Error('Cannot delete now'); });
    });
    await window.getByRole('button', { name: 'Downloads', exact: true }).click();
    const blocked = window.locator('[data-download-id="error"]');
    await blocked.getByRole('button', { name: 'Delete Blocked from Downloads', exact: true }).click();
    await expect(blocked).toContainText('Cannot delete now');
    await expect(blocked.getByRole('button', { name: 'Delete Blocked from Downloads', exact: true })).toBeEnabled();
    await expect(blocked.getByRole('button', { name: 'Retry Blocked', exact: true })).toBeEnabled();
  } finally { await app.close(); }
});
