'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DEFAULT_MAX_ACQUISITION_BYTES = 512 * 1024 * 1024;
const LIBGEN_TORRENT_METADATA_BASE_URL = 'https://annas-archive.gl/dyn/small_file/torrents/external/libgen_rs_non_fic';
const MAX_TORRENT_METADATA_BYTES = 8 * 1024 * 1024;

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
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('source returned an invalid content length');
  return size;
}

function hostFromOrigin(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      : '';
  } catch {
    return '';
  }
}

function privateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host === 'local' || host.endsWith('.local')
    || host === 'internal' || host.endsWith('.internal') || host === 'home.arpa' || host.endsWith('.home.arpa')) return true;
  const kind = net.isIP(host);
  if (kind === 4) {
    const [first, second] = host.split('.').map(Number);
    return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 0) || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19)) || first >= 224;
  }
  if (kind === 6) {
    return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd')
      || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')
      || host.startsWith('ff');
  }
  return false;
}

function configuredOrigins(origins, provider) {
  if (!origins) return [];
  if (origins instanceof Map) return Array.isArray(origins.get(provider)) ? origins.get(provider) : [];
  return Array.isArray(origins[provider]) ? origins[provider] : [];
}

function trustedHosts(provider, descriptor, origins) {
  const values = [descriptor?.homepage, ...configuredOrigins(origins, provider)];
  return [...new Set(values.map(hostFromOrigin).filter(Boolean))];
}

function assertTrustedURL(value, { provider, descriptor, origins, label = 'acquisition URL' } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${label} must use an HTTPS trusted origin`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (privateHostname(host)) throw new Error(`${label} targets a private or loopback host`);
  const allowed = trustedHosts(provider, descriptor, origins);
  if (!allowed.some(origin => host === origin || host.endsWith(`.${origin}`))) {
    throw new Error(`${label} is outside the trusted ${provider} origins`);
  }
  return parsed.href;
}

async function responseStream(response, maxBytes = DEFAULT_MAX_ACQUISITION_BYTES) {
  if (response?.body && typeof response.body.getReader === 'function') return Readable.fromWeb(response.body);
  if (response?.body && typeof response.body.pipe === 'function') return response.body;
  if (response && typeof response.arrayBuffer === 'function') {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) throw new Error('source exceeded the maximum acquisition size');
    return Readable.from(Buffer.from(bytes));
  }
  throw new Error('acquisition response has no readable body');
}

function waitForTorrent(torrent, onProgress, signal, maxBytes) {
  if (!torrent || typeof torrent.on !== 'function') throw new Error('torrent did not return an event source');
  const total = Number(torrent.length || torrent.files?.[0]?.length || 0);
  if (total > maxBytes) throw new Error('torrent exceeds the maximum acquisition size');
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
    torrent.on('download', () => {
      const bytes = Math.max(0, Number(torrent.downloaded || 0));
      if (bytes > maxBytes) return finish(new Error('torrent exceeded the maximum acquisition size'));
      onProgress?.({ bytes, totalBytes: Math.max(0, Number(torrent.length || 0)) });
    });
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

async function destroyTorrent(torrentBridge, torrent) {
  if (!torrent) return;
  if (typeof torrentBridge?.remove === 'function') {
    await torrentBridge.remove(torrent).catch(() => {});
    return;
  }
  try { torrent.destroy?.(); } catch { /* best effort cleanup */ }
}

function libgenTorrentMetadataURL(libgenId, baseURL = LIBGEN_TORRENT_METADATA_BASE_URL) {
  const id = Number(libgenId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('LibGen ID must be a positive integer');
  const batch = Math.floor(id / 1000) * 1000;
  return `${String(baseURL).replace(/\/$/, '')}/r_${batch}.torrent`;
}

class AcquisitionManager {
  constructor({ store, importer, torrentBridge, fetchImpl = globalThis.fetch, stagingRoot, maxAttempts = 3, maxBytes = DEFAULT_MAX_ACQUISITION_BYTES, trustedOrigins = {}, seedResumeIntervalMs = 1500, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (!store || !importer || !stagingRoot) throw new TypeError('store, importer, and stagingRoot are required');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
    this.store = store;
    this.importer = importer;
    this.torrentBridge = torrentBridge;
    this.fetch = fetchImpl;
    this.stagingRoot = path.resolve(stagingRoot);
    this.maxAttempts = Math.max(1, Math.min(8, Number(maxAttempts) || 3));
    this.maxBytes = Number.isSafeInteger(Number(maxBytes)) && Number(maxBytes) > 0
      ? Number(maxBytes)
      : DEFAULT_MAX_ACQUISITION_BYTES;
    this.trustedOrigins = trustedOrigins;
    this.seedResumeIntervalMs = Math.max(0, Math.min(30_000, Number(seedResumeIntervalMs) || 0));
    this.sleep = sleep;
    this.resumeLibgenSeedsPromise = null;
    this.libgenAcquisitionJobs = new Map();
  }

  resumeLibgenSeeds() {
    if (this.resumeLibgenSeedsPromise) return this.resumeLibgenSeedsPromise;
    this.resumeLibgenSeedsPromise = this.#resumeLibgenSeeds().finally(() => {
      this.resumeLibgenSeedsPromise = null;
    });
    return this.resumeLibgenSeedsPromise;
  }

  async #resumeLibgenSeeds() {
    if (!this.torrentBridge?.downloadSelected) return { seeded: 0 };
    const seedRoot = path.join(this.stagingRoot, 'libgen-seeds');
    let seeded = 0;
    for (const download of this.store.downloads()) {
      if (String(download?.status).toLowerCase() !== 'ready' || String(download?.source).toLowerCase() !== 'torrent') continue;
      const md5 = String(download.bookId || '').trim().toLowerCase();
      const book = this.store.getBook(md5);
      const libgenId = Number(book?.source_native_id || book?.sourceNativeId || 0);
      if (!/^[a-f0-9]{32}$/.test(md5) || !Number.isSafeInteger(libgenId) || libgenId <= 0) continue;
      const batch = Math.floor(libgenId / 1000) * 1000;
      const seedFile = path.join(seedRoot, `r_${batch}`, md5);
      const stats = await fsp.stat(seedFile).catch(() => null);
      if (!stats?.isFile() || stats.size <= 0) continue;
      try {
        if (seeded > 0 && this.seedResumeIntervalMs > 0) {
          await this.sleep(this.seedResumeIntervalMs);
        }
        const metadataURL = libgenTorrentMetadataURL(libgenId);
        const response = await this.fetch(metadataURL, { redirect: 'error' });
        if (!response?.ok) continue;
        const metadata = Buffer.from(await response.arrayBuffer());
        if (!metadata.length || metadata.length > MAX_TORRENT_METADATA_BYTES || metadata[0] !== 0x64) continue;
        const selected = await this.torrentBridge.downloadSelected(metadata, {
          path: seedRoot,
          fileName: md5,
          bookId: md5,
          maxBytes: this.maxBytes,
        });
        selected.torrent.bookstrBookId = md5;
        selected.torrent.bookstrSeedingBookIds ||= new Set();
        selected.torrent.bookstrSeedingBookIds.add(md5);
        seeded += 1;
      } catch {
        // The imported library copy remains readable even if its seed cannot resume.
      }
    }
    return { seeded };
  }

  async acquireLibgen(book, { signal, onProgress, autoSeed = true } = {}) {
    const md5 = String(book?.md5 || '').trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(md5)) throw new TypeError('LibGen torrent acquisition requires an MD5 record identifier');
    let job = this.libgenAcquisitionJobs.get(md5);
    if (!job) {
      job = { listeners: new Set(), lastProgress: null, promise: null };
      job.promise = this.runLibgenAcquisition(book, {
        signal,
        autoSeed,
        onProgress: progress => {
          job.lastProgress = progress;
          for (const listener of job.listeners) {
            try { listener(progress); } catch { /* a closed view must not stop the download */ }
          }
        },
      }).finally(() => {
        if (this.libgenAcquisitionJobs.get(md5) === job) this.libgenAcquisitionJobs.delete(md5);
      });
      this.libgenAcquisitionJobs.set(md5, job);
    }
    if (typeof onProgress === 'function') {
      job.listeners.add(onProgress);
      if (job.lastProgress) queueMicrotask(() => {
        try { onProgress(job.lastProgress); } catch { /* best effort progress replay */ }
      });
    }
    try {
      return await job.promise;
    } finally {
      if (typeof onProgress === 'function') job.listeners.delete(onProgress);
    }
  }

  async runLibgenAcquisition(book, { signal, onProgress, autoSeed = true } = {}) {
    if (!this.torrentBridge?.downloadSelected) throw new Error('torrent bridge is not configured');
    const md5 = String(book?.md5 || '').trim().toLowerCase();
    const libgenId = Number(book?.libgenId || book?.libgen_id || book?.id);
    const extension = extensionFor(book?.extension || book?.format);
    const metadataURL = libgenTorrentMetadataURL(libgenId);
    const expectedSize = Number(book?.filesize_bytes || book?.filesize || book?.size || 0);
    if (expectedSize && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > this.maxBytes)) {
      throw new Error('catalog file size is invalid or exceeds the maximum acquisition size');
    }
    const fields = {
      id: md5,
      md5,
      title: String(book?.title || ''),
      authors: String(book?.authors || book?.author || ''),
      language: String(book?.language || ''),
      year: String(book?.year || ''),
      extension,
      isbn: String(book?.isbn || ''),
      source: String(book?.source || 'libvault'),
      sourceNativeId: String(libgenId),
      sourceUrl: metadataURL,
      rights_status: String(book?.rights_status || book?.rightsStatus || 'unknown'),
      license: String(book?.license || ''),
      license_url: String(book?.license_url || book?.licenseUrl || ''),
      rights_source: String(book?.rights_source || book?.rightsSource || ''),
      filesize_bytes: expectedSize,
    };
    this.store.upsertBook(fields);
    this.store.setDownload({ bookId: md5, status: 'finding-peers', bytes: 0, totalBytes: expectedSize, source: 'torrent' });
    await fsp.mkdir(this.stagingRoot, { recursive: true });
    const persistentSeedRoot = path.join(this.stagingRoot, 'libgen-seeds');
    const stageDir = autoSeed
      ? persistentSeedRoot
      : await fsp.mkdtemp(path.join(this.stagingRoot, 'libgen-download-'));
    await fsp.mkdir(stageDir, { recursive: true });
    let torrent;
    let keepSeeding = false;
    try {
      const response = await this.fetch(metadataURL, { signal, redirect: 'error' });
      if (!response?.ok) throw new Error(`torrent metadata returned HTTP ${response?.status || 0}`);
      const declaredLength = responseLength(response);
      if (declaredLength !== null && declaredLength > MAX_TORRENT_METADATA_BYTES) throw new Error('torrent metadata is too large');
      const metadata = Buffer.from(await response.arrayBuffer());
      if (!metadata.length || metadata.length > MAX_TORRENT_METADATA_BYTES || metadata[0] !== 0x64) {
        throw new Error('torrent metadata is invalid');
      }
      const selected = await this.torrentBridge.downloadSelected(metadata, {
        path: stageDir,
        fileName: md5,
        bookId: md5,
        signal,
        maxBytes: this.maxBytes,
        onProgress: progress => {
          this.store.setDownload({ bookId: md5, status: 'downloading', bytes: progress.bytes, totalBytes: progress.totalBytes, source: 'torrent' });
          onProgress?.({ bookId: md5, source: 'torrent', ...progress });
        },
      });
      torrent = selected.torrent;
      const stats = await fsp.stat(selected.filePath);
      if (!stats.isFile() || stats.size <= 0 || stats.size > this.maxBytes) throw new Error('downloaded torrent file is invalid');
      if (expectedSize && stats.size !== expectedSize) throw new Error('torrent file size does not match the catalog');
      const imported = await this.importer.importFile(selected.filePath, { extension });
      const storedBook = this.store.upsertBook({ ...fields, sha256: imported.sha256, filesize_bytes: imported.size });
      this.store.registerLibraryFile({ bookId: md5, relativePath: imported.relativePath, sizeBytes: imported.size, sha256: imported.sha256 });
      this.store.setDownload({ bookId: md5, status: 'ready', bytes: imported.size, totalBytes: imported.size, source: 'torrent', relativePath: imported.relativePath });
      if (autoSeed) {
        torrent.bookstrBookId = md5;
        torrent.bookstrSeedingBookIds ||= new Set();
        torrent.bookstrSeedingBookIds.add(md5);
        keepSeeding = true;
      }
      return { book: storedBook, source: 'torrent', sha256: imported.sha256, size: imported.size, extension: imported.extension };
    } catch (error) {
      this.store.setDownload({ bookId: md5, status: 'failed', source: 'torrent', error: error?.message || String(error) });
      throw error;
    } finally {
      if (!keepSeeding) {
        await destroyTorrent(this.torrentBridge, torrent);
        await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async acquire(record, { format, preferTorrent = true, includeRestricted = false, signal, onProgress } = {}) {
    const { listAcquisitions, normalizeProviderRecord, providerBookFields } = await catalogModule();
    const normalized = normalizeProviderRecord(record);
    const fields = providerBookFields(record);
    const candidates = listAcquisitions(normalized, { format, preferTorrent, includeRestricted })
      // Private torrents require an authenticated peer handoff. Until that
      // exists, do not attempt them as ordinary catalog acquisitions.
      .filter(candidate => !candidate.private && /^[a-f0-9]{64}$/i.test(candidate.sha256));
    if (!candidates.length) throw new Error('no eligible acquisition with a verified SHA-256 is available');
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
        const descriptor = normalized.providerDescriptor;
        if (candidate.torrent && /^https?:/i.test(candidate.torrent)) {
          assertTrustedURL(candidate.torrent, {
            provider: normalized.provider,
            descriptor,
            origins: this.trustedOrigins,
            label: 'torrent URL',
          });
        }
        const stagedPath = candidate.torrent
          ? await this.downloadTorrent(candidate, stageDir, { signal, onProgress })
          : await this.downloadHTTP(candidate, stageDir, {
            signal,
            onProgress,
            source,
            provider: normalized.provider,
            descriptor,
          });
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

  async downloadHTTP(candidate, stageDir, { signal, onProgress, source, provider, descriptor } = {}) {
    const url = assertTrustedURL(candidate.url, {
      provider,
      descriptor,
      origins: this.trustedOrigins,
    });
    const metadataSize = Number(candidate.size);
    if (!Number.isSafeInteger(metadataSize) || metadataSize <= 0) throw new Error('source must advertise a positive file size');
    if (metadataSize > this.maxBytes) throw new Error('source exceeds the maximum acquisition size');
    const response = await this.fetch(url, { signal, redirect: 'error' });
    if (!response?.ok) throw new Error(`source returned HTTP ${response?.status || 0}`);
    const headerSize = responseLength(response);
    if (headerSize !== null && headerSize > this.maxBytes) throw new Error('source exceeds the maximum acquisition size');
    if (headerSize !== null && headerSize !== metadataSize) throw new Error('source size does not match metadata');
    const expectedSize = metadataSize || headerSize;
    if (!expectedSize) throw new Error('source did not advertise a file size');
    const maxBytes = this.maxBytes;
    const stagedPath = safePath(stageDir, `download.${extensionFor(candidate.format)}.part`);
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) return callback(new Error('source exceeded the maximum acquisition size'));
        if (expectedSize && bytes > expectedSize) return callback(new Error('source exceeded advertised size'));
        onProgress?.({ source, bytes, totalBytes: expectedSize });
        callback(null, chunk);
      },
    });
    await pipeline(await responseStream(response, maxBytes), meter, fs.createWriteStream(stagedPath, { flags: 'wx' }), { signal });
    if (bytes !== expectedSize) throw new Error('source size does not match advertised size');
    return stagedPath;
  }

  async downloadTorrent(candidate, stageDir, { signal, onProgress } = {}) {
    if (!this.torrentBridge) throw new Error('torrent bridge is not configured');
    const torrent = await (candidate.private
      ? this.torrentBridge.addPrivate(candidate.torrent, { path: stageDir })
      : this.torrentBridge.addPublic(candidate.torrent, { path: stageDir }));
    try {
      if (Array.isArray(torrent?.files) && torrent.files.length !== 1) throw new Error('book torrent must contain exactly one file');
      await waitForTorrent(torrent, onProgress, signal, this.maxBytes);
      const stagedPath = torrentFilePath(torrent, stageDir);
      const stats = await fsp.stat(stagedPath);
      if (!stats.isFile() || stats.size <= 0 || stats.size > this.maxBytes) {
        throw new Error('torrent file exceeds the maximum acquisition size');
      }
      if (Number(candidate.size) > 0 && stats.size !== Number(candidate.size)) {
        throw new Error('torrent file size does not match metadata');
      }
      return stagedPath;
    } catch (error) {
      // A torrent owns its peer connections and partially downloaded files;
      // every rejection path must release it before the staging directory is
      // removed by acquire().
      await destroyTorrent(this.torrentBridge, torrent);
      throw error;
    }
  }
}

module.exports = {
  AcquisitionManager,
  DEFAULT_MAX_ACQUISITION_BYTES,
  assertTrustedURL,
  extensionFor,
  privateHostname,
  safePath,
  libgenTorrentMetadataURL,
  LIBGEN_TORRENT_METADATA_BASE_URL,
};
