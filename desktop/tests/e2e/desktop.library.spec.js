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

async function localFormatBytes(book) {
  const extension = String(book.extension || 'epub').toLowerCase();
  if (extension === 'epub') return minimalEpub(book.title || 'Local fixture', book.body || book.title || 'Local fixture');
  if (extension === 'fb2') return minimalFB2(book.title || 'Local fixture');
  if (extension === 'cbz') return minimalCBZ();
  if (extension === 'cbr') return Buffer.concat([Buffer.from('Rar!'), Buffer.alloc(32)]);
  if (extension === 'pdf') return Buffer.from('%PDF-1.4\n% local fixture\n');
  return Buffer.from(String(book.title || 'Local fixture'));
}

async function seedDesktopStore(userData, books, downloads = []) {
  const libraryRoot = path.join(userData, 'library');
  const store = new LibraryStore({ dbPath: path.join(libraryRoot, 'library.sqlite'), libraryRoot });
  try {
    for (const book of books) store.upsertBook({ id: book.md5, ...book });
    for (const download of downloads) {
      const bookId = download.bookId || download.id;
      const book = books.find(item => item.md5 === bookId || item.sha256 === bookId);
      if (book && ['ready', 'seeding'].includes(download.status)) {
        const extension = String(book.extension || 'epub').toLowerCase();
        const relativePath = `books/${bookId}.${extension}`;
        const absolutePath = path.join(libraryRoot, relativePath);
        const bytes = await localFormatBytes(book);
        await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.promises.writeFile(absolutePath, bytes);
        store.registerLibraryFile({ bookId, relativePath, sizeBytes: bytes.length });
        store.setDownload({ ...download, relativePath });
      } else {
        store.setDownload(download);
      }
    }
  } finally {
    store.close();
  }
}

const COVER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function minimalEpub(title, body = title, { cover = false, inlineImage = false } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:test:${title}</dc:identifier><dc:title>${title}</dc:title><dc:language>en</dc:language></metadata>
      <manifest>${cover ? '<item id="cover-art" href="front.png" media-type="image/png" properties="cover-image"/>' : ''}${inlineImage ? '<item id="illustration" href="illustration.png" media-type="image/png"/>' : ''}<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`);
  if (cover) zip.file('OEBPS/front.png', COVER_PNG);
  if (inlineImage) zip.file('OEBPS/illustration.png', COVER_PNG);
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${title}</h1><p>${body}</p>${inlineImage ? '<img id="embedded-illustration" src="illustration.png" alt="Embedded illustration"/>' : ''}</body></html>`);
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
    ['a'.repeat(32), 'Metadata-only Book'],
    ['b'.repeat(32), 'Finding Book'],
    ['c'.repeat(32), 'Downloading Book'],
    ['d'.repeat(32), 'Ready Book'],
    ['e'.repeat(32), 'Unavailable Book'],
  ].map(([md5, title]) => ({ md5, title, authors: 'Fixture Author', extension: 'epub' }));
  books[3].authors = Array.from({ length: 80 }, (_, index) => `Fixture Author ${index + 1}`).join(', ');
  books.push({
    md5: 'f'.repeat(32),
    libgenId: 1234,
    sourceNativeId: '1234',
    title: 'Available Book',
    authors: 'Fixture Author',
    extension: 'epub',
  });
  books.push({ md5: '1'.repeat(32), title: 'Seeding Book', authors: 'Fixture Author', extension: 'epub' });
  // Seed before Electron opens its long-lived SQLite connection. This also
  // catches startup hydration, which is the path used by a real library.
  await seedDesktopStore(launch.userData, books, [
    { bookId: books[1].md5, status: 'finding-peers', source: 'torrent' },
    { bookId: books[2].md5, status: 'downloading', bytes: -84, totalBytes: 100, source: 'torrent' },
    { bookId: books[3].md5, status: 'ready', bytes: 100, totalBytes: 100, source: 'torrent' },
    { bookId: books[4].md5, status: 'failed', source: 'torrent', error: 'fixture unavailable' },
    { bookId: books[6].md5, status: 'seeding', bytes: 100, totalBytes: 100, source: 'torrent' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await seedLibrary(page, books);
    await page.reload();

    await expect(page.locator('.library-book-count')).toHaveText('2 books');
    await expect(libraryRow(page, books[0].title)).toHaveCount(0);
    await expect(libraryRow(page, books[4].title)).toHaveCount(0);
    await expect(libraryRow(page, books[5].title)).toHaveCount(0);
    const compactAuthors = libraryRow(page, books[3].title).locator('.result-author');
    await expect(compactAuthors).toHaveAttribute('title', books[3].authors);
    await expect(compactAuthors).toHaveAttribute('aria-label', books[3].authors);
    await expect.poll(() => compactAuthors.evaluate(element => ({
      clipped: element.scrollWidth > element.clientWidth,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }))).toEqual({ clipped: true, whiteSpace: 'nowrap' });
    await expect.poll(() => libraryRow(page, books[3].title).evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(70);
    await expect(libraryRow(page, books[3].title).locator('.result-availability')).toHaveText('Available');
    await expect(libraryRow(page, books[3].title).locator('.availability-primary')).toHaveClass(/status-dot-success/);
    await expect(libraryRow(page, books[6].title).locator('.result-availability')).toHaveText('Available');
    await expect(libraryRow(page, books[3].title).locator('.result-cover-slot')).not.toHaveClass(/has-real-cover/);
    await page.getByRole('button', { name: 'Downloads' }).click();
    const downloads = page.locator('#desktop-downloads-list');
    await expect(downloads.locator(`[data-download-id="${books[1].md5}"]`)).toContainText('Finding peers');
    await expect(downloads.locator(`[data-download-id="${books[2].md5}"]`)).toContainText('0 B of 100 B');
    await expect(downloads.locator(`[data-download-id="${books[4].md5}"]`)).toContainText('fixture unavailable');
  } finally {
    await app.close();
  }
});

test('an active zero-percent torrent appears in Downloads and stays out of Library', async () => {
  const launch = electronArgs('active-download-library');
  const book = {
    md5: '7'.repeat(32),
    title: 'Zero Percent Book',
    authors: 'Fixture Author',
    extension: 'epub',
    libgenId: 4321,
    sourceNativeId: '4321',
  };
  await seedDesktopStore(launch.userData, [book], [
    { bookId: book.md5, status: 'downloading', bytes: 0, totalBytes: 100, source: 'fixture' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await expect(libraryRow(page, book.title)).toHaveCount(0);
    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.locator('#desktop-downloads-list')).toContainText(book.title);
    await expect(page.locator('#desktop-downloads-list')).toContainText('0 B of 100 B');
  } finally {
    await app.close();
  }
});

test('a failed favorite edition reuses a matching downloaded torrent edition', async () => {
  const launch = electronArgs('matching-downloaded-edition');
  const favorite = {
    md5: '2'.repeat(32),
    title: 'Previously Downloaded Book',
    authors: 'Fixture Author',
    extension: 'epub',
  };
  const downloaded = { ...favorite, md5: '3'.repeat(32), libgenId: 1234, sourceNativeId: '1234' };
  const libraryRoot = path.join(launch.userData, 'library');
  const relativePath = `books/${downloaded.md5}.epub`;
  const bytes = await minimalEpub(favorite.title, 'Recovered downloaded edition.');
  fs.mkdirSync(path.join(libraryRoot, 'books'), { recursive: true });
  fs.writeFileSync(path.join(libraryRoot, relativePath), bytes);
  const store = new LibraryStore({ dbPath: path.join(libraryRoot, 'library.sqlite'), libraryRoot });
  try {
    store.upsertBook({ id: favorite.md5, ...favorite });
    store.upsertBook({ id: downloaded.md5, ...downloaded });
    store.setDownload({ bookId: favorite.md5, status: 'failed', source: 'torrent', error: 'old edition unavailable' });
    store.registerLibraryFile({ bookId: downloaded.md5, relativePath, sizeBytes: bytes.length });
    store.setDownload({ bookId: downloaded.md5, status: 'ready', bytes: bytes.length, totalBytes: bytes.length, source: 'torrent' });
  } finally {
    store.close();
  }
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await seedLibrary(page, [favorite]);
    await page.reload();

    await expect(libraryRow(page, favorite.title).locator('.result-availability').first()).toHaveText('Available');
    await expect(libraryRow(page, favorite.title).locator('.result-title')).toHaveClass(/readable/);
    await expect(page.locator('.library-book-count')).toHaveText('1 book');
    await libraryRow(page, favorite.title).getByRole('link', { name: favorite.title }).click();
    await expect(page.locator('#reader-frame')).toBeVisible();
    await expect(page.locator('#reader-frame')).toHaveAttribute('src', /reader\.html/);
  } finally {
    await app.close();
  }
});

test('Electron drops IndexedDB book files while a registered EPUB remains in Library', async () => {
  const launch = electronArgs('cache-phaseout-user-data');
  const book = {
    md5: '7'.repeat(32),
    libgenId: 4321,
    sourceNativeId: '4321',
    title: 'Former Cache Fixture',
    authors: 'Fixture Author',
    extension: 'epub',
  };
  await seedDesktopStore(launch.userData, [book], [
    { bookId: book.md5, status: 'ready', source: 'torrent' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await seedLibrary(page, [book]);
    await page.evaluate(async item => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('bookstr_epub_cache_v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const request = database.transaction('books', 'readwrite').objectStore('books').put({
          key: item.md5,
          md5: item.md5,
          title: item.title,
          extension: item.extension,
          blob: new Blob(['legacy cached bytes'], { type: 'application/epub+zip' }),
          size: 19,
        });
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      database.close();
    }, book);
    await page.reload();

    await expect(libraryRow(page, book.title)).toBeVisible();
    await expect(libraryRow(page, book.title).locator('.result-availability')).toHaveText('Available');
    await expect.poll(() => page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('bookstr_epub_cache_v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const count = await new Promise((resolve, reject) => {
        const request = database.transaction('books').objectStore('books').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return count;
    })).toBe(0);
  } finally {
    await app.close();
  }
});

test('metadata-only Open Library records resolve subtitle and contributor variants to a readable torrent edition', async () => {
  const launch = electronArgs('openlibrary-torrent-match-user-data');
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(globalThis.BookMetadata?.matchingTorrentCatalogRecord));
    const selected = await page.evaluate(() => window.BookMetadata.matchingTorrentCatalogRecord({
      md5: 'openlibrary:116726829',
      title: 'Antifragile',
      authors: 'Nassim Nicholas Taleb Genís Sánchez Barberán Albino Santos Mosquera',
    }, [
      {
        md5: '6aa0b2c29d7992041f99024e15f60a20',
        libgenId: 1521282,
        title: 'Antifragile Software. Building Adaptable Software with Microservices',
        authors: 'Russ Miles',
        extension: 'pdf',
      },
      {
        md5: '8fc96e17b7f73759bb8d7d9b852d6626',
        libgenId: 2519660,
        title: 'Antifragile Things That Gain from Disorder',
        authors: 'Nassim Nicholas Taleb',
        extension: 'pdf',
      },
      {
        md5: '2edbe4a27b0587cad214c20b9ff83d26',
        libgenId: 1023589,
        title: 'Antifragile: Things That Gain from Disorder',
        authors: 'Nassim Nicholas Taleb',
        extension: 'epub',
      },
      {
        md5: '936ef3a61c52235bb69bca164333c4b0',
        libgenId: 1022876,
        title: 'Antifragile: Things That Gain from Disorder',
        authors: 'Nassim Nicholas Taleb',
        extension: 'mobi',
      },
    ]));
    expect(selected).toMatchObject({
      md5: '2edbe4a27b0587cad214c20b9ff83d26',
      libgenId: 1023589,
      extension: 'epub',
    });
  } finally {
    await app.close();
  }
});

test('a successful torrent download does not duplicate its legacy SHA-addressed favorite', async () => {
  const launch = electronArgs('download-dedupe-user-data');
  const md5 = 'a'.repeat(32);
  const sha256 = 'b'.repeat(64);
  const downloaded = { md5, sha256, title: 'Scale', authors: 'Greg Egan', extension: 'epub', year: '2023' };
  const favorite = { md5: sha256, blossomSha256: sha256, title: 'Scale', authors: 'Egan, Greg', extension: 'epub', year: '2023' };
  await seedDesktopStore(launch.userData, [downloaded], [
    { bookId: md5, status: 'ready', bytes: 100, totalBytes: 100, source: 'torrent' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await page.evaluate(({ reading, favorites }) => {
      localStorage.setItem('bookstr_reader_settings_v1', JSON.stringify({ autoReading: true, useNip7: false, theme: 'white' }));
      localStorage.setItem('bookstr_reading_library_v1', JSON.stringify(reading));
      localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify(favorites));
    }, { reading: [downloaded], favorites: [favorite] });
    await page.reload();
    await page.locator('#home-query-input').fill('');

    await expect(page.locator('.library-book-count')).toHaveText('1 book');
    await expect(page.locator('.book-table-row')).toHaveCount(1);
    await expect(libraryRow(page, 'Scale').locator('.result-availability')).toHaveText('Available');

    await page.reload();
    await page.locator('#home-query-input').fill('');
    await expect(page.locator('.library-book-count')).toHaveText('1 book');
    await expect(page.locator('.book-table-row')).toHaveCount(1);
    await expect(libraryRow(page, 'Scale').locator('.result-availability')).toHaveText('Available');
  } finally {
    await app.close();
  }
});

test('SHA-addressed library rows inherit seeding status from their LibGen download', async () => {
  const launch = electronArgs('sha-seeding-alias-user-data');
  const libvaultMd5 = '7'.repeat(32);
  const sha256 = '8'.repeat(64);
  const stored = {
    md5: libvaultMd5,
    sha256,
    title: 'Aliased Seed',
    authors: 'Fixture Author',
    extension: 'epub',
  };
  const favorite = {
    md5: sha256,
    sha256,
    title: stored.title,
    authors: stored.authors,
    extension: stored.extension,
  };
  await seedDesktopStore(launch.userData, [stored], [{
    bookId: libvaultMd5,
    status: 'seeding',
    bytes: 100,
    totalBytes: 100,
    source: 'torrent',
  }]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await seedLibrary(page, [favorite]);
    await page.reload();

    const row = libraryRow(page, favorite.title);
    await expect(page.locator('.library-book-count')).toHaveText('1 book');
    await expect(row.locator('.result-availability')).toHaveText('Available');
    await expect(row.locator('.result-title')).toHaveClass(/readable/);
    await expect(row.locator('.result-title')).not.toHaveClass(/unavailable/);
  } finally {
    await app.close();
  }
});

test('SHA metadata for an active download stays in Downloads after navigation', async () => {
  const launch = electronArgs('sha-download-status-user-data');
  const libvaultMd5 = 'c'.repeat(32);
  const book = {
    md5: '9'.repeat(64),
    sha256: '9'.repeat(64),
    libvaultMd5,
    libgenId: 800080,
    title: 'SHA Download Fixture',
    authors: 'Fixture Author',
    extension: 'epub',
  };
  await seedDesktopStore(launch.userData, [{
    ...book,
    id: libvaultMd5,
    md5: libvaultMd5,
    sourceNativeId: String(book.libgenId),
  }], [{
    bookId: libvaultMd5,
    status: 'downloading',
    bytes: 37,
    totalBytes: 100,
    source: 'fixture',
  }]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await seedLibrary(page, [book]);
    await page.reload();
    await expect(libraryRow(page, book.title)).toHaveCount(0);
    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.locator('#desktop-downloads-list')).toContainText(book.title);
    await expect(page.locator('#desktop-downloads-list')).toContainText('37 B of 100 B');
    await page.getByRole('button', { name: 'Home, Command 1' }).click();
    await expect(libraryRow(page, book.title)).toHaveCount(0);
    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.locator('#desktop-downloads-list')).toContainText('37 B of 100 B');
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
    await expect(cover).toHaveClass(/is-real-cover/);
    await expect(row.locator('.result-cover-slot')).toHaveClass(/has-real-cover/);
    await expect.poll(() => cover.evaluate(image => image.naturalWidth > 0)).toBe(true);
    await expect(row.locator('.result-cell').nth(6)).toHaveText('EN');
    await expect.poll(() => page.evaluate(async bookId => {
      const reader = await window.bookstrDesktop.library.openReader(bookId);
      const response = await fetch(`app://bookstr/api/library-file/${reader.token}`);
      return bookFormatForBlob(await response.blob());
    }, md5)).toBe('epub');
  } finally {
    await app.close();
  }
});

test('Library corrects a legacy EPUB guess after inspecting downloaded CBZ bytes', async () => {
  const launch = electronArgs('local-cbz-format-user-data');
  const md5 = '7'.repeat(32);
  const title = 'Mortelle Adele Comic Fixture';
  const libraryRoot = path.join(launch.userData, 'library');
  const relativePath = `books/${md5}.epub`;
  fs.mkdirSync(path.join(libraryRoot, 'books'), { recursive: true });
  const bytes = await minimalCBZ();
  fs.writeFileSync(path.join(libraryRoot, relativePath), bytes);
  const store = new LibraryStore({ dbPath: path.join(libraryRoot, 'library.sqlite'), libraryRoot });
  try {
    store.upsertBook({ id: md5, md5, title, authors: 'Mr Tan', extension: 'epub' });
    store.registerLibraryFile({ bookId: md5, relativePath, sizeBytes: bytes.length });
    store.setDownload({ bookId: md5, status: 'ready', bytes: bytes.length, totalBytes: bytes.length, source: 'torrent' });
  } finally {
    store.close();
  }

  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await seedLibrary(page, [{ md5, title, authors: 'Mr Tan', extension: 'epub', source: 'nostr' }]);
    await page.reload();
    const row = libraryRow(page, title);
    await expect(row.locator('.result-cell').nth(5)).toHaveText('cbz');
  } finally {
    await app.close();
  }
});

test('hovering a placeholder retries metadata and replaces it with a discovered cover', async () => {
  const launch = electronArgs('hover-cover-user-data');
  const book = {
    md5: '8'.repeat(32),
    title: 'Hover Cover Discovery Fixture',
    authors: 'Coverless Fixture Author',
    extension: 'epub',
  };
  await seedDesktopStore(launch.userData, [book], [
    { bookId: book.md5, status: 'ready', source: 'torrent' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    let searchRequests = 0;
    await app.context().route('https://openlibrary.org/search.json?**', async route => {
      searchRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(searchRequests === 1 ? { docs: [] } : {
          docs: [{
            key: '/works/OL987654W',
            title: book.title,
            author_name: [book.authors],
            cover_i: 987654,
          }],
        }),
      });
    });
    await app.context().route('https://covers.openlibrary.org/b/id/987654-M.jpg', route => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: COVER_PNG,
    }));
    await seedLibrary(page, [book]);
    await page.reload();
    await expect.poll(() => searchRequests).toBeGreaterThanOrEqual(1);
    const slot = libraryRow(page, book.title).locator('.result-cover-slot');
    await expect(slot).not.toHaveClass(/has-real-cover/);
    await slot.hover();
    await expect.poll(() => searchRequests).toBeGreaterThanOrEqual(2);
    await expect(slot).toHaveClass(/has-real-cover/);
    await expect(slot.locator('.result-cover')).toHaveAttribute('src', 'https://covers.openlibrary.org/b/id/987654-M.jpg');
  } finally {
    await app.close();
  }
});

test('switching MD5 books never treats the previous EPUB as the next book', async () => {
  const launch = electronArgs('switch-user-data');
  const first = { md5: '1'.repeat(32), title: 'Luminous Fixture', authors: 'Fixture Author', extension: 'epub', body: 'Only luminous bytes.', readUrl: 'https://files.test/luminous.epub' };
  const second = { md5: '2'.repeat(32), title: 'Hunger Games Fixture', authors: 'Fixture Author', extension: 'epub', body: 'Only hunger games bytes.', readUrl: 'https://files.test/hunger-games.epub' };
  await seedDesktopStore(launch.userData, [first, second], [
    { bookId: first.md5, status: 'ready', source: 'torrent' },
    { bookId: second.md5, status: 'ready', source: 'torrent' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
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
    await expect(page.locator('#read-metadata-fallback')).toBeHidden();
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
  const fb2 = { md5: '3'.repeat(32), title: 'FB2 Fixture', authors: 'Fixture Author', extension: 'fb2', readUrl: 'https://files.test/book.fb2' };
  const cbz = { md5: '4'.repeat(32), title: 'CBZ Fixture', authors: 'Fixture Author', extension: 'cbz', readUrl: 'https://files.test/book.cbz' };
  await seedDesktopStore(launch.userData, [fb2, cbz], [
    { bookId: fb2.md5, status: 'ready', source: 'torrent' },
    { bookId: cbz.md5, status: 'ready', source: 'torrent' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
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

test('switching from a comic archive to an EPUB replaces the pagination reader', async () => {
  const launch = electronArgs('comic-to-epub-user-data');
  const comic = { md5: '6'.repeat(32), title: 'Pagination Fixture', authors: 'Fixture Author', extension: 'cbz', readUrl: 'https://files.test/pagination.cbz' };
  const epub = { md5: '7'.repeat(32), title: 'Actual EPUB Fixture', authors: 'Fixture Author', extension: 'epub', body: 'This is the actual EPUB text.', readUrl: 'https://files.test/actual.epub' };
  await seedDesktopStore(launch.userData, [comic, epub], [
    { bookId: comic.md5, status: 'ready', source: 'torrent' },
    { bookId: epub.md5, status: 'ready', source: 'torrent' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await app.context().route('https://lib.b.bfr.ee/api/books/**', route => route.fulfill({ status: 404, body: '{}' }));
    await app.context().route('https://lib.b.bfr.ee/api/nostr', route => route.fulfill({ status: 404, body: '{}' }));
    await app.context().route(comic.readUrl, async route => route.fulfill({ status: 200, contentType: 'application/vnd.comicbook+zip', body: await minimalCBZ() }));
    await app.context().route(epub.readUrl, async route => route.fulfill({ status: 200, contentType: 'application/epub+zip', body: await minimalEpub(epub.title, 'This is the actual EPUB text.') }));
    await seedLibrary(page, [comic, epub]);
    await page.reload();

    await page.getByRole('link', { name: comic.title }).click();
    let reader = page.frameLocator('#reader-frame');
    await expect(reader.locator('#count')).toHaveText('1 / 1');
    await page.getByRole('button', { name: 'Home' }).click();
    await page.getByRole('link', { name: epub.title }).click();

    await expect(page.locator('#reader-frame')).toHaveAttribute('src', /reader\.html\?load=/);
    reader = page.frameLocator('#reader-frame');
    await expect(reader.locator('body')).toHaveAttribute('data-book-id', epub.md5, { timeout: 45_000 });
    await expect(reader.frameLocator('#viewer iframe').locator('body')).toContainText('This is the actual EPUB text.');
    await expect(reader.locator('#count')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('EPUB reader resolves and displays images embedded in the archive', async () => {
  const launch = electronArgs('epub-inline-image-user-data');
  const md5 = '3'.repeat(32);
  const title = 'Embedded EPUB Illustration Fixture';
  const bytes = await minimalEpub(title, 'Illustrated EPUB body.', { inlineImage: true });
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await page.evaluate(payload => { void window.bookstrDesktop.openReader(payload); }, {
      kind: 'epub',
      base64: bytes.toString('base64'),
      book: { md5, title, extension: 'epub' },
    });
    await page.waitForURL('app://bookstr/reader.html');

    const image = page.frameLocator('#viewer iframe').locator('#embedded-illustration');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(node => ({
      complete: node.complete,
      width: node.naturalWidth,
      height: node.naturalHeight,
    }))).toEqual({ complete: true, width: 1, height: 1 });
  } finally {
    await app.close();
  }
});

test('a failed EPUB open hides the previous book reader instead of showing stale pagination', async () => {
  const launch = electronArgs('stale-reader-fallback-user-data');
  const comic = { md5: '8'.repeat(32), title: 'Previous Comic Fixture', authors: 'Fixture Author', extension: 'cbz', readUrl: 'https://files.test/previous.cbz' };
  const missing = { md5: '9'.repeat(32), title: 'Missing EPUB Fixture', authors: 'Fixture Author', extension: 'epub' };
  await seedDesktopStore(launch.userData, [comic, missing], [
    { bookId: comic.md5, status: 'ready', source: 'torrent' },
    { bookId: missing.md5, status: 'failed', source: 'torrent', error: 'This book is not stored locally' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await app.context().route('https://lib.b.bfr.ee/api/books/**', route => route.fulfill({ status: 404, body: '{}' }));
    await app.context().route('https://lib.b.bfr.ee/api/nostr', route => route.fulfill({ status: 404, body: '{}' }));
    await app.context().route(comic.readUrl, async route => route.fulfill({ status: 200, contentType: 'application/vnd.comicbook+zip', body: await minimalCBZ() }));
    await seedLibrary(page, [comic, missing]);
    await page.reload();
    await page.locator('#home-query-input').fill('');

    await page.getByRole('link', { name: comic.title }).click();
    await expect(page.frameLocator('#reader-frame').locator('#count')).toHaveText('1 / 1');
    await page.getByRole('button', { name: 'Home' }).click();
    await expect(libraryRow(page, missing.title)).toHaveCount(0);
    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.locator('#desktop-downloads-list')).toContainText(missing.title);
    await expect(page.locator('#desktop-downloads-list')).toContainText('This book is not stored locally');
    await expect(page.locator('#read-metadata-fallback')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('unreadable metadata failures appear in Downloads instead of Library', async () => {
  const launch = electronArgs('fallback-user-data');
  const book = {
    md5: '5'.repeat(32),
    title: 'A deliberately long title that must remain compact in a short Electron window instead of taking over the entire page',
    authors: 'A very long fixture author name used to exercise the compact metadata layout',
    extension: 'epub',
  };
  await seedDesktopStore(launch.userData, [book], [
    { bookId: book.md5, status: 'failed', source: 'torrent', error: 'No readable copy is available' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await seedLibrary(page, [book]);
    await page.reload();
    await expect(libraryRow(page, book.title)).toHaveCount(0);
    await page.getByRole('button', { name: 'Downloads' }).click();
    await expect(page.locator('#desktop-downloads-list')).toContainText(book.title);
    await expect(page.locator('#desktop-downloads-list')).toContainText('No readable copy is available');
    await expect(page.locator('#read-metadata-fallback')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('book details author links open an author search', async () => {
  const launch = electronArgs('book-detail-author-link-user-data');
  const book = {
    md5: '4'.repeat(32),
    title: 'The Singularity Is Nearer',
    authors: 'Ray Kurzweil',
    year: '2024',
    extension: 'epub',
  };
  await seedDesktopStore(launch.userData, [book], [
    { bookId: book.md5, status: 'ready', source: 'torrent' },
  ]);
  const app = await electron.launch({ args: launch.args });
  try {
    const page = await app.firstWindow();
    await app.context().route('https://lib.b.bfr.ee/api/search?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"books":[]}' }));
    await seedLibrary(page, [book]);
    await page.reload();
    await libraryRow(page, book.title).getByRole('link', { name: book.authors }).click();
    await expect(page.locator('#search-type')).toHaveValue('author');
    await expect(page.locator('#query-input')).toHaveValue(book.authors);
  } finally {
    await app.close();
  }
});
