'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

let catalogModulePromise;
function catalogModule() {
  catalogModulePromise ||= import('../shared/catalog/acquisition.mjs');
  return catalogModulePromise;
}

function safePath(root, value) {
  const candidate = path.resolve(root, value);
  const relative = path.relative(path.resolve(root), candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError('staging path escaped its root');
  }
  return candidate;
}

function extensionFor(format) {
  const extension = String(format || '').trim().toLowerCase().replace(/^\./, '');
  if (!['epub', 'pdf', 'fb2'].includes(extension)) throw new TypeError('unsupported acquisition format');
  return extension;
}

function responseLength(response) {
  const value = response?.headers?.get?.('content-length');
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : 0;
}

async function responseStream(response) {
  if (response?.body && typeof response.body.getReader === 'function') return Readable.fromWeb(response.body);
  if (response?.body && typeof response.body.pipe === 'function') return response.body;
  if (response && typeof response.arrayBuffer === 'function') return Readable.from(Buffer.from(await response.arrayBuffer()));
  throw new Error('acquisition response has no readable body');
}

function waitForTorrent(torrent, onProgress, signal) {
  if (!torrent || typeof torrent.on !== 'function') throw new Error('torrent did not return an event source');
  if (torrent.done) return Promise.resolve(torrent);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', abort);
      if (error) reject(error); else resolve(torrent);
    };
    const abort = () => {
      try { torrent.destroy?.(); } catch { /* best effort */ }
      finish(new Error('acquisition aborted'));
    };
    torrent.on('done', () => finish());
    torrent.on('error', error => finish(error instanceof Error ? error : new Error(String(error))));
    torrent.on('download', () => onProgress?.({ bytes: Number(torrent.downloaded || 0), totalBytes: Number(torrent.length || 0) }));
    signal?.addEventListener?.('abort', abort, { once: true });
  });
}

function torrentFilePath(torrent, root) {
  const files = Array.isArray(torrent.files) ? torrent.files : [];
  if (files.length !== 1) throw new Error('book torrent must contain exactly one file');
  const relative = String(files[0].path || files[0].name || '').replaceAll('\\', '/');
  if (!relative || relative.split('/').includes('..') || relative.startsWith('/')) throw new Error('torrent file path is invalid');
  return safePath(root, relative);
}

function healthScore(health, now = Math.floor(Date.now() / 1000)) {
  if (!health) return 0;
  const cooling = Number(health.cooldownUntil) > now;
  const failures = Number(health.consecutiveFailures) || 0;
  const successes = Number(health.successes) || 0;
  const latency = Number(health.latencyMs) || 0;
  return (cooling ? -10000 : 0) - failures * 100 + successes * 5 - Math.min(1000, latency / 1000);
}

function sourceKey(provider, candidate, recordId) {
  const raw = `${provider}:${candidate.source_id || recordId}`;
  return raw.length <= 256 ? raw : raw.slice(0, 256);
}

class AcquisitionManager {
  constructor({ store, importer, torrentBridge, fetchImpl = globalThis.fetch, stagingRoot, maxAttempts = 3 } = {}) {
    if (!store || !importer || !stagingRoot) throw new TypeError('store, importer, and stagingRoot are required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
    this.store = store;
    this.importer = importer;
    this.torrentBridge = torrentBridge;
    this.fetch = fetchImpl;
    this.stagingRoot = path.resolve(stagingRoot);
    this.maxAttempts = Math.max(1, Math.min(8, Number(maxAttempts) || 3));
  }

  async acquire(record, { format, preferTorrent = true, includeRestricted = false, signal, onProgress } = {}) {
    const { listAcquisitions, normalizeProviderRecord, providerBookFields } = await catalogModule();
    const normalized = normalizeProviderRecord(record);
    const fields = providerBookFields(record);
    const candidates = listAcquisitions(normalized, { format, preferTorrent, includeRestricted });
    if (!candidates.length) throw new Error('no eligible acquisition is available');
    const rankedCandidates = candidates.map((candidate, index) => {
      const source = sourceKey(normalized.provider, candidate, normalized.recordId);
      return { candidate, index, source, score: healthScore(this.store.sourceHealth?.(source)) };
    }).sort((left, right) => right.score - left.score || left.index - right.index);
    this.store.upsertBook(fields);
    await fsp.mkdir(this.stagingRoot, { recursive: true });
    const errors = [];
    const attempts = rankedCandidates.slice(0, this.maxAttempts);
    for (const [index, attempt] of attempts.entries()) {
      const { candidate, source } = attempt;
      this.store.setDownload({ bookId: fields.id, status: 'downloading', bytes: 0, totalBytes: candidate.size, source });
      let stageDir = '';
      const startedAt = Date.now();
      try {
        stageDir = await fsp.mkdtemp(path.join(this.stagingRoot, 'acquisition-'));
        const stagedPath = candidate.torrent
          ? await this.downloadTorrent(candidate, stageDir, { signal, onProgress })
          : await this.downloadHTTP(candidate, stageDir, { signal, onProgress, source });
        const imported = await this.importer.importFile(stagedPath, {
          extension: extensionFor(candidate.format),
          expectedSha256: candidate.sha256 || undefined,
        });
        const book = this.store.upsertBook({ ...fields, sha256: imported.sha256, extension: imported.extension, filesize_bytes: imported.size });
        this.store.registerLibraryFile({ bookId: book.id, relativePath: imported.relativePath, sizeBytes: imported.size, sha256: imported.sha256 });
        this.store.setDownload({ bookId: book.id, status: 'ready', bytes: imported.size, totalBytes: imported.size, source, relativePath: imported.relativePath });
        this.store.recordSourceHealth?.({ source, success: true, latencyMs: Date.now() - startedAt });
        return { book, source, sha256: imported.sha256, size: imported.size, extension: imported.extension };
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        this.store.recordSourceHealth?.({ source, success: false, latencyMs: Date.now() - startedAt });
        this.store.setDownload({ bookId: fields.id, status: index + 1 < attempts.length ? 'retrying' : 'failed', source, error: errors.at(-1).message });
      } finally {
        if (stageDir) await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    throw new AggregateError(errors, 'all eligible acquisitions failed');
  }

  async downloadHTTP(candidate, stageDir, { signal, onProgress, source } = {}) {
    const response = await this.fetch(candidate.url, { signal, redirect: 'error' });
    if (!response?.ok) throw new Error(`source returned HTTP ${response?.status || 0}`);
    const expectedSize = candidate.size || responseLength(response);
    const stagedPath = safePath(stageDir, `download.${extensionFor(candidate.format)}.part`);
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (expectedSize && bytes > expectedSize) return callback(new Error('source exceeded advertised size'));
        onProgress?.({ source, bytes, totalBytes: expectedSize });
        callback(null, chunk);
      },
    });
    await pipeline(await responseStream(response), meter, fs.createWriteStream(stagedPath, { flags: 'wx' }), { signal });
    if (expectedSize && bytes !== expectedSize) throw new Error('source size does not match advertised size');
    return stagedPath;
  }

  async downloadTorrent(candidate, stageDir, { signal, onProgress } = {}) {
    if (!this.torrentBridge) throw new Error('torrent bridge is not configured');
    const torrent = await (candidate.private
      ? this.torrentBridge.addPrivate(candidate.torrent, { path: stageDir })
      : this.torrentBridge.addPublic(candidate.torrent, { path: stageDir }));
    if (Array.isArray(torrent?.files) && torrent.files.length !== 1) throw new Error('book torrent must contain exactly one file');
    await waitForTorrent(torrent, onProgress, signal);
    return torrentFilePath(torrent, stageDir);
  }
}

module.exports = { AcquisitionManager, extensionFor, safePath };
