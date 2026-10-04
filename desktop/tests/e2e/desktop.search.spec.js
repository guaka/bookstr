const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, test, expect } = require('@playwright/test');

function electronArgs() {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, 'search-user-data-'));
  return [path.join(__dirname, '../..'), `--user-data-dir=${userData}`];
}

test('multi-source Electron search only adds results as sources finish', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    const laterBooks = Array.from({ length: 200 }, (_, index) => ({
      md5: (index + 1).toString(16).padStart(32, '0'),
      title: `Monotonic Catalog ${index + 1}`,
      authors: ['Catalog Author'],
      extension: 'epub',
      readUrl: `https://files.test/monotonic-${index + 1}.epub`,
    }));
    await page.addInitScript(books => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === 'string' ? input : input?.url;
        const url = new URL(rawUrl, location.href);
        if (url.protocol !== 'app:' || url.hostname !== 'bookstr' || !url.pathname.startsWith('/api/')) {
          return originalFetch(input, init);
        }
        if (url.pathname === '/api/search') {
          await new Promise(resolve => setTimeout(resolve, 600));
          return new Response(JSON.stringify({ books }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/gutendex') {
          return new Response(JSON.stringify({ results: [{
            id: 999001,
            title: 'Monotonic Gutenberg Survivor',
            authors: [{ name: 'Early Author' }],
            languages: ['en'],
            formats: { 'application/epub+zip': 'https://files.test/monotonic-early.epub' },
            copyright: false,
          }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/opds') {
          return new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
            status: 200,
            headers: { 'Content-Type': 'application/atom+xml' },
          });
        }
        const empty = url.pathname === '/api/open-textbooks'
          ? { data: [] }
          : url.pathname === '/api/gdl'
            ? { books: [] }
            : url.pathname === '/api/internet-archive/search'
              ? { response: { docs: [] } }
              : [];
        return new Response(JSON.stringify(empty), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    }, laterBooks);
    await page.reload();

    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('textbox', { name: 'Book search query' }).fill('monotonic');
    await page.getByRole('textbox', { name: 'Book search query' }).press('Enter');
    await expect(page.locator('#results')).toContainText('Monotonic Gutenberg Survivor');
    await expect(page.locator('#search-result-count')).toHaveText('200 results');
    await expect(page.locator('#results')).toContainText('Monotonic Gutenberg Survivor');
    const progress = page.locator('#search-source-progress');
    const publicToggle = progress.locator('[data-source-id="all-books-party"]');
    await expect(publicToggle).toBeChecked();
    await publicToggle.uncheck();
    await expect(page.locator('#search-result-count')).toHaveText('1 result');
    await expect(publicToggle).not.toBeChecked();
    await publicToggle.check();
    await expect(page.locator('#search-result-count')).toHaveText('200 results');
    await publicToggle.uncheck();
    await expect(page.locator('#status')).toContainText('result(s)');
    await page.reload();
    await expect(page.locator('#search-source-progress [data-source-id="all-books-party"]')).not.toBeChecked();
    await expect(page.locator('#search-result-count')).toHaveText('1 result');
    for (const id of await progress.locator('input:checked').evaluateAll(inputs => inputs.map(input => input.dataset.sourceId))) {
      await progress.locator(`[data-source-id="${id}"]`).uncheck();
    }
    await expect(page.locator('#search-result-count')).toHaveText('0 results');
    await publicToggle.check();
    await expect(page.locator('#search-result-count')).toHaveText('200 results');
    fs.writeFileSync(path.join(__dirname, '../../test-results/source-controls-coverage.json'), JSON.stringify(await page.coverage.stopJSCoverage()));

  } finally {
    await app.close();
  }
});

test('a slower previous Electron search cannot overwrite a newer query', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await app.context().route('https://lib.b.bfr.ee/api/search**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ books: [] }),
    }));
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === 'string' ? input : input?.url;
        const url = new URL(rawUrl, location.href);
        if (url.protocol !== 'app:' || url.hostname !== 'bookstr' || !url.pathname.startsWith('/api/')) {
          return originalFetch(input, init);
        }
        if (url.pathname === '/api/search') {
          const query = url.searchParams.get('q');
          if (query === 'older') await new Promise(resolve => setTimeout(resolve, 700));
          const title = query === 'older' ? 'Older Search Result' : 'Newer Search Result';
          return new Response(JSON.stringify({ books: [{
            md5: query === 'older' ? 'a'.repeat(32) : 'b'.repeat(32),
            title,
            authors: ['Fixture Author'],
            extension: 'epub',
            readUrl: `https://files.test/${query}.epub`,
          }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/opds') {
          return new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
            status: 200,
            headers: { 'Content-Type': 'application/atom+xml' },
          });
        }
        const empty = url.pathname === '/api/gutendex'
          ? { results: [] }
          : url.pathname === '/api/open-textbooks'
            ? { data: [] }
            : url.pathname === '/api/gdl'
              ? { books: [] }
              : url.pathname === '/api/internet-archive/search'
                ? { response: { docs: [] } }
                : [];
        return new Response(JSON.stringify(empty), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });
    await page.reload();

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

test('a metadata-only Electron search result opens its book page', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === 'string' ? input : input?.url;
        const url = new URL(rawUrl, location.href);
        if (url.protocol !== 'app:' || url.hostname !== 'bookstr' || !url.pathname.startsWith('/api/')) {
          return originalFetch(input, init);
        }
        if (url.pathname === '/api/search') {
          return new Response(JSON.stringify({ books: [{
            source: 'openlibrary',
            source_native_id: 'OLCLICKABLEW',
            title: 'Clickable Metadata Result',
            authors: ['Fixture Author'],
            language: 'en',
          }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/api/opds') {
          return new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', {
            status: 200,
            headers: { 'Content-Type': 'application/atom+xml' },
          });
        }
        const empty = url.pathname === '/api/gutendex'
          ? { results: [] }
          : url.pathname === '/api/open-textbooks'
            ? { data: [] }
            : url.pathname === '/api/gdl'
              ? { books: [] }
              : url.pathname === '/api/internet-archive/search'
                ? { response: { docs: [] } }
                : [];
        return new Response(JSON.stringify(empty), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });
    await page.reload();

    await page.getByRole('button', { name: 'Search' }).click();
    const query = page.getByRole('textbox', { name: 'Book search query' });
    await query.fill('clickable');
    await query.press('Enter');
    await page.getByRole('link', { name: 'Clickable Metadata Result', exact: true }).click();

    await expect(page).toHaveURL(/#read=book%3A/);
    await expect(page.locator('#read-metadata-fallback')).toBeVisible();
    await expect(page.locator('#read-metadata-fallback h1')).toHaveText('Clickable Metadata Result');
    await expect(page.locator('#read-metadata-fallback-status')).toContainText('Connect your Nostr signer in Settings');
    await expect(page.locator('.read-file-attempts-title')).toHaveText('What Libstr tried');
    await expect(page.locator('.read-file-attempts')).toContainText('Local library: No downloaded copy was found.');
    await expect(page.locator('.read-file-attempts')).toContainText('Direct download: This record does not provide a direct file URL.');
    await expect(page.locator('.read-file-attempts')).not.toContainText('Public torrent catalogue:');
    await expect(page.locator('.read-file-attempts')).toContainText('Private Nostr lookup: Not tried because no Nostr signer is connected.');
  } finally {
    await app.close();
  }
});

test('search plus opens Downloads while the heart stays a separate action', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ ipcMain }) => {
      globalThis.queuedBooks = [];
      ipcMain.removeHandler('bookstr-desktop-library-enqueue');
      ipcMain.handle('bookstr-desktop-library-enqueue', (_event, request) => {
        globalThis.queuedBooks.push(request);
        return { bookId: request.record.md5, status: 'queued' };
      });
      ipcMain.removeHandler('bookstr-desktop-library-downloads');
      ipcMain.handle('bookstr-desktop-library-downloads', () => globalThis.queuedBooks.map(request => ({
        bookId: request.record.md5, title: request.record.title, status: 'queued', queuedFromSearch: true,
      })));
      ipcMain.removeHandler('bookstr-desktop-kindle-devices');
      ipcMain.handle('bookstr-desktop-kindle-devices', () => []);
    });
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input?.url, location.href);
        if (url.protocol !== 'app:' || url.hostname !== 'bookstr' || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
        if (url.pathname === '/api/search') return new Response(JSON.stringify({ books: [{
          md5: 'a'.repeat(32), libgenId: 2412930, title: 'Download Fixture', authors: ['Fixture Author'], extension: 'pdf', readUrl: 'https://files.test/download-fixture.pdf',
        }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.pathname === '/api/gutendex') return new Response(JSON.stringify({ results: [{
          id: 999007, title: 'Download Fixture Gutenberg', authors: [{ name: 'Open Author' }],
          languages: ['en'], formats: { 'application/epub+zip': 'https://www.gutenberg.org/ebooks/999007.epub' }, copyright: false,
        }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.pathname === '/api/opds') return new Response('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', { status: 200, headers: { 'Content-Type': 'application/atom+xml' } });
        return new Response(JSON.stringify(url.pathname === '/api/gutendex' ? { results: [] } : url.pathname === '/api/internet-archive/search' ? { response: { docs: [] } } : url.pathname === '/api/open-textbooks' ? { data: [] } : url.pathname === '/api/gdl' ? { books: [] } : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });
    await page.reload();
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('textbox', { name: 'Book search query' }).fill('download fixture');
    await page.getByRole('textbox', { name: 'Book search query' }).press('Enter');
    await expect(page.locator('#results')).toContainText('Download Fixture');
    await page.getByRole('button', { name: 'Add Download Fixture to downloads' }).click();
    await expect(page.getByRole('dialog', { name: 'Downloads' })).toBeVisible();
    await expect(page.locator('#desktop-downloads-list')).toContainText('Download Fixture');
    await expect(page.locator('#desktop-downloads-list')).toContainText('queued');
    expect(await app.evaluate(() => globalThis.queuedBooks)).toHaveLength(1);
    expect(await page.evaluate(() => state.favorites.some(book => book.md5 === 'a'.repeat(32)))).toBe(false);
    await page.getByRole('button', { name: 'Close downloads' }).click();
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
    await page.getByRole('button', { name: 'Add Download Fixture Gutenberg to downloads' }).click();
    await expect(page.getByRole('dialog', { name: 'Downloads' })).toBeVisible();
    const requests = await app.evaluate(() => globalThis.queuedBooks);
    expect(requests).toHaveLength(2);
    expect(requests[1].kind).toBe('provider');
    expect(requests[1].record.acquisitions[0].url).toBe('https://www.gutenberg.org/ebooks/999007.epub');
    await page.evaluate(() => localStorage.setItem(READING_KEY, JSON.stringify([{
      md5: 'b'.repeat(32), title: 'Reading only', authors: 'Fixture Author', updatedAt: Date.now(),
    }])));
    await page.reload();
    expect(await page.evaluate(() => state.favorites.some(book => book.md5 === 'b'.repeat(32)))).toBe(false);
  } finally { await app.close(); }
});

test('download progress updates the library without replacing its rows', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle('libstr');
    await expect(page.locator('#build-time')).not.toBeEmpty();
    await page.waitForTimeout(500);
    const bookId = 'd'.repeat(32);
    await page.evaluate(id => {
      state.reading = [];
      state.favorites = Array.from({ length: 80 }, (_, index) => ({
        md5: index === 0 ? id : index.toString(16).padStart(32, '0'),
        title: `Library fixture ${index}`,
        authors: ['Fixture Author'],
        extension: 'epub',
      }));
      renderHome();
      window.progressFixtureRow = document.querySelector(`.book-table-row[data-download-book-id="${id}"]`);
    }, bookId);
    expect(await page.evaluate(() => Boolean(window.progressFixtureRow))).toBe(true);

    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed());
      for (let index = 0; index < 100; index += 1) {
        window.webContents.send('bookstr-desktop-acquisition-progress', {
          bookId: 'd'.repeat(32), bytes: index * 1024, totalBytes: 102400,
        });
      }
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.progressFixtureRow.isConnected)).toBe(true);
  } finally { await app.close(); }
});

test('connected Kindle offers a preview and transfers only on click', async () => {
  const app = await electron.launch({ args: electronArgs() });
  try {
    const page = await app.firstWindow();
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
