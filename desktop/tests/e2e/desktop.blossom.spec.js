const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
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
        <dc:identifier id="book-id">urn:bookstr:test:blossom</dc:identifier>
        <dc:title>Blossom Desktop Book</dc:title><dc:language>en</dc:language>
      </metadata>
      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`);
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>Blossom Desktop Book</title></head>
    <body><h1>Loaded over Blossom</h1><p>The Electron proxy delivered this publication.</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

test('Electron opens an authenticated Blossom EPUB through its same-origin proxy', async () => {
  const epub = await minimalEpub();
  const sha256 = crypto.createHash('sha256').update(epub).digest('hex');
  const md5 = 'd'.repeat(32);
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization || '' });
    if (request.url !== `/${sha256}.epub`) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/epub+zip',
      'Content-Length': epub.length,
    });
    response.end(epub);
  });
  const address = await listen(server);
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, 'blossom-user-data-'));
  const electronApp = await electron.launch({
    args: [path.join(__dirname, '../..'), `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BOOKSTR_DESKTOP_NSEC: '1'.repeat(64),
      BOOKSTR_DESKTOP_TEST_BLOSSOM_BASE_URL: `http://127.0.0.1:${address.port}`,
    },
  });

  try {
    const library = await electronApp.firstWindow();
    await library.evaluate(({ id, hash }) => {
      localStorage.setItem('bookstr_reader_settings_v1', JSON.stringify({
        autoReading: false,
        useNip7: false,
        theme: 'white',
      }));
      localStorage.setItem('bookstr_nostr_favorites_v1', JSON.stringify([{
        md5: id,
        title: 'Blossom Desktop Book',
        authors: 'Fixture Author',
        extension: 'epub',
        blossomSha256: hash,
        blossomUrl: `https://blossom.bfr.ee/${hash}.epub`,
        readUrl: `https://blossom.bfr.ee/${hash}.epub`,
      }]));
    }, { id: md5, hash: sha256 });
    await library.reload();
    const title = library.getByRole('link', { name: 'Blossom Desktop Book' }).first();
    await expect(title).toBeVisible();
    await title.click();
    expect(await electronApp.windows()).toHaveLength(1);
    const reader = library.frameLocator('#reader-frame');
    await expect(reader.locator('body')).toHaveAttribute('data-location', /.+/, { timeout: 45_000 });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`/${sha256}.epub`);
    expect(requests[0].authorization).toMatch(/^Nostr [A-Za-z0-9+/=_-]+$/);
  } finally {
    await electronApp.close();
    await close(server);
  }
});
