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
  return { transferableDownloads, progressText };
});
