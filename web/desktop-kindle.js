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
    const phase = ({ converting: 'Converting', checking: 'Checking existing books', copying: 'Copying', verifying: 'Verifying', copied: 'Copied', failed: 'Failed' })[progress.phase] || 'Copying';
    const title = progress.title ? ` ${progress.title}` : '';
    const percent = Number.isFinite(progress.percent) ? ` · ${Math.max(0, Math.min(100, Math.round(progress.percent)))}%` : '';
    const pages = Number.isInteger(progress.page) && Number.isInteger(progress.pages) ? ` · ${progress.page}/${progress.pages} pages` : '';
    return phase + title + percent + pages;
  }
  function createTransferOverview() {
    let state;
    function start(books) {
      state = { running: true, message: 'Preparing Kindle transfer…', completed: 0,
        total: books.length, value: 0, max: 1, determinate: false,
        items: books.map(book => ({ bookId: book.bookId, title: book.title || book.bookId, status: 'Waiting' })) };
    }
    function update(progress) {
      if (!state?.running || progress.done) return;
      state.message = progressText(progress);
      const item = state.items.find(book => book.bookId === progress.bookId);
      if (item) item.status = progress.phase === 'copied' ? 'Copied' : progress.phase === 'failed' ? `Failed: ${progress.error}` : state.message;
      if (Number.isInteger(progress.completed)) state.completed = Math.max(0, Math.min(state.total, progress.completed));
      const percent = Number.isFinite(progress.percent) ? progress.percent
        : Number.isInteger(progress.page) && progress.pages > 0 ? progress.page / progress.pages * 100 : null;
      state.determinate = percent !== null;
      state.value = percent === null ? 0 : Math.max(0, Math.min(100, percent));
      state.max = 100;
    }
    function finish(result) {
      state.running = false;
      const transferred = new Set(result.transferred);
      const errors = result.errors || [];
      const skipped = result.skipped || [];
      state.completed = transferred.size;
      state.message = `${transferred.size} copied · ${result.alreadyPresent || 0} already there · ${skipped.length} skipped · ${errors.length} failed`;
      let alreadyRemaining = Math.max(0, Number(result.alreadyPresent) || 0);
      for (const item of state.items) {
        const error = errors.find(error => error.bookId === item.bookId);
        const skip = skipped.find(skip => skip.bookId === item.bookId || skip.title === item.title);
        item.status = transferred.has(item.bookId) ? 'Copied' : error ? `Failed: ${error.error}`
          : skip ? `Skipped: ${skip.reason}` : alreadyRemaining-- > 0 ? 'Already on Kindle' : 'Not completed';
      }
      state.determinate = true;
      state.max = Math.max(1, state.total);
      state.value = state.max;
    }
    function fail(error) {
      state.running = false;
      state.message = error?.message || String(error);
      state.determinate = false;
      for (const item of state.items) if (item.status !== 'Copied') item.status = 'Not completed';
    }
    return { start, update, finish, fail, snapshot: () => state };
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
  return { transferableDownloads, progressText, createLibraryPresence, createTransferOverview };
});
