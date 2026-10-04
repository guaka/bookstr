'use strict';

const path = require('node:path');

const READER_FORMATS = new Set(['epub', 'pdf', 'fb2', 'cbz', 'cbr']);

async function downloadsForRenderer(downloads, resolveRegisteredFile) {
  return Promise.all(downloads.map(async download => {
    let readable = false;
    try {
      const resolved = await resolveRegisteredFile(download.bookId);
      const fileFormat = path.extname(resolved.filePath).slice(1).toLowerCase();
      const bookFormat = String(resolved.book.extension || '').toLowerCase().replace(/^\./, '');
      readable = READER_FORMATS.has(fileFormat) && fileFormat === bookFormat;
    } catch {
      // Missing, invalid, or out-of-library registrations are not local copies.
    }
    return { ...download, readable };
  }));
}

module.exports = { downloadsForRenderer };
