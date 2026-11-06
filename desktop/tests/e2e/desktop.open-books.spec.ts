import * as path from 'node:path';
import * as fs from 'node:fs';
import { _electron as electron, expect, test } from '@playwright/test';
type Zip = { file(path: string, data: string | Buffer, options?: { compression?: string }): void; generateAsync(options: { type: 'nodebuffer'; mimeType?: string }): Promise<Buffer> };
const JSZip = require('../../../web/jszip.min.js') as new () => Zip;

test('OS file opens import EPUB on launch and PDF into the running reader', async () => {
  const output = path.resolve(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const root = fs.mkdtempSync(path.join(output, 'open-books-'));
  const epub = path.join(root, 'External Book.epub');
  const pdf = path.join(root, 'External PDF.pdf');
  fs.writeFileSync(epub, await minimalEpub('External Book'));
  fs.writeFileSync(pdf, minimalPdf('External PDF contents.'));
  const app = await electron.launch({ args: ['--mute-audio', '--disable-speech-api', path.join(__dirname, '../..'), `--user-data-dir=${root}/profile`, epub] });
  try {
    const page = await app.firstWindow();
    await page.waitForURL('app://bookstr/reader.html');
    await expect(page.locator('#viewer iframe').first()).toBeVisible({ timeout: 45_000 });
    await app.evaluate(({ app }, file) => {
      app.emit('open-file', { preventDefault() {} } as Electron.Event, file);
    }, pdf);
    await page.waitForURL('app://bookstr/pdf-reader.html');
    await expect(page.locator('.pdf-page canvas').first()).toHaveAttribute('data-rendered', 'true', { timeout: 45_000 });
    fs.unlinkSync(epub); fs.unlinkSync(pdf);
    await app.evaluate(({ app }, file) => {
      app.emit('second-instance', {} as Electron.Event, ['bookstr', file], process.cwd());
    }, path.join(root, 'profile/library/books', fs.readdirSync(path.join(root, 'profile/library/books')).find(file => file.endsWith('.epub'))!));
    await page.waitForURL('app://bookstr/reader.html');
    await expect(page.locator('#viewer iframe').first()).toBeVisible({ timeout: 45_000 });
  } finally { await app.close(); }
});
async function minimalEpub(title: string) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>\n    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n    </container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>\n    <package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id">\n      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n        <dc:identifier id="book-id">urn:bookstr:test:${title}</dc:identifier>\n        <dc:title>${title}</dc:title><dc:language>en</dc:language>\n      </metadata>\n      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>\n      <spine><itemref idref="chapter"/></spine>\n    </package>`);
  zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?>\n    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>\n    <body><h1>${title}</h1><p>${Array.from({ length: 55 }, (_, index) => 'speechword' + index).join(' ')}.</p><p>Second paragraph.</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

function minimalPdf(text: string, secondPageText = 'Second PDF page.') {
  const escaped = String(text).replace(/([\\()])/g, '\\$1');
  const escapedSecondPage = String(secondPageText).replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const secondStream = `BT /F1 24 Tf 72 720 Td (${escapedSecondPage}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}\nendstream`,
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

