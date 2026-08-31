const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, test, expect } = require('@playwright/test');

const JSZip = require('../../../web/jszip.min.js');
const { LibraryStore } = require('../../library-store');

function electronArgs(label) {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, `${label}-`));
  return { args: [path.join(__dirname, '../..'), `--user-data-dir=${userData}`], userData };
}

function seedDesktopStore(userData, books, downloads = []) {
  const libraryRoot = path.join(userData, 'library');
  const store = new LibraryStore({ dbPath: path.join(libraryRoot, 'library.sqlite'), libraryRoot });
  try {
    for (const book of books) store.upsertBook({ id: book.md5, ...book });
    for (const download of downloads) store.setDownload(download);
  } finally {
    store.close();
  }
}

const COVER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function minimalEpub(title, body = title, { cover = false } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:test:${title}</dc:identifier><dc:title>${title}</dc:title><dc:language>en</dc:language></metadata>
      <manifest>${cover ? '<item id="cover-art" href="front.png" media-type="image/png" properties="cover-image"/>' : ''}<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`);
  if (cover) zip.file('OEBPS/front.png', COVER_PNG);
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${title}</h1><p>${body}</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

function minimalFB2(title) {
  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
    <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>${title}</book-title><author><first-name>Test</first-name><last-name>Author</last-name></author></title-info></description><body><section><title><p>${title}</p></title><p>Distinct FB2 contents.</p></section></body></FictionBook>`);
}

async function minimalCBZ() {
  const zip = new JSZip();
  zip.file('001.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function seedLibrary(page, books) {
  await page.evaluate(items => {
    localStorage.setItem('bookstr_reader_settings_v1', JSON.stringify({
      autoReading: false,
      useNip7: false,
      theme: 'white',
      readerPadding: 36,
    }));
    localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify(items));
  }, books);
}

function libraryRow(page, title) {
  return page.locator('.book-table-row').filter({ has: page.getByRole('link', { name: title, exact: true }) });
}

test('Library reports useful local torrent states', async () => {
  const launch = electronArgs('availability-user-data');
  const books = [
    ['a'.repeat(32), 'Available Book'],
    ['b'.repeat(32), 'Finding Book'],
    ['c'.repeat(32), 'Downloading Book'],
    ['d'.repeat(32), 'Ready Book'],
    ['e'.repeat(32), 'Unavailable Book'],
  ].map(([md5, title]) => ({ md5, title, authors: 'Fixture Author', extension: 'epub' }));
  // Seed before Electron opens its long-lived SQLite connection. This also
  // catches startup hydration, which is the path used by a real library.
  seedDesktopStore(launch.userData, books, [
    { bookId: books[1].md5, status: 'finding-peers', source: 'torrent' },
    { bookId: books[2].md5, status: 'downloading', bytes: 40, totalBytes: 100, source: 'torrent' },
    { bookId: books[3].md5, status: 'ready', bytes: 100, totalBytes: 100, source: 'torrent' },
    { bookId: books[4].md5, status: 'failed', source: 'torrent', error: 'fixture unavailable' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await seedLibrary(page, books);
    await page.reload();

    await expect(libraryRow(page, books[0].title).locator('.result-availability')).toHaveText('Available');
    await expect(libraryRow(page, books[1].title).locator('.result-availability')).toHaveText('Finding peers');
    await expect(libraryRow(page, books[2].title).locator('.result-availability')).toHaveText('Downloading · 40%');
    await expect(libraryRow(page, books[3].title).locator('.result-availability')).toHaveText('Ready');
    await expect(libraryRow(page, books[4].title).locator('.result-availability')).toHaveText('Unavailable');
  } finally {
    await app.close();
  }
});

test('Library extracts and displays a downloaded EPUB cover inside Electron', async () => {
  const launch = electronArgs('local-cover-user-data');
  const md5 = '9'.repeat(32);
  const title = 'Embedded Cover Fixture';
  const libraryRoot = path.join(launch.userData, 'library');
  const relativePath = `books/${md5}.epub`;
  fs.mkdirSync(path.join(libraryRoot, 'books'), { recursive: true });
  const bytes = await minimalEpub(title, title, { cover: true });
  fs.writeFileSync(path.join(libraryRoot, relativePath), bytes);
  const store = new LibraryStore({ dbPath: path.join(libraryRoot, 'library.sqlite'), libraryRoot });
  try {
    store.upsertBook({ id: md5, md5, title, authors: 'Fixture Author', extension: 'epub' });
    store.registerLibraryFile({ bookId: md5, relativePath, sizeBytes: bytes.length });
    store.setDownload({ bookId: md5, status: 'ready', bytes: bytes.length, totalBytes: bytes.length, source: 'torrent' });
  } finally {
    store.close();
  }

  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await seedLibrary(page, [{ md5, title, authors: 'Fixture Author', extension: 'epub' }]);
    await page.reload();
    const row = libraryRow(page, title);
    const cover = row.locator('.result-cover');
    await expect(cover).toHaveAttribute('src', `app://bookstr/api/library-cover/${md5}`);
    await expect(cover).toHaveClass(/is-loaded/);
    await expect.poll(() => cover.evaluate(image => image.naturalWidth > 0)).toBe(true);
    await expect(row.locator('.result-cell').nth(5)).toHaveText('EN');
  } finally {
    await app.close();
  }
});

test('switching MD5 books never treats the previous EPUB as the next book', async () => {
  const launch = electronArgs('switch-user-data');
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    const first = { md5: '1'.repeat(32), title: 'Luminous Fixture', extension: 'epub', readUrl: 'https://files.test/luminous.epub' };
    const second = { md5: '2'.repeat(32), title: 'Hunger Games Fixture', extension: 'epub', readUrl: 'https://files.test/hunger-games.epub' };
    const firstBytes = await minimalEpub(first.title, 'Only luminous bytes.');
    const secondBytes = await minimalEpub(second.title, 'Only hunger games bytes.');
    await app.context().route('https://lib.b.bfr.ee/api/books/**', route => route.fulfill({ status: 404, body: '{}' }));
    await app.context().route('https://lib.b.bfr.ee/api/nostr', route => route.fulfill({ status: 404, body: '{}' }));
    await app.context().route(first.readUrl, route => route.fulfill({ status: 200, contentType: 'application/epub+zip', body: firstBytes }));
    await app.context().route(second.readUrl, async route => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      await route.fulfill({ status: 200, contentType: 'application/epub+zip', body: secondBytes });
    });
    await seedLibrary(page, [first, second]);
    await page.reload();

    await page.getByRole('link', { name: first.title }).click();
    const reader = page.frameLocator('#reader-frame');
    await expect(reader.locator('body')).toHaveAttribute('data-book-id', first.md5, { timeout: 45_000 });
    await page.getByRole('button', { name: 'Home' }).click();
    await page.getByRole('link', { name: second.title }).click();
    await expect(page.locator('#read-metadata-fallback')).toBeVisible();
    await expect(page.locator('#read-metadata-fallback h1')).toHaveText(second.title);
    await expect(reader.locator('body')).toHaveAttribute('data-book-id', second.md5, { timeout: 45_000 });
    const renderedChapter = reader.frameLocator('#viewer iframe').locator('body');
    await expect(renderedChapter).toContainText('Only hunger games bytes.', { timeout: 45_000 });
    await expect(renderedChapter).not.toContainText('Only luminous bytes.');
    await expect(renderedChapter).toHaveCSS('padding-left', '36px');
  } finally {
    await app.close();
  }
});

test('Library opens FB2 and CBZ books through their format-specific readers', async () => {
  const launch = electronArgs('formats-user-data');
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    const fb2 = { md5: '3'.repeat(32), title: 'FB2 Fixture', extension: 'fb2', readUrl: 'https://files.test/book.fb2' };
    const cbz = { md5: '4'.repeat(32), title: 'CBZ Fixture', extension: 'cbz', readUrl: 'https://files.test/book.cbz' };
    await app.context().route('https://lib.b.bfr.ee/api/books/**', route => route.fulfill({ status: 404, body: '{}' }));
    await app.context().route('https://lib.b.bfr.ee/api/nostr', route => route.fulfill({ status: 404, body: '{}' }));
    await app.context().route(fb2.readUrl, route => route.fulfill({ status: 200, contentType: 'application/xml', body: minimalFB2(fb2.title) }));
    await app.context().route(cbz.readUrl, async route => route.fulfill({ status: 200, contentType: 'application/vnd.comicbook+zip', body: await minimalCBZ() }));
    await seedLibrary(page, [fb2, cbz]);
    await page.reload();

    await page.getByRole('link', { name: fb2.title }).click();
    let reader = page.frameLocator('#reader-frame');
    await expect(reader.locator('#viewer')).toContainText('Distinct FB2 contents.');
    await expect(reader.locator('body')).toHaveCSS('padding-left', '36px');
    await page.getByRole('button', { name: 'Home' }).click();
    await page.getByRole('link', { name: cbz.title }).click();
    reader = page.frameLocator('#reader-frame');
    await expect(reader.locator('#title')).toHaveText(cbz.title);
    await expect(reader.locator('#count')).toHaveText('1 / 1');
    await expect(reader.locator('#stage img')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('metadata-only failures stay compact, scrollable, and tied to the requested book', async () => {
  const launch = electronArgs('fallback-user-data');
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    const book = {
      md5: '5'.repeat(32),
      title: 'A deliberately long title that must remain compact in a short Electron window instead of taking over the entire page',
      authors: 'A very long fixture author name used to exercise the compact metadata layout',
      extension: 'epub',
    };
    await app.context().route(`https://lib.b.bfr.ee/api/books/${book.md5}`, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...book, id: 0, filesize_bytes: 0 }),
    }));
    await app.context().route('https://lib.b.bfr.ee/api/nostr', route => route.fulfill({ status: 404, body: '{}' }));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(520, 520));
    await seedLibrary(page, [book]);
    await page.reload();
    await page.getByRole('link', { name: book.title }).click();

    const panel = page.locator('#read-metadata-fallback');
    await expect(panel).toBeVisible();
    await expect(panel.locator('h1')).toHaveText(book.title);
    const layout = await page.evaluate(() => {
      const section = document.querySelector('#reader-section');
      const panel = document.querySelector('#read-metadata-fallback');
      const title = panel.querySelector('h1');
      return {
        overflowY: getComputedStyle(section).overflowY,
        panelWidth: panel.getBoundingClientRect().width,
        viewportWidth: innerWidth,
        titleSize: parseFloat(getComputedStyle(title).fontSize),
      };
    });
    expect(layout.overflowY).toBe('auto');
    expect(layout.panelWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.titleSize).toBeLessThanOrEqual(42);
  } finally {
    await app.close();
  }
});
