import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('../jszip.min.js');

async function minimalEpub(title, body = title) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">urn:bookstr:test:${title}</dc:identifier>
        <dc:title>${title}</dc:title><dc:language>en</dc:language>
      </metadata>
      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`);
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
    <body><h1>${title}</h1><p>${body}</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

async function readerFixtureEpub(title) {
  const zip = new JSZip();
  const paragraphs = Array.from({ length: 90 }, (_, index) => (
    `<p>${title} reading fixture paragraph ${index + 1}. This text keeps the continuous reader tall enough to exercise wheel and keyboard navigation.</p>`
  )).join('');
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">urn:bookstr:reader-fixture:${title}</dc:identifier>
        <dc:title>${title}</dc:title><dc:language>en</dc:language>
      </metadata>
      <manifest>
        <item id="cover-image" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>
        <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="cover"/><itemref idref="chapter"/></spine>
    </package>`);
  zip.file('OEBPS/cover.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900">
    <rect width="600" height="900" fill="#2f5d50"/><rect x="55" y="55" width="490" height="790" fill="#f7f3ea"/>
    <text x="300" y="450" text-anchor="middle" font-size="42" fill="#1c1916">${title}</text>
  </svg>`);
  zip.file('OEBPS/cover.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <head><title>${title} cover</title></head><body epub:type="cover"><img src="cover.svg" alt="${title} cover"/></body>
    </html>`);
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
      <body><h1>${title}</h1>${paragraphs}</body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

function minimalPdf(text) {
  const escaped = String(text).replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

const books = [
  { id: '30142', title: 'Little Brother' },
  { id: '34527', title: 'Gutenberg 34527' },
  { id: '48320', title: 'Adventures of Sherlock Holmes' },
];

for (const book of books) {
  test(`${book.title} keeps a large cover and advances`, async ({ page }) => {
    const readUrl = `https://books-api.guaka.org/api/books/${book.id}/download`;
    const epub = await readerFixtureEpub(book.title);
    await page.route(readUrl, route => route.fulfill({
      status: 200,
      contentType: 'application/epub+zip',
      body: epub,
    }));
    await page.goto(`/#read=${encodeURIComponent(readUrl)}`);

    await expect(page.locator('#reader-frame')).toHaveAttribute('src', /reader\.html/);
    const reader = page.frameLocator('#reader-frame');
    await expect(reader.locator('#reader-next')).toBeVisible();
    await expect(reader.locator('body')).toHaveAttribute('data-location', /epubcfi\(/);

    const content = reader.frameLocator('#viewer iframe').first();
    const cover = content.locator('html.bookstr-cover img, html.bookstr-cover svg').first();
    await expect(cover).toBeVisible();
    const coverBox = await cover.boundingBox();
    expect(coverBox).not.toBeNull();
    expect(coverBox.height).toBeGreaterThan(430);

    const scrollContainer = reader.locator('.epub-container');
    await expect.poll(() => scrollContainer.evaluate(node => node.scrollHeight - node.clientHeight))
      .toBeGreaterThan(300);
    const scrollBefore = await scrollContainer.evaluate(node => node.scrollTop);
    const readerBox = await page.locator('#reader-frame').boundingBox();
    expect(readerBox).not.toBeNull();
    await page.mouse.move(readerBox.x + readerBox.width / 2, readerBox.y + readerBox.height / 2);
    await page.mouse.wheel(0, 650);
    await expect.poll(() => scrollContainer.evaluate(node => node.scrollTop)).toBeGreaterThan(scrollBefore);

    const arrowScrollBefore = await scrollContainer.evaluate(node => node.scrollTop);
    await page.keyboard.press('ArrowRight');
    await expect.poll(
      () => scrollContainer.evaluate(node => node.scrollTop),
      { message: 'ArrowRight should advance the vertically scrolling reader' },
    ).toBeGreaterThan(arrowScrollBefore);
  });
}

test('legacy LibVault links become MD5 routes and open the Blossom copy', async ({ page }) => {
  const md5 = 'f5277d56f3ecec3912e1b2b60cbd0eed';
  const legacyUrl = `https://lib.b.bfr.ee/api/read/${md5}`;
  const blossomUrl = 'https://books-api.guaka.org/api/books/30142/download';
  const epub = await minimalEpub('Little Brother');
  await page.route(blossomUrl, route => route.fulfill({
    status: 200,
    contentType: 'application/epub+zip',
    body: epub,
  }));

  await page.addInitScript(({ md5, legacyUrl, blossomUrl }) => {
    localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify([{
      md5,
      title: 'Little Brother',
      author: 'Cory Doctorow',
      extension: 'epub',
      readUrl: legacyUrl,
      blossomUrl,
    }]));
  }, { md5, legacyUrl, blossomUrl });

  await page.goto(`/#read=${encodeURIComponent(legacyUrl)}`);

  await expect(page).toHaveURL(new RegExp(`#read=${md5}$`));
  await expect(page.locator('#reader-frame')).toHaveAttribute('src', /reader\.html/);
  await expect(page.frameLocator('#reader-frame').locator('body')).toHaveAttribute('data-location', /epubcfi\(/, {
    timeout: 45_000,
  });
});

test('an unavailable MD5 still shows its known book metadata', async ({ page }) => {
  const md5 = '11111111111111111111111111111111';
  await page.addInitScript(({ md5 }) => {
    localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify([{
      md5,
      title: 'Unavailable Test Book',
      author: 'Known Author',
      year: 2024,
      language: 'pt',
      extension: 'epub',
      blossomUrl: 'https://unavailable.invalid/book.epub',
    }]));
  }, { md5 });
  await page.route('https://unavailable.invalid/book.epub', route => route.abort());
  await page.goto(`/#read=${md5}`);

  const metadata = page.locator('#read-metadata-fallback');
  await expect(metadata).toBeVisible();
  await expect(metadata).toContainText('Unavailable Test Book');
  await expect(metadata).toContainText('Known Author');
  await expect(metadata).toContainText('2024');
  await expect(metadata).toContainText('pt');
});

test('an MD5 route reopens a legacy URL-keyed EPUB cache while offline', async ({ page }) => {
  const md5 = '22222222222222222222222222222222';
  const downloadUrl = 'https://books-api.guaka.org/api/books/30142/download';
  const legacyKey = `https://lib.b.bfr.ee/api/read/${md5}`;
  await page.goto('/#home');
  const bytes = [...await minimalEpub('Cached Little Brother')];
  await page.evaluate(async ({ legacyKey, bytes }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bookstr_epub_cache_v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const request = database.transaction('books', 'readwrite').objectStore('books').put({
        key: legacyKey,
        blob: new Blob([new Uint8Array(bytes)], { type: 'application/epub+zip' }),
        title: 'Cached Little Brother',
        extension: 'epub',
        lastUsed: Date.now(),
      });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }, { legacyKey, bytes });
  await page.route(downloadUrl, route => route.abort());

  await page.goto(`/#read=${md5}`);

  await expect(page.frameLocator('#reader-frame').locator('body')).toHaveAttribute('data-location', /epubcfi\(/, {
    timeout: 45_000,
  });
});

test('the f527 MD5 infers and opens a legacy cached PDF without a source URL', async ({ page }) => {
  const md5 = 'f5277d56f3ecec3912e1b2b60cbd0eed';
  const legacyKey = `https://lib.b.bfr.ee/api/read/${md5}`;
  await page.goto('/#home');
  await page.evaluate(async ({ legacyKey }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bookstr_epub_cache_v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const request = database.transaction('books', 'readwrite').objectStore('books').put({
        key: legacyKey,
        blob: new Blob(['%PDF-1.4\\n%%EOF'], { type: '' }),
        title: 'Cached PDF',
        lastUsed: Date.now(),
      });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }, { legacyKey });

  await page.goto(`/#read=${md5}`);

  await expect(page.locator('#reader-frame')).toHaveAttribute('src', /pdf-reader\.html/);
  await expect(page).toHaveURL(new RegExp(`#read=${md5}$`));
});

test('PDFs render inside Bookstr and download with the book title', async ({ page }) => {
  const md5 = '33333333333333333333333333333333';
  const pdfUrl = 'https://files.test/readable.pdf';
  await page.addInitScript(({ md5, pdfUrl }) => {
    localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify([{
      md5,
      title: 'Readable PDF Test',
      authors: 'Test Author',
      extension: 'pdf',
      readUrl: pdfUrl,
    }]));
  }, { md5, pdfUrl });
  await page.route(pdfUrl, route => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    body: minimalPdf('Readable PDF Test'),
  }));

  await page.goto(`/#read=${md5}`);

  await expect(page.locator('#reader-frame')).toHaveAttribute('src', /pdf-reader\.html/);
  const pdfReader = page.frameLocator('#reader-frame');
  await expect(pdfReader.locator('.pdf-page canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(pdfReader.locator('#page-count')).toHaveText('1 page');
  await expect(pdfReader.locator('#download')).toHaveAttribute('download', 'Readable PDF Test.pdf');
  await expect(pdfReader.locator('#download')).toHaveAttribute('href', /^blob:/);
  await pdfReader.locator('#zoom-in').click();
  await expect(pdfReader.locator('#zoom-label')).toHaveText('115%');
});

test('a LibVault PDF without format metadata is sniffed and gets a useful fallback filename', async ({ page }) => {
  const md5 = '44444444444444444444444444444444';
  const pdfUrl = `https://lib.b.bfr.ee/api/files/${md5}`;
  await page.addInitScript(({ md5, pdfUrl }) => {
    localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify([{
      md5,
      title: 'Untitled book',
      authors: '',
      source: 'openlibrary',
      sourceNativeId: 'OL987654W',
      readUrl: pdfUrl,
    }]));
  }, { md5, pdfUrl });
  await page.route(pdfUrl, route => route.fulfill({
    status: 200,
    contentType: 'application/octet-stream',
    body: minimalPdf('Metadata-free PDF'),
  }));

  await page.goto(`/#read=${md5}`);

  const pdfReader = page.frameLocator('#reader-frame');
  await expect(pdfReader.locator('.pdf-page canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(pdfReader.locator('#download')).toHaveAttribute('download', 'Bookstr book OL987654W.pdf');
});

test('switching PDFs reuses the in-app reader without retaining the previous document', async ({ page }) => {
  const books = [
    { md5: '55555555555555555555555555555555', title: 'First PDF', url: 'https://files.test/first.pdf' },
    { md5: '66666666666666666666666666666666', title: 'Second / PDF: Test?', url: 'https://files.test/second.pdf' },
  ];
  await page.addInitScript(entries => {
    localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify(entries.map(entry => ({
      md5: entry.md5,
      title: entry.title,
      extension: 'pdf',
      readUrl: entry.url,
    }))));
  }, books);
  for (const book of books) {
    await page.route(book.url, route => route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: minimalPdf(book.title),
    }));
  }

  await page.goto(`/#read=${books[0].md5}`);
  const pdfReader = page.frameLocator('#reader-frame');
  await expect(pdfReader.locator('#title')).toHaveText(books[0].title);
  await expect(pdfReader.locator('.pdf-page')).toHaveCount(1);

  await page.evaluate(md5 => { window.location.hash = `read=${md5}`; }, books[1].md5);
  await expect(pdfReader.locator('#title')).toHaveText(books[1].title);
  await expect(pdfReader.locator('#download')).toHaveAttribute('download', 'Second PDF Test.pdf');
  await expect(pdfReader.locator('.pdf-page')).toHaveCount(1);
  await expect(pdfReader.locator('.pdf-page canvas')).toHaveAttribute('data-rendered', 'true');
});

test('switching EPUBs quickly leaves only the newest book in the reader', async ({ page }) => {
  const first = 'https://files.test/slow-first.epub';
  const second = 'https://files.test/newest-second.epub';
  const [firstEpub, secondEpub] = await Promise.all([
    minimalEpub('Slow first book'),
    minimalEpub('Newest second book'),
  ]);
  await page.route(first, async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.fulfill({ status: 200, contentType: 'application/epub+zip', body: firstEpub });
  });
  await page.route(second, route => route.fulfill({
    status: 200,
    contentType: 'application/epub+zip',
    body: secondEpub,
  }));
  await page.goto('/#home');
  await page.evaluate(url => { window.location.hash = `read=${encodeURIComponent(url)}`; }, first);
  await page.waitForTimeout(100);
  await page.evaluate(url => { window.location.hash = `read=${encodeURIComponent(url)}`; }, second);

  const reader = page.frameLocator('#reader-frame');
  await expect(reader.locator('body')).toHaveAttribute('data-book-id', `url:${second}`, { timeout: 45_000 });
  await expect(reader.locator('#viewer > .epub-container')).toHaveCount(1);
});

test('two cached EPUBs remain isolated while switching without a page refresh', async ({ page }) => {
  const books = [
    { id: 'first', url: 'https://files.test/cached-first.epub', title: 'Cached first' },
    { id: 'second', url: 'https://files.test/cached-second.epub', title: 'Cached second' },
  ];
  const encodedEpubs = await Promise.all(books.map(async book => (
    await minimalEpub(book.title, `Only ${book.id} content.`)
  ).toString('base64')));
  await page.goto('/#home');
  await page.evaluate(async ({ entries, encodedEpubs }) => {
    const blobs = encodedEpubs.map(encoded => {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new Blob([bytes], { type: 'application/epub+zip' });
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bookstr_epub_cache_v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('books', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await Promise.all(entries.map((entry, index) => new Promise((resolve, reject) => {
      const request = database.transaction('books', 'readwrite').objectStore('books').put({
        key: entry.url,
        readUrl: entry.url,
        blob: blobs[index],
        extension: 'epub',
        title: entry.title,
        lastUsed: Date.now() + index,
      });
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    })));
  }, { entries: books, encodedEpubs });
  for (const book of books) await page.route(book.url, route => route.abort());

  await page.evaluate(url => { window.location.hash = `read=${encodeURIComponent(url)}`; }, books[0].url);
  const reader = page.frameLocator('#reader-frame');
  await expect(reader.locator('body')).toHaveAttribute('data-book-id', books[0].url, { timeout: 45_000 });
  await page.evaluate(url => { window.location.hash = `read=${encodeURIComponent(url)}`; }, books[1].url);
  await expect(page).toHaveURL(new RegExp(`#read=${encodeURIComponent(books[1].url)}$`));
  await expect(page.locator('#status')).toContainText(books[1].title, { timeout: 45_000 });
  await expect(reader.locator('body')).toHaveAttribute('data-book-id', books[1].url, { timeout: 45_000 });
  await expect(reader.locator('#viewer > .epub-container')).toHaveCount(1);
  await page.evaluate(url => { window.location.hash = `read=${encodeURIComponent(url)}`; }, books[0].url);
  await expect(reader.locator('body')).toHaveAttribute('data-book-id', books[0].url, { timeout: 45_000 });
});

test('Home never shows Words and the header link follows active synced words', async ({ page }) => {
  await page.goto('/#home');
  await expect(page.locator('#home-words-list')).toHaveCount(0);
  await expect(page.locator('#words-tab-btn')).toBeHidden();

  await page.evaluate(() => {
    localStorage.setItem('bookstr_words_v1', JSON.stringify([{
      key: 'en:reader',
      word: 'reader',
      language: 'en',
      definitions: ['Someone who reads.'],
      updatedAt: Date.now(),
    }]));
  });
  await page.reload();
  await expect(page.locator('#words-tab-btn')).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem('bookstr_words_v1', JSON.stringify([{
      key: 'en:reader',
      word: 'reader',
      language: 'en',
      deleted: true,
      updatedAt: Date.now(),
    }]));
  });
  await page.reload();
  await expect(page.locator('#words-tab-btn')).toBeHidden();
});

test('direct Words routes require an active synced word', async ({ page }) => {
  await page.goto('/?direct-words=1#words');
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator('#home-tab')).toBeVisible();
  await expect(page.locator('#words-tab')).toBeHidden();

  await page.addInitScript(() => {
    localStorage.setItem('bookstr_words_v1', JSON.stringify([{
      key: 'en:book',
      word: 'book',
      language: 'en',
      definitions: ['A written work.'],
      updatedAt: Date.now(),
    }]));
  });
  await page.goto('/#words');
  await expect(page.locator('#words-tab')).toBeVisible();
  await expect(page.locator('.word-heading')).toContainText('book');
  await expect(page.locator('.word-lookup')).toContainText('A written work.');
});

test('Open Library search results expose canonical work links', async ({ page }) => {
  await page.goto('/#search=test');
  const link = page.locator('a.result-source[href^="https://openlibrary.org/works/OL"]').first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('href', /^https:\/\/openlibrary\.org\/works\/OL\d+W$/);
});
