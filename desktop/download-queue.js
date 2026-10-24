'use strict';

const ACTIVE = new Set(['queued', 'finding-peers', 'downloading', 'retrying']);
const COMPLETE = new Set(['ready', 'seeding']);
const MD5 = /^[a-f0-9]{32}$/;
const FORMATS = new Set(['epub', 'pdf', 'fb2', 'cbz', 'cbr']);
const MAX_CONCURRENT_ACQUISITIONS = 100;

function libgenRequest(book) {
  const md5 = String(book?.md5 || '').trim().toLowerCase();
  const libgenId = Number(book?.libgenId || book?.libgen_id || book?.sourceNativeId);
  const extension = String(book?.extension || book?.format || '').trim().toLowerCase();
  if (!MD5.test(md5) || !Number.isSafeInteger(libgenId) || libgenId <= 0 || !FORMATS.has(extension)) {
    throw new TypeError('A Libcat download requires an MD5, edition number, and supported format.');
  }
  return {
    md5, libgenId, extension,
    title: String(book.title || '').slice(0, 400),
    authors: String(book.authors || book.author || '').slice(0, 400),
    language: String(book.language || '').slice(0, 32),
    year: String(book.year || '').slice(0, 32),
    isbn: String(book.isbn || '').slice(0, 64),
    filesize_bytes: Number(book.filesize_bytes || book.filesize || 0),
    source: 'libvault',
    rights_status: String(book.rights_status || book.rightsStatus || 'unknown'),
    license: String(book.license || ''),
    license_url: String(book.license_url || book.licenseUrl || ''),
    rights_source: String(book.rights_source || book.rightsSource || ''),
  };
}

class DownloadQueue {
  constructor({ store, acquisitionManager, onUpdate = () => {}, autoSeed = true, maxConcurrent = MAX_CONCURRENT_ACQUISITIONS } = {}) {
    if (!store || !acquisitionManager) throw new TypeError('store and acquisitionManager are required');
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > MAX_CONCURRENT_ACQUISITIONS) {
      throw new RangeError(`maxConcurrent must be an integer from 1 to ${MAX_CONCURRENT_ACQUISITIONS}`);
    }
    this.store = store;
    this.acquisitionManager = acquisitionManager;
    this.onUpdate = onUpdate;
    this.autoSeed = autoSeed;
    this.maxConcurrent = maxConcurrent;
    this.pending = [];
    this.activeJobs = new Map();
    this.drainPromise = null;
  }

  async prepare(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('Invalid download request.');
    if (request.kind === 'libgen') {
      const record = libgenRequest(request.record);
      return { bookId: record.md5, fields: { ...record, id: record.md5 }, request: { kind: 'libgen', record } };
    }
    if (request.kind === 'provider') {
      const { listAcquisitions, providerBookFields } = await import('../shared/catalog/acquisition.mjs');
      const record = request.record;
      const acquisitions = listAcquisitions(record).filter(candidate => !candidate.private);
      if (!acquisitions.length) throw new TypeError('This result has no downloadable file.');
      const fields = providerBookFields(record);
      return { bookId: fields.id, fields, request: { kind: 'provider', record } };
    }
    throw new TypeError('Unsupported download request.');
  }

  async enqueue(request) {
    const prepared = await this.prepare(request);
    const existing = this.store.downloads().find(item => item.bookId === prepared.bookId);
    if (existing && (ACTIVE.has(existing.status) || COMPLETE.has(existing.status))) return existing;
    this.store.upsertBook(prepared.fields);
    this.store.setDownload({ bookId: prepared.bookId, status: 'queued', source: prepared.request.kind });
    this.store.saveDownloadRequest(prepared.bookId, prepared.request);
    this.schedule(prepared.bookId, prepared.request);
    this.onUpdate();
    return this.store.downloads().find(item => item.bookId === prepared.bookId);
  }

  async retry(bookId) {
    const request = this.store.downloadRequest(bookId);
    if (!request) throw new Error('Download cannot be retried without its source record.');
    return this.enqueue(request);
  }

  async resume() {
    for (const job of this.store.resumableDownloads()) {
      try {
        const prepared = await this.prepare(job.request);
        if (prepared.bookId !== job.bookId) throw new Error('Saved download identity changed.');
        this.store.setDownload({ bookId: job.bookId, status: 'queued', source: job.request.kind });
        this.schedule(job.bookId, job.request);
      } catch (error) {
        this.store.setDownload({ bookId: job.bookId, status: 'failed', error: error.message });
      }
    }
    this.onUpdate();
  }

  schedule(bookId, request) {
    if (this.activeJobs.has(bookId) || this.pending.some(job => job.bookId === bookId)) return;
    this.pending.push({ bookId, request });
    void this.drain();
  }

  async drain() {
    if (this.drainPromise) {
      this.startPending();
      return this.drainPromise;
    }
    const drainPromise = this.drainPending();
    this.drainPromise = drainPromise;
    try {
      await drainPromise;
    } finally {
      if (this.drainPromise === drainPromise) this.drainPromise = null;
    }
    if (this.pending.length || this.activeJobs.size) return this.drain();
  }

  async drainPending() {
    while (this.pending.length || this.activeJobs.size) {
      this.startPending();
      if (this.activeJobs.size) await Promise.race(this.activeJobs.values());
    }
  }

  startPending() {
    while (this.pending.length && this.activeJobs.size < this.maxConcurrent) {
      const job = this.pending.shift();
      const task = this.runJob(job).finally(() => {
        this.activeJobs.delete(job.bookId);
        this.notifyUpdate();
      });
      this.activeJobs.set(job.bookId, task);
    }
  }

  async runJob({ bookId, request }) {
    try {
      let lastProgressNoticeAt = null;
      const onProgress = () => {
        const now = Date.now();
        if (lastProgressNoticeAt !== null && now - lastProgressNoticeAt < 500) return;
        lastProgressNoticeAt = now;
        this.notifyUpdate();
      };
      if (request.kind === 'libgen') {
        await this.acquisitionManager.acquireLibgen(request.record, { autoSeed: this.autoSeed, onProgress });
      } else {
        await this.acquisitionManager.acquire(request.record, { onProgress, allowUnverifiedOpen: true });
      }
    } catch (error) {
      try {
        this.store.setDownload({ bookId, status: 'failed', source: request.kind, error: error.message || String(error) });
      } catch {}
    }
  }

  notifyUpdate() {
    try { this.onUpdate(); } catch {}
  }
}

module.exports = { DownloadQueue, libgenRequest };
