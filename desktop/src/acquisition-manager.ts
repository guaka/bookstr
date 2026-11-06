import type { Readable as NodeReadable } from 'node:stream';
import { isEnabledReaderFormat, requireEnabledReaderFormat } from './reader-formats';

type Progress = { source?: string; bytes: number; totalBytes: number | null; bookId?: string };
type ProgressCallback = (progress: Progress) => void;
type BookRecord = Record<string, unknown> & {
  id?: string | number; md5?: string; title?: string; authors?: string; author?: string;
  language?: string; year?: string; extension?: string; format?: string; isbn?: string;
  source?: string; source_url?: string; sourceUrl?: string; sourceNativeId?: string | number;
  source_native_id?: string | number; libgenId?: string | number; libgen_id?: string | number;
  filesize?: number; filesize_bytes?: number; size?: number; collection?: string;
  rights_status?: string; rightsStatus?: string; license?: string; license_url?: string;
  licenseUrl?: string; rights_source?: string; rightsSource?: string;
};
type AcquisitionCandidate = import('../shared/catalog/acquisition.mjs').AcquisitionCandidate & {
  url?: string; sha256?: string; format?: string; availability?: string;
  private?: boolean; torrent?: string; size?: number; source_id?: string;
};
type ManagedTorrent = import('./torrent-types').Torrent;
type TorrentBridge = Partial<Pick<InstanceType<typeof import('./webtorrent-bridge').WebTorrentBridge>, 'addPrivate' | 'addPublic' | 'downloadSelected' | 'remove'>>;
type AcquisitionStore = {
  downloads(): Array<BookRecord & { bookId?: string; status?: string; totalBytes?: number; bytes?: number }>;
  getBook(id: string): BookRecord | null;
  upsertBook(book: BookRecord): BookRecord & { id: string };
  setDownload(download: BookRecord & { bookId: string; status: string }): void;
  registerLibraryFile(file: { bookId: string; relativePath: string; sizeBytes: number; sha256: string }): void;
  libraryFile?(id: string): { relativePath?: string; sizeBytes?: number } | null;
  sourceHealth?(source: string): Record<string, unknown> | null;
  recordSourceHealth?(health: { source: string; success: boolean; latencyMs: number }): void;
};
type ImportedFile = { sha256: string; size: number; extension: string; relativePath: string };
type AcquisitionImporter = {
  importFile(filePath: string, options?: { extension?: string; expectedSha256?: string }): Promise<ImportedFile>;
  resolveRelativePath(relativePath: string): string;
};
type AcquisitionResult = { book: BookRecord & { id: string }; source: string; sha256: string; size: number; extension: string };
type AcquisitionJob = { listeners: Set<ProgressCallback>; lastProgress: Progress | null; promise: Promise<AcquisitionResult> | null };
type AcquisitionOptions = {
  store: AcquisitionStore; importer: AcquisitionImporter; torrentBridge?: TorrentBridge;
  fetchImpl?: typeof fetch; stagingRoot: string; maxAttempts?: number; maxBytes?: number;
  trustedOrigins?: Record<string, string[]> | Map<string, string[]>;
  seedResumeIntervalMs?: number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const fs = require('node:fs') as typeof import('node:fs');
const fsp = require('node:fs/promises') as typeof import('node:fs/promises');
const net = require('node:net') as typeof import('node:net');
const path = require('node:path') as typeof import('node:path');
const { Readable, Transform } = require('node:stream') as typeof import('node:stream');
const { pipeline } = require('node:stream/promises') as typeof import('node:stream/promises');

const DEFAULT_MAX_ACQUISITION_BYTES = 512 * 1024 * 1024;
const LIBGEN_TORRENT_METADATA_BASE_URL = 'https://annas-archive.gl/dyn/small_file/torrents/external/libgen_rs_non_fic';
const MAX_TORRENT_METADATA_BYTES = 8 * 1024 * 1024;
const TORRENT_PROGRESS_INTERVAL_MS = 100;

function createProgressThrottle(onProgress?: ProgressCallback, intervalMs = TORRENT_PROGRESS_INTERVAL_MS, {
  now = Date.now,
  schedule = setTimeout,
  unschedule = clearTimeout,
}: { now?: () => number; schedule?: typeof setTimeout; unschedule?: typeof clearTimeout } = {}): { report(progress: Progress): void; flush(): void; cancel(): void } {
  let lastSentAt = -Infinity;
  let pending: Progress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const send = (progress: Progress) => {
    lastSentAt = now();
    onProgress?.(progress);
  };
  const clear = () => {
    if (timer !== null) unschedule(timer);
    timer = null;
  };
  return {
    report(progress) {
      const elapsed = now() - lastSentAt;
      if (elapsed >= intervalMs) {
        clear();
        pending = null;
        send(progress);
        return;
      }
      pending = progress;
      if (timer === null) {
        timer = schedule(() => {
          timer = null;
          if (pending !== null) {
            const latest = pending;
            pending = null;
            send(latest);
          }
        }, Math.max(0, intervalMs - elapsed));
      }
    },
    flush() {
      clear();
      if (pending !== null) {
        const latest = pending;
        pending = null;
        send(latest);
      }
    },
    cancel() {
      clear();
      pending = null;
    },
  };
}

let catalogModulePromise: Promise<typeof import('../shared/catalog/acquisition.mjs')> | undefined;
function catalogModule() {
  catalogModulePromise ||= import('../shared/catalog/acquisition.mjs');
  return catalogModulePromise;
}

function safePath(root: string, value: string): string {
  const candidate = path.resolve(root, value);
  const relative = path.relative(path.resolve(root), candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError('staging path escaped its root');
  }
  return candidate;
}

function extensionFor(format: unknown): string {
  return requireEnabledReaderFormat(format);
}

function responseLength(response: Pick<Response, 'headers'> | null | undefined): number | null {
  const value = response?.headers?.get?.('content-length');
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('source returned an invalid content length');
  return size;
}

function hostFromOrigin(value: unknown): string {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      : '';
  } catch {
    return '';
  }
}

function privateHostname(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host === 'local' || host.endsWith('.local')
    || host === 'internal' || host.endsWith('.internal') || host === 'home.arpa' || host.endsWith('.home.arpa')) return true;
  const kind = net.isIP(host);
  if (kind === 4) {
    const [first, second] = host.split('.').map(Number) as [number, number, number, number];
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

function configuredOrigins(origins: AcquisitionOptions['trustedOrigins'], provider: string | undefined): string[] {
  if (!origins) return [];
  if (origins instanceof Map) return Array.isArray(origins.get(provider!)) ? origins.get(provider!)! : [];
  return Array.isArray(origins[provider!]) ? origins[provider!]! : [];
}

function trustedHosts(provider: string | undefined, descriptor: { homepage?: string } | undefined, origins: AcquisitionOptions['trustedOrigins']): string[] {
  const values = [descriptor?.homepage, ...configuredOrigins(origins, provider)];
  return [...new Set(values.map(hostFromOrigin).filter(Boolean))];
}

function assertTrustedURL(value: unknown, { provider, descriptor, origins, label = 'acquisition URL' }: { provider?: string; descriptor?: { homepage?: string }; origins?: AcquisitionOptions['trustedOrigins']; label?: string } = {}): string {
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

async function responseStream(response: Response, maxBytes = DEFAULT_MAX_ACQUISITION_BYTES): Promise<NodeReadable> {
  if (response?.body && typeof response.body.getReader === 'function') return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  if (response?.body && typeof (response.body as unknown as NodeReadable).pipe === 'function') return response.body as unknown as NodeReadable;
  if (response && typeof response.arrayBuffer === 'function') {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) throw new Error('source exceeded the maximum acquisition size');
    return Readable.from(Buffer.from(bytes));
  }
  throw new Error('acquisition response has no readable body');
}

function waitForTorrent(torrent: ManagedTorrent, onProgress: ProgressCallback | undefined, signal: AbortSignal | undefined, maxBytes: number): Promise<ManagedTorrent> {
  if (!torrent || typeof torrent.on !== 'function') throw new Error('torrent did not return an event source');
  const total = Number(torrent.length || torrent.files?.[0]?.length || 0);
  if (total > maxBytes) throw new Error('torrent exceeds the maximum acquisition size');
  if (torrent.done) return Promise.resolve(torrent);
  return new Promise<ManagedTorrent>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
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

function torrentFilePath(torrent: ManagedTorrent, root: string): string {
  const files = Array.isArray(torrent.files) ? torrent.files : [];
  if (files.length !== 1) throw new Error('book torrent must contain exactly one file');
  const relative = String(files[0]!.path || files[0]!.name || '').replaceAll('\\', '/');
  if (!relative || relative.split('/').includes('..') || relative.startsWith('/')) throw new Error('torrent file path is invalid');
  return safePath(root, relative);
}

function healthScore(health: Record<string, unknown> | null | undefined, now = Math.floor(Date.now() / 1000)): number {
  if (!health) return 0;
  const cooling = Number(health.cooldownUntil) > now;
  const failures = Number(health.consecutiveFailures) || 0;
  const successes = Number(health.successes) || 0;
  const latency = Number(health.latencyMs) || 0;
  return (cooling ? -10000 : 0) - failures * 100 + successes * 5 - Math.min(1000, latency / 1000);
}

function sourceKey(provider: string, candidate: AcquisitionCandidate, recordId: string): string {
  const raw = `${provider}:${candidate.source_id || recordId}`;
  return raw.length <= 256 ? raw : raw.slice(0, 256);
}

async function destroyTorrent(torrentBridge: TorrentBridge | undefined, torrent: ManagedTorrent | undefined): Promise<void> {
  if (!torrent) return;
  if (typeof torrentBridge?.remove === 'function') {
    await torrentBridge.remove(torrent).catch(() => {});
    return;
  }
  try { torrent.destroy?.(); } catch { /* best effort cleanup */ }
}

function libgenCollection(book: BookRecord | null | undefined): string {
  const collection = String(book?.collection || '').toLowerCase();
  if (['nonfiction', 'fiction', 'comics'].includes(collection)) return collection;
  // Older saved jobs did not preserve the catalog collection.
  const sourceURL = String(book?.source_url || book?.sourceUrl || '');
  if (/\/f_\d+\.torrent$/.test(sourceURL)) return 'fiction';
  if (/\/c_\d+\.torrent$/.test(sourceURL) || /^(cbz|cbr)$/i.test(book?.extension || book?.format || '')) return 'comics';
  return 'nonfiction';
}

function libgenTorrentMetadataURL(libgenId: unknown, baseURL = '', collection = 'nonfiction'): string {
  const id = Number(libgenId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('LibGen ID must be a positive integer');
  const batch = Math.floor(id / 1000) * 1000;
  const repositories: Record<string, [string, string]> = {
    nonfiction: [LIBGEN_TORRENT_METADATA_BASE_URL, 'r_'],
    fiction: ['https://annas-archive.gl/dyn/small_file/torrents/external/libgen_rs_fic', 'f_'],
    comics: ['https://annas-archive.gl/dyn/small_file/torrents/external/libgen_li_comics', 'c_'],
  };
  const [repository, prefix] = repositories[collection] || repositories.nonfiction!;
  const batchName = prefix === 'r_' && batch === 0 ? '000' : String(batch);
  return `${String(baseURL || repository).replace(/\/$/, '')}/${prefix}${batchName}.torrent`;
}

class AcquisitionManager {
  declare private readonly store: AcquisitionStore;
  declare private readonly importer: AcquisitionImporter;
  declare private readonly torrentBridge?: TorrentBridge;
  declare private readonly fetch: typeof fetch;
  declare private readonly stagingRoot: string;
  declare private readonly maxAttempts: number;
  declare private readonly maxBytes: number;
  declare private readonly trustedOrigins: AcquisitionOptions['trustedOrigins'];
  declare private readonly seedResumeIntervalMs: number;
  declare private readonly sleep: NonNullable<AcquisitionOptions['sleep']>;
  declare private resumeLibgenSeedsPromise: Promise<{ seeded: number; resumed: number }> | null;
  declare private libgenAcquisitionJobs: Map<string, AcquisitionJob>;
  declare private progressThrottles: Set<ReturnType<typeof createProgressThrottle>>;
  declare private lifecycleControllers: Set<AbortController>;
  declare private closed: boolean;
  declare private closePromise: Promise<void> | null;
  declare private seedResumeController: AbortController | null;

  constructor({ store, importer, torrentBridge, fetchImpl = globalThis.fetch, stagingRoot, maxAttempts = 3, maxBytes = DEFAULT_MAX_ACQUISITION_BYTES, trustedOrigins = {}, seedResumeIntervalMs = 1500, sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal?.addEventListener?.('abort', finish, { once: true });
    if (signal?.aborted) finish();
  }) }: AcquisitionOptions = {} as AcquisitionOptions) {
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
    this.progressThrottles = new Set();
    this.lifecycleControllers = new Set();
    this.closed = false;
    this.closePromise = null;
    this.seedResumeController = null;
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.seedResumeController?.abort(new Error('acquisition manager is closing'));
    for (const controller of this.lifecycleControllers) controller.abort(new Error('acquisition manager is closing'));
    for (const throttle of this.progressThrottles) throttle.cancel();
    this.closePromise = (async () => {
      const jobs = [...this.libgenAcquisitionJobs.values()].map(job => job.promise);
      await Promise.allSettled([...jobs, this.resumeLibgenSeedsPromise].filter(Boolean));
    })();
    return this.closePromise;
  }

  resumeLibgenSeeds({ autoSeed = true }: { autoSeed?: boolean } = {}) {
    if (this.closed) return Promise.resolve({ seeded: 0, resumed: 0 });
    if (this.resumeLibgenSeedsPromise) return this.resumeLibgenSeedsPromise;
    this.seedResumeController = new AbortController();
    this.resumeLibgenSeedsPromise = this.#resumeLibgenSeeds({ autoSeed, signal: this.seedResumeController.signal }).finally(() => {
      this.resumeLibgenSeedsPromise = null;
      this.seedResumeController = null;
    });
    return this.resumeLibgenSeedsPromise;
  }

  async #resumeLibgenSeeds({ autoSeed = true, signal }: { autoSeed?: boolean; signal?: AbortSignal } = {}) {
    if (!this.torrentBridge?.downloadSelected) return { seeded: 0, resumed: 0 };
    const seedRoot = path.join(this.stagingRoot, 'libgen-seeds');
    let seeded = 0;
    let resumed = 0;
    let started = 0;
    for (const download of this.store.downloads()) {
      if (this.closed || signal?.aborted) break;
      const status = String(download?.status).toLowerCase();
      if (String(download?.source).toLowerCase() !== 'torrent') continue;
      const md5 = String(download.bookId || '').trim().toLowerCase();
      const book = this.store.getBook(md5);
      const libgenId = Number(book?.source_native_id || book?.sourceNativeId || 0);
      if (!/^[a-f0-9]{32}$/.test(md5) || !Number.isSafeInteger(libgenId) || libgenId <= 0) continue;
      if (['queued', 'finding-peers', 'downloading', 'retrying'].includes(status)) {
        if (started > 0 && this.seedResumeIntervalMs > 0) await this.sleep(this.seedResumeIntervalMs, signal);
        if (this.closed || signal?.aborted) break;
        started += 1;
        resumed += 1;
        void this.acquireLibgen({
          ...book,
          id: libgenId,
          libgenId,
          filesize_bytes: Number(download.totalBytes || book?.filesize_bytes || 0),
        }, { autoSeed }).catch(() => {
          // The persisted failure is enough; another view can retry explicitly.
        });
        continue;
      }
      if (status !== 'ready' || !autoSeed) continue;
      const batch = Math.floor(libgenId / 1000) * 1000;
      const seedCandidates = [
        path.join(seedRoot, String(batch), md5),
        path.join(seedRoot, path.basename(libgenTorrentMetadataURL(libgenId, '', libgenCollection(book)), '.torrent'), md5),
      ];
      let seedFile = '';
      let stats = null;
      for (const candidate of seedCandidates) {
        if (this.closed || signal?.aborted) break;
        const candidateStats = await fsp.stat(candidate).catch(() => null);
        if (candidateStats?.isFile() && candidateStats.size > 0) {
          seedFile = candidate;
          stats = candidateStats;
          break;
        }
      }
      if (!seedFile) {
        if (this.closed || signal?.aborted) break;
        try {
          const registration = this.store.libraryFile?.(md5);
          if (registration?.relativePath) {
            const libraryFile = this.importer.resolveRelativePath(registration.relativePath);
            const libraryStats = await fsp.stat(libraryFile).catch(() => null);
            if (this.closed || signal?.aborted) break;
            const expectedSize = Math.max(0, Number(download.totalBytes || download.bytes || registration.sizeBytes || 0));
            if (libraryStats?.isFile() && libraryStats.size > 0 && (!expectedSize || libraryStats.size === expectedSize)) {
              seedFile = seedCandidates[0]!;
              await fsp.mkdir(path.dirname(seedFile), { recursive: true });
              await fsp.link(libraryFile, seedFile);
              stats = await fsp.stat(seedFile).catch(() => null);
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === 'EXDEV' && seedFile) {
            const registration = this.store.libraryFile?.(md5);
            const libraryFile = registration?.relativePath
              ? this.importer.resolveRelativePath(registration.relativePath)
              : '';
            if (libraryFile) await fsp.copyFile(libraryFile, seedFile, fs.constants.COPYFILE_EXCL).catch(() => {});
            stats = await fsp.stat(seedFile).catch(() => null);
          } else if ((error as NodeJS.ErrnoException)?.code === 'EEXIST' && seedFile) {
            stats = await fsp.stat(seedFile).catch(() => null);
          }
        }
      }
      if (!stats?.isFile() || stats.size <= 0) continue;
      try {
        if (started > 0 && this.seedResumeIntervalMs > 0) await this.sleep(this.seedResumeIntervalMs, signal);
        if (this.closed || signal?.aborted) break;
        started += 1;
        const metadataURL = libgenTorrentMetadataURL(libgenId, '', libgenCollection(book));
        const response = await this.fetch(metadataURL, { signal, redirect: 'error' });
        if (this.closed || signal?.aborted) break;
        if (!response?.ok) continue;
        const metadata = Buffer.from(await response.arrayBuffer());
        if (this.closed || signal?.aborted) break;
        if (!metadata.length || metadata.length > MAX_TORRENT_METADATA_BYTES || metadata[0] !== 0x64) continue;
        const selected = await this.torrentBridge.downloadSelected(metadata, {
          path: seedRoot,
          fileName: md5,
          bookId: md5,
          signal,
          maxBytes: this.maxBytes,
        });
        if (this.closed || signal?.aborted) {
          await destroyTorrent(this.torrentBridge, selected.torrent);
          break;
        }
        selected.torrent.bookstrBookId = md5;
        selected.torrent.bookstrSeedingBookIds ||= new Set();
        selected.torrent.bookstrSeedingBookIds.add(md5);
        seeded += 1;
      } catch {
        // The imported library copy remains readable even if its seed cannot resume.
      }
    }
    return { seeded, resumed };
  }

  async acquireLibgen(book: BookRecord, { signal, onProgress, autoSeed = true }: { signal?: AbortSignal; onProgress?: ProgressCallback; autoSeed?: boolean } = {}): Promise<AcquisitionResult> {
    if (this.closed) throw new Error('acquisition manager is closed');
    const md5 = String(book?.md5 || '').trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(md5)) throw new TypeError('LibGen torrent acquisition requires an MD5 record identifier');
    let job = this.libgenAcquisitionJobs.get(md5);
    if (!job) {
      job = { listeners: new Set(), lastProgress: null, promise: null };
      job.promise = this.runLibgenAcquisition(book, {
        signal,
        autoSeed,
        onProgress: progress => {
          job!.lastProgress = progress;
          for (const listener of job!.listeners) {
            try { listener(progress); } catch { /* a closed view must not stop the download */ }
          }
        },
      }).finally(() => {
        if (this.libgenAcquisitionJobs.get(md5) === job) this.libgenAcquisitionJobs.delete(md5);
      });
      this.libgenAcquisitionJobs.set(md5, job);
    }
    if (typeof onProgress === 'function') {
      job!.listeners.add(onProgress);
      if (job.lastProgress) queueMicrotask(() => {
        try { onProgress(job!.lastProgress!); } catch { /* best effort progress replay */ }
      });
    }
    try {
      return await job.promise!;
    } finally {
      if (typeof onProgress === 'function') job!.listeners.delete(onProgress);
    }
  }

  async runLibgenAcquisition(book: BookRecord, { signal, onProgress, autoSeed = true }: { signal?: AbortSignal; onProgress?: ProgressCallback; autoSeed?: boolean } = {}): Promise<AcquisitionResult> {
    if (this.closed) throw new Error('acquisition manager is closed');
    if (!this.torrentBridge?.downloadSelected) throw new Error('torrent bridge is not configured');
    const md5 = String(book?.md5 || '').trim().toLowerCase();
    const libgenId = Number(book?.libgenId || book?.libgen_id || book?.id);
    const extension = extensionFor(book?.extension || book?.format);
    const metadataURL = libgenTorrentMetadataURL(libgenId, '', libgenCollection(book));
    const expectedSize = Number(book?.filesize_bytes || book?.filesize || book?.size || 0);
    if (expectedSize && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > this.maxBytes)) {
      throw new Error('catalog file size is invalid or exceeds the maximum acquisition size');
    }
    const lifecycleController = new AbortController();
    this.lifecycleControllers.add(lifecycleController);
    const abortFromCaller = () => lifecycleController.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener?.('abort', abortFromCaller, { once: true });
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
    const progressThrottle = createProgressThrottle(progress => {
      this.store.setDownload({ bookId: md5, status: 'downloading', bytes: progress.bytes, totalBytes: progress.totalBytes, source: 'torrent' });
      onProgress?.({ bookId: md5, source: 'torrent', ...progress });
    });
    this.progressThrottles.add(progressThrottle);
    try {
      const response = await this.fetch(metadataURL, { signal: lifecycleController.signal, redirect: 'error' });
      if (this.closed || lifecycleController.signal.aborted) throw lifecycleController.signal.reason || new Error('acquisition manager is closing');
      if (!response?.ok) throw new Error(`torrent metadata returned HTTP ${response?.status || 0}`);
      const declaredLength = responseLength(response);
      if (declaredLength !== null && declaredLength > MAX_TORRENT_METADATA_BYTES) throw new Error('torrent metadata is too large');
      const metadata = Buffer.from(await response.arrayBuffer());
      if (this.closed || lifecycleController.signal.aborted) throw lifecycleController.signal.reason || new Error('acquisition manager is closing');
      if (!metadata.length || metadata.length > MAX_TORRENT_METADATA_BYTES || metadata[0] !== 0x64) {
        throw new Error('torrent metadata is invalid');
      }
      const selected = await this.torrentBridge.downloadSelected(metadata, {
        path: stageDir,
        fileName: md5,
        bookId: md5,
        signal: lifecycleController.signal,
        maxBytes: this.maxBytes,
        onProgress: progress => progressThrottle.report(progress),
      });
      progressThrottle.flush();
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
      progressThrottle.cancel();
      if (!this.closed) {
        this.store.setDownload({ bookId: md5, status: 'failed', source: 'torrent', error: (error as Error)?.message || String(error) });
      }
      throw error;
    } finally {
      signal?.removeEventListener?.('abort', abortFromCaller);
      this.lifecycleControllers.delete(lifecycleController);
      progressThrottle.cancel();
      this.progressThrottles.delete(progressThrottle);
      if (!keepSeeding) {
        await destroyTorrent(this.torrentBridge, torrent);
        if (!autoSeed) await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async acquire(record: unknown, { format, preferTorrent = true, includeRestricted = false, allowUnverifiedOpen = false, signal, onProgress }: { format?: string; preferTorrent?: boolean; includeRestricted?: boolean; allowUnverifiedOpen?: boolean; signal?: AbortSignal; onProgress?: ProgressCallback } = {}): Promise<AcquisitionResult> {
    const { listAcquisitions, normalizeProviderRecord, providerBookFields } = await catalogModule();
    const normalized = normalizeProviderRecord(record);
    const fields = providerBookFields(record);
    const candidates = listAcquisitions(normalized, { format, preferTorrent, includeRestricted })
      .filter(candidate => isEnabledReaderFormat(candidate.format))
      // Private torrents require an authenticated peer handoff. Until that
      // exists, do not attempt them as ordinary catalog acquisitions.
      .filter(candidate => !candidate.private && (
        /^[a-f0-9]{64}$/i.test(candidate.sha256!)
        || (allowUnverifiedOpen && candidate.availability === 'open' && candidate.url && !candidate.torrent)
      ));
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
            allowMissingSize: allowUnverifiedOpen && !candidate.sha256,
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
        this.store.setDownload({ bookId: fields.id, status: index + 1 < attempts.length ? 'retrying' : 'failed', source, error: errors.at(-1)!.message });
      } finally {
        if (stageDir) await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    throw new AggregateError(errors, 'all eligible acquisitions failed');
  }

  async downloadHTTP(candidate: AcquisitionCandidate, stageDir: string, { signal, onProgress, source, provider, descriptor, allowMissingSize = false }: { signal?: AbortSignal; onProgress?: ProgressCallback; source?: string; provider?: string; descriptor?: { homepage?: string }; allowMissingSize?: boolean } = {}) {
    const url = assertTrustedURL(candidate.url, {
      provider,
      descriptor,
      origins: this.trustedOrigins,
    });
    const metadataSize = Number(candidate.size);
    if (!Number.isSafeInteger(metadataSize) || (metadataSize <= 0 && !allowMissingSize)) throw new Error('source must advertise a positive file size');
    if (metadataSize > this.maxBytes) throw new Error('source exceeds the maximum acquisition size');
    const response = await this.fetch(url, { signal, redirect: 'error' });
    if (!response?.ok) throw new Error(`source returned HTTP ${response?.status || 0}`);
    const headerSize = responseLength(response);
    if (headerSize !== null && headerSize > this.maxBytes) throw new Error('source exceeds the maximum acquisition size');
    if (headerSize !== null && metadataSize > 0 && headerSize !== metadataSize) throw new Error('source size does not match metadata');
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

  async downloadTorrent(candidate: AcquisitionCandidate, stageDir: string, { signal, onProgress }: { signal?: AbortSignal; onProgress?: ProgressCallback } = {}) {
    if (!this.torrentBridge) throw new Error('torrent bridge is not configured');
    const torrent = await (candidate.private
      ? this.torrentBridge.addPrivate!(candidate.torrent!, { path: stageDir })
      : this.torrentBridge.addPublic!(candidate.torrent!, { path: stageDir }));
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

export {
  AcquisitionManager,
  DEFAULT_MAX_ACQUISITION_BYTES,
  assertTrustedURL,
  extensionFor,
  privateHostname,
  safePath,
  createProgressThrottle,
  libgenTorrentMetadataURL,
  libgenCollection,
  LIBGEN_TORRENT_METADATA_BASE_URL,
};
