import { test, expect } from '@playwright/test';

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
  const bytes = await page.evaluate(async url => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], downloadUrl);
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
  await expect(pdfReader.locator('#download')).toHaveAttribute('download', 'Readable PDF Test.pdf');
});

test('switching EPUBs quickly leaves only the newest book in the reader', async ({ page }) => {
  const first = 'https://books-api.guaka.org/api/books/30142/download';
  const second = 'https://books-api.guaka.org/api/books/34527/download';
  await page.goto(`/#read=${encodeURIComponent(first)}`);
  await page.goto(`/#read=${encodeURIComponent(second)}`);

  const reader = page.frameLocator('#reader-frame');
  await expect(reader.locator('body')).toHaveAttribute('data-book-id', 'gutenberg:34527', { timeout: 45_000 });
  await expect(reader.locator('#viewer > .epub-container')).toHaveCount(1);
});

test('Open Library search results expose canonical work links', async ({ page }) => {
  await page.goto('/#search=test');
  const link = page.locator('a.result-source[href^="https://openlibrary.org/works/OL"]').first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('href', /^https:\/\/openlibrary\.org\/works\/OL\d+W$/);
});
