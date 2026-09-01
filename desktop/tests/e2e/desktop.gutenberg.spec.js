const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, test, expect } = require('@playwright/test');

const JSZip = require('../../../web/jszip.min.js');

async function minimalEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">urn:bookstr:test:gutenberg</dc:identifier>
        <dc:title>Gutenberg Library Book</dc:title><dc:language>en</dc:language>
      </metadata>
      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`);
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Gutenberg Library Book</title></head>
    <body><h1>Loaded from Gutenberg</h1><p>The Electron library route opened this publication.</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

test('a Gutenberg library row opens its EPUB through the Electron catalog route', async () => {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, 'gutenberg-user-data-'));
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '../..'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  try {
    const library = await electronApp.firstWindow();
    const epub = await minimalEpub();
    await library.addInitScript(bytes => {
      const originalFetch = window.fetch.bind(window);
      window.__gutenbergDownloads = 0;
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === 'string' ? input : input?.url;
        const url = new URL(rawUrl, location.href);
        if (url.href === 'app://bookstr/api/books/999001/download') {
          window.__gutenbergDownloads += 1;
          return new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { 'Content-Type': 'application/epub+zip' },
          });
        }
        return originalFetch(input, init);
      };
    }, Array.from(epub));
    await library.evaluate(() => {
      localStorage.setItem('bookstr_reader_settings_v1', JSON.stringify({
        autoReading: false,
        useNip7: false,
        theme: 'white',
      }));
      localStorage.setItem('bookstr_reading_library_v1', JSON.stringify([{
        md5: 'gutenberg:999001',
        source: 'gutenberg',
        sourceNativeId: '999001',
        title: 'Gutenberg Library Book',
        authors: 'Fixture Author',
        extension: 'epub',
        readUrl: 'app://bookstr/api/books/999001/download',
      }]));
    });
    await library.reload();

    await library.getByRole('link', { name: 'Gutenberg Library Book' }).click();
    await expect(library).toHaveURL(/#read=app%3A%2F%2Fbookstr%2Fapi%2Fbooks%2F999001%2Fdownload/);
    const reader = library.frameLocator('#reader-frame');
    await expect(reader.locator('body')).toHaveAttribute('data-location', /.+/, { timeout: 30_000 });
    await expect.poll(() => library.evaluate(() => window.__gutenbergDownloads)).toBe(1);
  } finally {
    await electronApp.close();
  }
});
