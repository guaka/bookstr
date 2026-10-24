(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BookstrDesktopKindle = api;
})(globalThis, function() {
  'use strict';
  function transferableDownloads(jobs) {
    return jobs.filter(job => ['ready', 'seeding'].includes(job.status)
      && (/^(pdf|txt|cbz|cbr)$/i.test(job.extension || '')
        || (String(job.extension).toLowerCase() === 'epub' && /\.(cbz|cbr)$/i.test(job.title || ''))));
  }
  function progressText(progress) {
    const phase = ({ converting: 'Converting', checking: 'Checking existing books', copying: 'Copying', verifying: 'Verifying' })[progress.phase] || 'Copying';
    const title = progress.title ? ` ${progress.title}` : '';
    const percent = Number.isFinite(progress.percent) ? ` · ${Math.max(0, Math.min(100, Math.round(progress.percent)))}%` : '';
    const pages = Number.isInteger(progress.page) && Number.isInteger(progress.pages) ? ` · ${progress.page}/${progress.pages} pages` : '';
    return phase + title + percent + pages;
  }
  function createLibraryPresence() {
    const devices = new Map();
    function entry(id) {
      if (!devices.has(id)) devices.set(id, { books: new Set(), failures: new Set(), revision: 0 });
      return devices.get(id);
    }
    return {
      has(id, bookId) { return Boolean(devices.get(id)?.books.has(bookId)); },
      failed(id, bookId) { return Boolean(devices.get(id)?.failures.has(bookId)); },
      fail(id, bookId) { const value = entry(id); value.revision++; value.books.delete(bookId); value.failures.add(bookId); },
      begin(id) { const value = entry(id); return { id, value, revision: value.revision }; },
      apply(token, bookIds) {
        if (devices.get(token.id) !== token.value || token.value.revision !== token.revision) return false;
        token.value.books = new Set(bookIds);
        for (const id of bookIds) token.value.failures.delete(id);
        return true;
      },
      mark(id, bookIds) {
        const value = entry(id);
        value.revision++;
        for (const bookId of bookIds) { value.books.add(bookId); value.failures.delete(bookId); }
      },
      retain(ids) {
        for (const id of devices.keys()) if (!ids.includes(id)) devices.delete(id);
      },
    };
  }
  return { transferableDownloads, progressText, createLibraryPresence };
});
