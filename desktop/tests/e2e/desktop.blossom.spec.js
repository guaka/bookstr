const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, test, expect } = require('@playwright/test');

test('legacy Blossom-only records stay metadata-only without contacting Blossom', async () => {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, 'legacy-blossom-user-data-'));
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '../..'), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  try {
    const library = await electronApp.firstWindow();
    const blossomRequests = [];
    await library.route('https://blossom.bfr.ee/**', async route => {
      blossomRequests.push(route.request().url());
      await route.abort();
    });
    await library.evaluate(() => {
      const hash = 'b'.repeat(64);
      localStorage.setItem('bookstr_reader_settings_v1', JSON.stringify({
        autoReading: false,
        useNip7: false,
        theme: 'white',
      }));
      localStorage.setItem('bookstr_reading_library_v1', JSON.stringify([{
        md5: '',
        title: 'Legacy Blossom Favorite',
        authors: 'Fixture Author',
        extension: 'epub',
        blossomSha256: hash,
        blossomUrl: `https://blossom.bfr.ee/${hash}.epub`,
        readUrl: `https://blossom.bfr.ee/${hash}.epub`,
      }]));
    });
    await library.reload();

    const title = library.getByText('Legacy Blossom Favorite', { exact: true }).first();
    await expect(title).toBeVisible();
    await title.click();
    await expect(library.getByText(/Book details are available, but the book file could not be loaded/)).toBeVisible();
    await expect(library.getByText(/No readable download or torrent is available for this record/)).toBeVisible();
    await expect(library.locator('#status')).toContainText('No cached or torrent copy was found for this book.');
    expect(blossomRequests).toEqual([]);
  } finally {
    await electronApp.close();
  }
});
