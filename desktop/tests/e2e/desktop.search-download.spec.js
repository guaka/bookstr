const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, test, expect } = require('@playwright/test');

for (const action of ['title', 'plus']) {
  test(`search ${action} click shows a download, including a previously hidden completed book`, async () => {
    const output = path.join(__dirname, '../../test-results');
    fs.mkdirSync(output, { recursive: true });
    const profile = fs.mkdtempSync(path.join(output, 'search-download-user-data-'));
    const app = await electron.launch({ args: [path.join(__dirname, '../..'), `--user-data-dir=${profile}`] });
    try {
      const page = await app.firstWindow();
      await expect(page.getByRole('button', { name: 'Search, Command 3' })).toBeVisible();
      await page.waitForFunction(() => typeof renderResults === 'function');
      await app.evaluate(({ app, ipcMain }) => {
        const requireRuntime = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/main.js`);
        const { AcquisitionManager } = requireRuntime('./acquisition-manager');
        const { LibraryStore } = requireRuntime('./library-store');
        const root = `${app.getPath('userData')}/library`;
        const store = new LibraryStore({ dbPath: `${root}/library.sqlite`, libraryRoot: root });
        globalThis.searchDownloadStore = store;
        {
          store.upsertBook({ id: 'b'.repeat(32), title: 'Existing fixture', extension: 'pdf', sourceNativeId: '12346' });
          store.setDownload({ bookId: 'b'.repeat(32), status: 'ready' });
        }
        ipcMain.removeHandler('bookstr-desktop-library-downloads');
        ipcMain.handle('bookstr-desktop-library-downloads', () => {
          const rows = store.downloads();
          if (globalThis.delayNextDownloads) {
            globalThis.delayNextDownloads = false;
            return new Promise(resolve => { globalThis.releaseOlderSnapshot = () => resolve(rows); });
          }
          return rows;
        });
        globalThis.searchDownloadStarts = [];
        globalThis.releaseSearchDownloads = [];
        AcquisitionManager.prototype.acquireLibgen = function(record) {
          globalThis.searchDownloadStarts.push(record.md5);
          this.store.setDownload({ bookId: record.md5, status: 'downloading', totalBytes: 100 });
          return new Promise(resolve => globalThis.releaseSearchDownloads.push(resolve));
        };
      });
      const renderSearch = () => page.evaluate(() => {
        queryInput.value = 'fixture';
        activateTab('search');
        renderResults(normalizeSearchBooks({ books: [
          { md5: 'a'.repeat(32), libgen_id: 12345, title: 'New fixture', extension: 'pdf', collection: 'nonfiction' },
          { md5: 'b'.repeat(32), libgen_id: 12346, title: 'Existing fixture', extension: 'pdf', collection: 'nonfiction' },
        ] }, 'libvault'));
      });
      const clickBook = title => action === 'title'
        ? page.locator('#results [data-action="open"]').filter({ hasText: title }).click()
        : page.getByRole('button', { name: `Add ${title} to downloads`, exact: true }).click();
      await renderSearch();
      await app.evaluate(() => { globalThis.delayNextDownloads = true; });
      await page.evaluate(() => { window.pendingDownloadsRender = renderDesktopDownloads(); });
      await expect.poll(() => app.evaluate(() => typeof globalThis.releaseOlderSnapshot)).toBe('function');
      await clickBook('New fixture');
      await expect(page.getByRole('region', { name: 'Downloads', exact: true })).toBeVisible();
      await expect(page.locator(`[data-download-id="${'a'.repeat(32)}"]`)).toContainText('New fixture');
      await expect.poll(() => app.evaluate(() => globalThis.searchDownloadStarts.length)).toBe(1);
      expect(await page.evaluate(() => location.hash)).not.toContain('read=');
      await app.evaluate(() => globalThis.releaseOlderSnapshot());
      await page.evaluate(() => window.pendingDownloadsRender);
      await expect(page.locator(`[data-download-id="${'a'.repeat(32)}"]`)).toBeVisible();
      await renderSearch();
      await clickBook('Existing fixture');
      await expect(page.locator(`[data-download-id="${'b'.repeat(32)}"]`)).toContainText('Ready to read');
      expect(await app.evaluate(() => globalThis.searchDownloadStarts.length)).toBe(1);
      await page.getByRole('button', { name: 'Home, Command 1' }).click();
      await page.getByRole('button', { name: 'Downloads', exact: true }).click();
      await expect(page.locator(`[data-download-id="${'b'.repeat(32)}"]`)).toHaveCount(0);
    } finally {
      await app.evaluate(() => globalThis.releaseSearchDownloads?.forEach(resolve => resolve()));
      await app.evaluate(() => globalThis.searchDownloadStore?.close());
      await app.close();
    }
  });
}

test('a real-shaped Libcat record without a torrent edition remains in Downloads with retry and delete', async () => {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, 'catalog-unavailable-user-data-'));
  const app = await electron.launch({ args: [path.join(__dirname, '../..'), `--user-data-dir=${profile}`] });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: 'Search, Command 3' })).toBeVisible();
    await page.evaluate(() => {
      globalThis.catalogResolveAttempts = 0;
      resolvePrivateTorrentBook = async () => {
        globalThis.catalogResolveAttempts++;
        throw new Error('No downloadable edition matched this book.');
      };
      queryInput.value = 'jujutsu 12';
      activateTab('search');
      renderResults(normalizeSearchBooks({ books: [{ md5: 'e14c173dc198a3524d3fe65e92572ac9',
        title: 'Jujutsu Kaisen vol. 12', extension: 'epub', id: 0, collection: 'zlib' }] }, 'libvault'));
    });
    await page.locator('#results .result-title').filter({ hasText: 'Jujutsu Kaisen vol. 12' }).click();
    const row = page.locator('[data-download-id="e14c173dc198a3524d3fe65e92572ac9"]');
    await expect(row).toContainText('No downloadable edition matched this book.');
    await expect(row.getByRole('button', { name: 'Retry Jujutsu Kaisen vol. 12', exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Retry Jujutsu Kaisen vol. 12', exact: true }).click();
    await expect.poll(() => page.evaluate(() => globalThis.catalogResolveAttempts)).toBe(2);
    await expect(row).toContainText('No downloadable edition matched this book.');
    expect(await page.evaluate(async () => (await bookstrDesktop.library.downloads()).find(row => row.bookId === 'e14c173dc198a3524d3fe65e92572ac9').status)).toBe('failed');
    await row.getByRole('button', { name: 'Delete Jujutsu Kaisen vol. 12 from Downloads', exact: true }).click();
    await expect(row).toHaveCount(0);
  } finally { await app.close(); }
});
