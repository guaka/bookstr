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
  } finally {
    await app.close();
  }
});

test('a slower previous Electron search cannot overwrite a newer query', async () => {
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
    await expect(page.locator('#read-metadata-fallback-status')).toContainText('Connect your Nostr signer to search LibVault for this torrent');
  } finally {
    await app.close();
  }
});
