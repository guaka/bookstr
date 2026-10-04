const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, test, expect } = require('@playwright/test');

function electronArgs() {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, 'search-user-data-'));
  return [path.join(__dirname, '../..'), `--user-data-dir=${userData}`];
}

test('Electron exposes Libcat as its only active search source', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Search' }).click();
    const rows = page.locator('#search-sources-table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-source', 'libcat');
    await expect(rows).toContainText('Libcat');
  } finally {
    await app.close();
  }
});

test('a slower previous Electron search cannot overwrite a newer query', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      nip17FetchModule = Promise.resolve({ searchLibcat: async query => {
        if (query === 'older') await new Promise(resolve => setTimeout(resolve, 700));
        return { books: [{
          md5: query === 'older' ? 'a'.repeat(32) : 'b'.repeat(32),
          title: query === 'older' ? 'Older Search Result' : 'Newer Search Result',
          authors: ['Fixture Author'], extension: 'epub',
        }] };
      } });
    });

    await page.getByRole('button', { name: 'Search' }).click();
    const query = page.getByRole('textbox', { name: 'Book search query' });
    await query.fill('older');
    await query.press('Enter');
    await query.fill('newer');
    await query.press('Enter');
    await expect(page.locator('#results')).toContainText('Newer Search Result');
    await page.waitForTimeout(900);
    await expect(page.locator('#results')).toContainText('Newer Search Result');
    await expect(page.locator('#results')).not.toContainText('Older Search Result');
  } finally {
    await app.close();
  }
});

test('clicking a Libcat title queues it and opens Downloads', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ ipcMain }) => {
      globalThis.queuedBooks = [];
      ipcMain.removeHandler('bookstr-desktop-library-enqueue');
      ipcMain.handle('bookstr-desktop-library-enqueue', (_event, request) => {
        globalThis.queuedBooks.push(request);
        return { bookId: request.record.md5, status: 'queued' };
      });
      ipcMain.removeHandler('bookstr-desktop-library-downloads');
      ipcMain.handle('bookstr-desktop-library-downloads', () => globalThis.queuedBooks.map(request => ({
        bookId: request.record.md5, md5: request.record.md5, title: request.record.title,
        status: 'queued', queuedFromSearch: true, readable: false, completedAt: null,
      })));
    });
    await page.evaluate(() => {
      nip17FetchModule = Promise.resolve({ searchLibcat: async () => ({ books: [{
        md5: 'c'.repeat(32), libgenId: 12345, source: 'libvault', title: 'Clickable Libcat Result',
        authors: ['Fixture Author'], language: 'en', extension: 'pdf',
      }] }) });
    });

    await page.getByRole('button', { name: 'Search' }).click();
    const query = page.getByRole('textbox', { name: 'Book search query' });
    await query.fill('clickable');
    await query.press('Enter');
    await page.getByRole('link', { name: 'Clickable Libcat Result', exact: true }).click();
    await expect(page.locator('#downloads-tab')).toBeVisible();
    await expect(page.locator('#desktop-downloads-list')).toContainText('Clickable Libcat Result');
    await expect(page.locator('#desktop-downloads-list')).toContainText('Queued');
    expect(await app.evaluate(() => globalThis.queuedBooks)).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('Libcat search plus opens Downloads while the heart stays a separate action', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ ipcMain }) => {
      globalThis.queuedBooks = [];
      ipcMain.removeHandler('bookstr-desktop-library-enqueue');
      ipcMain.handle('bookstr-desktop-library-enqueue', (_event, request) => {
        globalThis.queuedBooks.push(request);
        return { bookId: request.record.md5, status: 'queued' };
      });
      ipcMain.removeHandler('bookstr-desktop-library-downloads');
      ipcMain.handle('bookstr-desktop-library-downloads', () => globalThis.queuedBooks.map(request => ({
        bookId: request.record.md5, md5: request.record.md5, title: request.record.title,
        status: 'queued', queuedFromSearch: true, readable: false, completedAt: null,
      })));
      ipcMain.removeHandler('bookstr-desktop-kindle-devices');
      ipcMain.handle('bookstr-desktop-kindle-devices', () => []);
    });
    await page.evaluate(() => {
      nip17FetchModule = Promise.resolve({ searchLibcat: async () => ({ books: [{
        md5: 'a'.repeat(32), libgenId: 2412930, source: 'libvault',
        title: 'Download Fixture', authors: ['Fixture Author'], extension: 'pdf',
        readUrl: 'https://files.test/download-fixture.pdf',
      }] }) });
    });
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('textbox', { name: 'Book search query' }).fill('download fixture');
    await page.getByRole('textbox', { name: 'Book search query' }).press('Enter');
    await expect(page.locator('#results')).toContainText('Download Fixture');
    await page.getByRole('button', { name: 'Add Download Fixture to downloads' }).click();
    await expect(page.locator('#downloads-tab')).toBeVisible();
    await expect(page.locator('#desktop-downloads-list')).toContainText('Download Fixture');
    await expect(page.locator('#desktop-downloads-list')).toContainText('Queued');
    expect(await app.evaluate(() => globalThis.queuedBooks)).toHaveLength(1);
    expect(await page.evaluate(() => state.favorites.some(book => book.md5 === 'a'.repeat(32)))).toBe(false);
    await page.getByRole('button', { name: 'Search, Command 3' }).click();
    await page.evaluate(() => {
      state.settings.useNip7 = true;
      state.nip7.pubkey = 'f'.repeat(64);
      window.favoriteSigningCalls = 0;
      nostrSigner = {
        signEvent: async () => { window.favoriteSigningCalls += 1; throw new Error('unexpected favorite publish'); },
        nip44: { encrypt: async () => 'unexpected' },
        getPublicKey: async () => 'f'.repeat(64),
      };
    });
    await page.locator('#results [data-md5="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]').click();
    expect(await app.evaluate(() => globalThis.queuedBooks)).toHaveLength(1);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.favoriteSigningCalls)).toBe(0);
    expect(await page.evaluate(() => state.favorites.some(book => book.md5 === 'a'.repeat(32)))).toBe(true);
    const favoritePulls = await page.evaluate(async () => {
      let pulls = 0;
      pullNostrFavorites = async () => { pulls += 1; return []; };
      pullNostrReading = async () => [];
      pullNostrWords = async () => [];
      await syncNostrLibraryFromNip7({ useCache: false });
      return pulls;
    });
    expect(favoritePulls).toBe(0);
    const requests = await app.evaluate(() => globalThis.queuedBooks);
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe('libgen');
    await page.evaluate(() => localStorage.setItem(READING_KEY, JSON.stringify([{
      md5: 'b'.repeat(32), title: 'Reading only', authors: 'Fixture Author', updatedAt: Date.now(),
    }])));
    await page.reload();
    expect(await page.evaluate(() => state.favorites.some(book => book.md5 === 'b'.repeat(32)))).toBe(false);
  } finally { await app.close(); }
});

test('download progress appears in Downloads without adding a book to Library', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveTitle('libstr');
    await expect(page.locator('#build-time')).not.toBeEmpty();
    await page.waitForTimeout(500);
    const bookId = 'd'.repeat(32);
    await app.evaluate(({ ipcMain }) => {
      globalThis.progressDownload = {
        bookId: 'd'.repeat(32), md5: 'd'.repeat(32), title: 'In-flight download',
        authors: ['Fixture Author'], extension: 'epub', status: 'downloading',
        bytes: 0, totalBytes: 102400, queuedFromSearch: true, readable: false, completedAt: null,
      };
      ipcMain.removeHandler('bookstr-desktop-library-downloads');
      ipcMain.handle('bookstr-desktop-library-downloads', () => [globalThis.progressDownload]);
    });
    await page.evaluate(id => {
      state.reading = [];
      state.favorites = Array.from({ length: 80 }, (_, index) => ({
        md5: index.toString(16).padStart(32, '0'),
        title: `Library fixture ${index}`,
        authors: ['Fixture Author'],
        extension: 'epub',
      }));
      renderHome();
    }, bookId);
    await expect(page.locator(`#home-reading-list .book-table-row[data-download-book-id="${bookId}"]`)).toHaveCount(0);

    await app.evaluate(({ BrowserWindow }) => {
      globalThis.progressDownload.bytes = 100 * 1024;
      const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed());
      for (let index = 0; index < 100; index += 1) {
        window.webContents.send('bookstr-desktop-acquisition-progress', {
          bookId: 'd'.repeat(32), bytes: index * 1024, totalBytes: 102400,
        });
      }
    });
    await page.waitForTimeout(300);
    await expect(page.locator(`#home-reading-list .book-table-row[data-download-book-id="${bookId}"]`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.locator('#downloads-tab')).toBeVisible();
    await expect(page.locator('#desktop-downloads-list')).toContainText('In-flight download');
    await expect(page.locator('#desktop-downloads-list')).toContainText('100.0 KB of 100.0 KB');
  } finally { await app.close(); }
});

test('a download completed while Downloads is open is visible until the next entry', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ ipcMain }) => {
      globalThis.downloadRows = [{
        bookId: 'c'.repeat(32), md5: 'c'.repeat(32), title: 'Finishing download',
        status: 'downloading', queuedFromSearch: true, readable: false, completedAt: null,
      }];
      ipcMain.removeHandler('bookstr-desktop-library-downloads');
      ipcMain.handle('bookstr-desktop-library-downloads', () => globalThis.downloadRows);
    });
    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.locator('#desktop-downloads-list')).toContainText('Finishing download');
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.downloadRows = [{
        bookId: 'c'.repeat(32), md5: 'c'.repeat(32), title: 'Finishing download',
        authors: ['Fixture Author'], extension: 'epub', status: 'ready',
        queuedFromSearch: true, readable: true, completedAt: 123,
      }];
      const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed());
      window.webContents.send('bookstr-desktop-downloads-changed');
    });
    await expect(page.locator('#desktop-downloads-list')).toContainText('Finishing download');
    await expect(page.locator('#desktop-downloads-list')).toContainText('Ready to read');
    await page.getByRole('button', { name: 'Home, Command 1' }).click();
    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.locator('#desktop-downloads-list')).not.toContainText('Finishing download');
    await expect(page.locator('#desktop-downloads-list')).toContainText('No downloads yet.');
  } finally { await app.close(); }
});

test('Library sorts readable desktop downloads by completion and filters with full language names', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ ipcMain }) => {
      globalThis.libraryDownloadsFixture = [
        { bookId: 'e'.repeat(32), md5: 'e'.repeat(32), title: 'Older French', authors: ['Fixture Author'], language: 'fr', extension: 'epub', status: 'ready', readable: true, completedAt: 10 },
        { bookId: 'f'.repeat(32), md5: 'f'.repeat(32), title: 'Newest English', authors: ['Fixture Author'], language: 'en', extension: 'pdf', status: 'ready', readable: true, completedAt: 30 },
        { bookId: '1'.repeat(32), md5: '1'.repeat(32), title: 'Middle English', authors: ['Fixture Author'], language: 'en', extension: 'fb2', status: 'ready', readable: true, completedAt: 20 },
        { bookId: '2'.repeat(32), md5: '2'.repeat(32), title: 'Unreadable metadata', authors: ['Fixture Author'], language: 'en', extension: 'txt', status: 'ready', readable: false, completedAt: 40 },
      ];
      ipcMain.removeHandler('bookstr-desktop-library-downloads');
      ipcMain.handle('bookstr-desktop-library-downloads', () => globalThis.libraryDownloadsFixture);
    });
    await page.evaluate(() => {
      state.reading = [];
      state.favorites = [];
    });
    await page.evaluate(async () => {
      await refreshDesktopDownloadStates();
      renderHome();
    });
    const titles = page.locator('#home-reading-list .book-table-row .result-title');
    await expect(titles).toHaveCount(3);
    await expect(titles.nth(0)).toHaveText('Newest English');
    await expect(titles.nth(1)).toHaveText('Middle English');
    await expect(titles.nth(2)).toHaveText('Older French');
    const languageFilter = page.getByRole('combobox', { name: 'Filter library by language' });
    await expect(languageFilter.locator('option')).toContainText(['All languages', 'English', 'French']);
    await languageFilter.selectOption('en');
    await expect(titles).toHaveCount(2);
    await expect(page.locator('#home-reading-list')).toContainText('English');
    await expect(page.locator('#home-reading-list')).not.toContainText('Older French');
  } finally { await app.close(); }
});

test('connected Kindle offers a preview and transfers only on click', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ ipcMain }) => {
      globalThis.kindleTransferCalls = 0;
      ipcMain.removeHandler('bookstr-desktop-kindle-devices');
      ipcMain.handle('bookstr-desktop-kindle-devices', () => [{ id: 'mounted:fixture', name: 'Kindle', kind: 'mounted' }]);
      ipcMain.removeHandler('bookstr-desktop-kindle-preview');
      ipcMain.handle('bookstr-desktop-kindle-preview', () => ({
        device: { id: 'mounted:fixture', name: 'Kindle', kind: 'mounted' },
        missing: [{ bookId: 'pdf-1', title: 'Missing PDF', size: 100 }], alreadyPresent: 1, skipped: [],
      }));
      ipcMain.removeHandler('bookstr-desktop-kindle-transfer');
      ipcMain.handle('bookstr-desktop-kindle-transfer', () => {
        globalThis.kindleTransferCalls += 1;
        return { transferred: ['pdf-1'], alreadyPresent: 1, skipped: [], errors: [] };
      });
    });
    await page.reload();
    await expect(page.locator('#desktop-kindle-offer')).toBeVisible();
    await expect(page.locator('#desktop-kindle-summary')).toContainText('1 missing');
    await page.getByRole('button', { name: 'Devices, Command 4' }).click();
    await expect(page.locator('#device-kindle-panel')).toContainText('Kindle');
    await expect(page.locator('#device-kindle-list')).toContainText('1 missing');
    await expect(page.locator('#device-transfer-panel')).toBeVisible();
    expect(await app.evaluate(() => globalThis.kindleTransferCalls)).toBe(0);
    await page.getByRole('button', { name: 'Put missing books on Kindle' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.kindleTransferCalls)).toBe(1);
  } finally { await app.close(); }
});

test('a completed PDF download sends only its selected book to Kindle', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      globalThis.singleKindleTransfer = null;
      ipcMain.removeHandler('bookstr-desktop-library-downloads');
      ipcMain.handle('bookstr-desktop-library-downloads', () => [
        { bookId: 'a'.repeat(32), md5: 'a'.repeat(32), title: 'Fixture PDF', authors: ['Fixture'], language: 'en', extension: 'pdf', status: 'ready', readable: true, completedAt: 100 },
        { bookId: 'b'.repeat(32), md5: 'b'.repeat(32), title: 'Fixture EPUB', authors: ['Fixture'], language: 'en', extension: 'epub', status: 'ready', readable: true, completedAt: 90 },
      ]);
      ipcMain.removeHandler('bookstr-desktop-kindle-devices');
      ipcMain.handle('bookstr-desktop-kindle-devices', () => [{ id: 'mounted:fixture', name: 'Kindle', kind: 'mounted' }]);
      ipcMain.removeHandler('bookstr-desktop-kindle-preview');
      ipcMain.handle('bookstr-desktop-kindle-preview', () => ({
        device: { id: 'mounted:fixture', name: 'Kindle', kind: 'mounted' },
        missing: [], alreadyPresent: 0, skipped: [],
      }));
      ipcMain.removeHandler('bookstr-desktop-kindle-transfer');
      ipcMain.handle('bookstr-desktop-kindle-transfer', (_event, deviceId, bookId) => {
        globalThis.singleKindleTransfer = { deviceId, bookId };
        return { transferred: [bookId], alreadyPresent: 0, skipped: [], errors: [] };
      });
    });
    await page.reload();
    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.getByRole('button', { name: 'Send Fixture PDF to Kindle' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send Fixture EPUB to Kindle' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Home, Command 1' }).click();
    await expect(page.getByRole('button', { name: 'Send Fixture PDF to Kindle' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send Fixture EPUB to Kindle' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Send Fixture PDF to Kindle' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.singleKindleTransfer)).toEqual({
      deviceId: 'mounted:fixture', bookId: 'a'.repeat(32),
    });
  } finally { await app.close(); }
});
