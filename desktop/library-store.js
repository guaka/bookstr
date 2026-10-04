'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const MAX_SEARCH_LIMIT = 100;

function text(value) {
  return String(value ?? '').trim();
}

function safeID(value) {
  const id = text(value);
  if (!id || id.length > 256 || /[\u0000-\u001f]/.test(id)) throw new TypeError('book id is invalid');
  return id;
}

function safeRelativePath(value) {
  const relative = text(value).replaceAll('\\', '/');
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..') || /[\u0000-\u001f]/.test(relative)) {
    throw new TypeError('relative path is invalid');
  }
  return relative;
}

function searchTokens(value) {
  return text(value).match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) || [];
}

function redistributionFor(book, status) {
  const explicit = text(book.redistribution || book.redistribution_policy).toLowerCase().replace(/[ -]+/g, '_');
  if (['allowed', 'noncommercial', 'forbidden', 'unknown'].includes(explicit)) return explicit;
  const evidence = `${text(book.license)} ${text(book.license_url || book.licenseUrl)}`.toLowerCase();
  if (/forbidden|no redistribution|do not redistribute|all rights reserved/.test(evidence)) return 'forbidden';
  if (/noncommercial|non-commercial|\b(?:cc[- ]?by[- ]?nc|cc[- ]?nc)\b|\/by-nc(?:[-/]|\b)/.test(evidence)) return 'noncommercial';
  if (status === 'public_domain' || status === 'open_license') return 'allowed';
  return 'unknown';
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL DEFAULT '',
  md5 TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  authors TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  extension TEXT NOT NULL DEFAULT '',
  isbn TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  source_native_id TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  rights_status TEXT NOT NULL DEFAULT 'unknown',
  license TEXT NOT NULL DEFAULT '',
  license_url TEXT NOT NULL DEFAULT '',
  rights_source TEXT NOT NULL DEFAULT '',
  jurisdiction TEXT NOT NULL DEFAULT '',
  redistribution TEXT NOT NULL DEFAULT 'unknown',
  evidence_url TEXT NOT NULL DEFAULT '',
  attribution TEXT NOT NULL DEFAULT '',
  public_seed_allowed INTEGER NOT NULL DEFAULT 0,
  filesize_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
  title, authors, language, isbn,
  content='books', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS books_fts_ai AFTER INSERT ON books BEGIN
  INSERT INTO books_fts(rowid, title, authors, language, isbn)
  VALUES (new.rowid, new.title, new.authors, new.language, new.isbn);
END;
CREATE TRIGGER IF NOT EXISTS books_fts_ad AFTER DELETE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, authors, language, isbn)
  VALUES ('delete', old.rowid, old.title, old.authors, old.language, old.isbn);
END;
CREATE TRIGGER IF NOT EXISTS books_fts_au AFTER UPDATE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, authors, language, isbn)
  VALUES ('delete', old.rowid, old.title, old.authors, old.language, old.isbn);
  INSERT INTO books_fts(rowid, title, authors, language, isbn)
  VALUES (new.rowid, new.title, new.authors, new.language, new.isbn);
END;
CREATE TABLE IF NOT EXISTS downloads (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  relative_path TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS library_files (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  relative_path TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  mod_time_unix INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS linked_folders (
  id TEXT PRIMARY KEY,
  relative_path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS source_health (
  source_id TEXT PRIMARY KEY,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER NOT NULL DEFAULT 0,
  last_failure_at INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`;

class LibraryStore {
  constructor({ dbPath, libraryRoot } = {}) {
    if (!dbPath || !libraryRoot) throw new TypeError('dbPath and libraryRoot are required');
    this.dbPath = path.resolve(dbPath);
    this.libraryRoot = path.resolve(libraryRoot);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.mkdirSync(this.libraryRoot, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(SCHEMA);
    for (const [name, definition] of [
      ['jurisdiction', "TEXT NOT NULL DEFAULT ''"],
      ['redistribution', "TEXT NOT NULL DEFAULT 'unknown'"],
      ['evidence_url', "TEXT NOT NULL DEFAULT ''"],
      ['attribution', "TEXT NOT NULL DEFAULT ''"],
      ['public_seed_allowed', 'INTEGER NOT NULL DEFAULT 0'],
    ]) {
      try { this.db.exec(`ALTER TABLE books ADD COLUMN ${name} ${definition}`); } catch { /* already present */ }
    }
    try { this.db.exec("ALTER TABLE downloads ADD COLUMN request_json TEXT NOT NULL DEFAULT ''"); } catch { /* already present */ }
    try { this.db.exec('ALTER TABLE downloads ADD COLUMN completed_at INTEGER'); } catch { /* already present */ }
    this.db.exec("UPDATE downloads SET completed_at = updated_at WHERE completed_at IS NULL AND status IN ('ready', 'seeding')");
    this.readerTokens = new Map();
  }

  upsertBook(book = {}) {
    const id = safeID(book.id || book.bookId || book.md5 || book.sha256);
    const fields = {
      sha256: text(book.sha256), md5: text(book.md5), title: text(book.title),
      authors: text(book.authors || book.author), language: text(book.language), year: text(book.year),
      extension: text(book.extension || book.format), isbn: text(book.isbn), source: text(book.source),
      source_native_id: text(book.sourceNativeId || book.source_native_id), source_url: text(book.sourceUrl || book.source_url),
      rights_status: text(book.rights_status || book.rightsStatus || 'unknown') || 'unknown',
      license: text(book.license), license_url: text(book.license_url || book.licenseUrl),
      rights_source: text(book.rights_source || book.rightsSource),
      jurisdiction: text(book.jurisdiction),
      redistribution: redistributionFor(book, text(book.rights_status || book.rightsStatus || 'unknown') || 'unknown'),
      evidence_url: text(book.evidence_url || book.evidenceUrl), attribution: text(book.attribution),
      public_seed_allowed: 0,
      filesize_bytes: Number.isSafeInteger(Number(book.filesize_bytes || book.size)) ? Number(book.filesize_bytes || book.size) : 0,
    };
    fields.public_seed_allowed = (['public_domain', 'open_license'].includes(fields.rights_status) && fields.redistribution === 'allowed') ? 1 : 0;
    this.db.prepare(`
      INSERT INTO books (id, sha256, md5, title, authors, language, year, extension, isbn, source, source_native_id, source_url, rights_status, license, license_url, rights_source, jurisdiction, redistribution, evidence_url, attribution, public_seed_allowed, filesize_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sha256=excluded.sha256, md5=excluded.md5, title=excluded.title, authors=excluded.authors,
        language=excluded.language, year=excluded.year, extension=excluded.extension, isbn=excluded.isbn,
        source=excluded.source, source_native_id=excluded.source_native_id, source_url=excluded.source_url,
        rights_status=excluded.rights_status, license=excluded.license, license_url=excluded.license_url,
        rights_source=excluded.rights_source, jurisdiction=excluded.jurisdiction, redistribution=excluded.redistribution,
        evidence_url=excluded.evidence_url, attribution=excluded.attribution, public_seed_allowed=excluded.public_seed_allowed,
        filesize_bytes=excluded.filesize_bytes, updated_at=unixepoch()
    `).run(id, ...Object.values(fields));
    return this.getBook(id);
  }

  getBook(id) {
    const row = this.db.prepare(`SELECT id, sha256, md5, title, authors, language, year, extension, isbn, source, source_native_id, source_url, rights_status, license, license_url, rights_source, jurisdiction, redistribution, evidence_url, attribution, public_seed_allowed, filesize_bytes FROM books WHERE id = ?`).get(safeID(id));
    return row ? { ...row, public_seed_allowed: Boolean(row.public_seed_allowed) } : null;
  }

  search({ query = '', language = '', limit = 25, offset = 0 } = {}) {
    const tokens = searchTokens(query);
    if (!tokens.length) return { total: 0, books: [] };
    const safeLimit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Number(limit) || 25));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const hasCJK = tokens.some(token => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(token));
    const args = [];
    const where = [];
    if (hasCJK) {
      for (const token of tokens) {
        where.push('(books.title LIKE ? OR books.authors LIKE ? OR books.language LIKE ? OR books.isbn LIKE ?)');
        args.push(`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`);
      }
    } else {
      where.push('books_fts MATCH ?');
      args.push(tokens.map(token => `"${token.replaceAll('"', '""')}"`).join(' AND '));
    }
    if (text(language)) {
      where.push('LOWER(books.language) = LOWER(?)');
      args.push(text(language));
    }
    const clause = where.join(' AND ');
    const total = this.db.prepare(`SELECT COUNT(*) AS total FROM books_fts JOIN books ON books.rowid = books_fts.rowid WHERE ${clause}`).get(...args).total;
    const rows = this.db.prepare(`SELECT books.id, books.sha256, books.md5, books.title, books.authors, books.language, books.year, books.extension, books.isbn, books.source, books.source_native_id, books.source_url, books.rights_status, books.license, books.license_url, books.rights_source, books.jurisdiction, books.redistribution, books.evidence_url, books.attribution, books.public_seed_allowed, books.filesize_bytes FROM books_fts JOIN books ON books.rowid = books_fts.rowid WHERE ${clause} ORDER BY bm25(books_fts), books.rowid LIMIT ? OFFSET ?`).all(...args, safeLimit, safeOffset);
    return { total: Number(total), books: rows.map(row => ({ ...row, public_seed_allowed: Boolean(row.public_seed_allowed) })) };
  }

  setDownload(download = {}) {
    const bookId = safeID(download.bookId || download.id);
    const status = text(download.status) || 'queued';
    const relativePath = download.relativePath ? safeRelativePath(download.relativePath) : '';
    this.db.prepare(`
      INSERT INTO downloads (book_id, status, bytes, total_bytes, source, relative_path, error, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IN ('ready', 'seeding') THEN unixepoch() ELSE NULL END)
      ON CONFLICT(book_id) DO UPDATE SET status=excluded.status, bytes=excluded.bytes, total_bytes=excluded.total_bytes,
        source=excluded.source, relative_path=excluded.relative_path, error=excluded.error, updated_at=unixepoch(),
        completed_at=CASE WHEN excluded.status IN ('ready', 'seeding') THEN COALESCE(downloads.completed_at, excluded.completed_at) WHEN excluded.status IN ('queued', 'finding-peers', 'downloading', 'retrying') THEN NULL ELSE downloads.completed_at END
    `).run(bookId, status, Math.max(0, Number(download.bytes) || 0), Math.max(0, Number(download.totalBytes || download.total_bytes) || 0), text(download.source), relativePath, text(download.error), status);
    return this.downloads().find(item => item.bookId === bookId) || null;
  }

  saveDownloadRequest(bookId, request) {
    const id = safeID(bookId);
    const json = JSON.stringify(request);
    if (json.length > 16 * 1024) throw new TypeError('download request is too large');
    this.db.prepare('UPDATE downloads SET request_json = ? WHERE book_id = ?').run(json, id);
    return this.downloadRequest(id);
  }

  downloadRequest(bookId) {
    const row = this.db.prepare('SELECT request_json FROM downloads WHERE book_id = ?').get(safeID(bookId));
    if (!row?.request_json) return null;
    try { return JSON.parse(row.request_json); } catch { return null; }
  }

  resumableDownloads() {
    return this.db.prepare("SELECT book_id AS bookId, status, request_json AS requestJson FROM downloads WHERE status IN ('queued', 'finding-peers', 'downloading', 'retrying') AND request_json != '' ORDER BY updated_at ASC").all().map(row => {
      try { return { bookId: row.bookId, status: row.status, request: JSON.parse(row.requestJson) }; }
      catch { return null; }
    }).filter(Boolean);
  }

  downloads() {
    return this.db.prepare(`
      SELECT downloads.book_id AS bookId, downloads.status, downloads.bytes,
        downloads.total_bytes AS totalBytes, downloads.source, downloads.error,
        downloads.request_json != '' AS queuedFromSearch,
        downloads.updated_at AS updatedAt, books.sha256, books.md5,
        downloads.completed_at AS completedAt,
        books.title, books.authors, books.language, books.year, books.extension,
        books.isbn, books.source_native_id AS sourceNativeId
      FROM downloads
      LEFT JOIN books ON books.id = downloads.book_id
      ORDER BY downloads.updated_at DESC
    `).all().map(row => ({ ...row }));
  }

  registerLibraryFile(file = {}) {
    const bookId = safeID(file.bookId || file.id);
    const relativePath = safeRelativePath(file.relativePath);
    this.db.prepare(`
      INSERT INTO library_files (book_id, relative_path, size_bytes, mod_time_unix, sha256)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET book_id=excluded.book_id, size_bytes=excluded.size_bytes,
        mod_time_unix=excluded.mod_time_unix, sha256=excluded.sha256, updated_at=unixepoch()
    `).run(bookId, relativePath, Math.max(0, Number(file.sizeBytes || file.size) || 0), Number(file.modTimeUnix || 0), text(file.sha256));
    return { bookId, sizeBytes: Math.max(0, Number(file.sizeBytes || file.size) || 0) };
  }

  // Internal main-process lookup.  Keep the relative path out of the values
  // returned through the renderer-facing download/library APIs; callers must
  // resolve it against libraryRoot before touching the filesystem.
  libraryFile(bookId) {
    const id = safeID(bookId);
    const row = this.db.prepare(`SELECT book_id AS bookId, relative_path AS relativePath, size_bytes AS sizeBytes, mod_time_unix AS modTimeUnix, sha256 FROM library_files WHERE book_id = ? ORDER BY relative_path LIMIT 1`).get(id);
    return row ? { ...row } : null;
  }

  linkFolder(folder = {}) {
    const relativePath = safeRelativePath(folder.relativePath);
    const id = text(folder.id) || crypto.randomUUID();
    this.db.prepare(`INSERT INTO linked_folders (id, relative_path, label, enabled) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET relative_path=excluded.relative_path, label=excluded.label, enabled=excluded.enabled, updated_at=unixepoch()`).run(id, relativePath, text(folder.label), folder.enabled === false ? 0 : 1);
    return { id, label: text(folder.label), enabled: folder.enabled !== false };
  }

  linkedFolders() {
    return this.db.prepare('SELECT id, label, enabled = 1 AS enabled FROM linked_folders ORDER BY label, id').all().map(row => ({ id: row.id, label: row.label, enabled: Boolean(row.enabled) }));
  }

  sourceHealth(sourceId) {
    const id = safeID(sourceId);
    const row = this.db.prepare('SELECT source_id AS sourceId, successes, failures, consecutive_failures AS consecutiveFailures, last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt, cooldown_until AS cooldownUntil, latency_ms AS latencyMs, updated_at AS updatedAt FROM source_health WHERE source_id = ?').get(id);
    return row ? { ...row } : null;
  }

  sourceHealthAll() {
    return this.db.prepare('SELECT source_id AS sourceId, successes, failures, consecutive_failures AS consecutiveFailures, last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt, cooldown_until AS cooldownUntil, latency_ms AS latencyMs, updated_at AS updatedAt FROM source_health ORDER BY source_id').all().map(row => ({ ...row }));
  }

  recordSourceHealth({ source, success = false, latencyMs = 0, now } = {}) {
    const sourceId = safeID(source);
    const timestamp = Number.isSafeInteger(Number(now)) && Number(now) > 0
      ? Math.floor(Number(now))
      : Math.floor(Date.now() / 1000);
    const latency = Number.isFinite(Number(latencyMs)) && Number(latencyMs) >= 0
      ? Math.min(2_147_483_647, Math.round(Number(latencyMs)))
      : 0;
    const previous = this.sourceHealth(sourceId) || {
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      cooldownUntil: 0,
      latencyMs: 0,
    };
    const ok = success === true;
    const consecutiveFailures = ok ? 0 : previous.consecutiveFailures + 1;
    const cooldownUntil = ok
      ? 0
      : timestamp + Math.min(300, 5 * (2 ** Math.min(6, consecutiveFailures)));
    this.db.prepare(`
      INSERT INTO source_health (source_id, successes, failures, consecutive_failures, last_success_at, last_failure_at, cooldown_until, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET successes=excluded.successes, failures=excluded.failures,
        consecutive_failures=excluded.consecutive_failures, last_success_at=excluded.last_success_at,
        last_failure_at=excluded.last_failure_at, cooldown_until=excluded.cooldown_until,
        latency_ms=excluded.latency_ms, updated_at=unixepoch()
    `).run(
      sourceId,
      previous.successes + (ok ? 1 : 0),
      previous.failures + (ok ? 0 : 1),
      consecutiveFailures,
      ok ? timestamp : previous.lastSuccessAt,
      ok ? previous.lastFailureAt : timestamp,
      cooldownUntil,
      latency,
    );
    return this.sourceHealth(sourceId);
  }

  openReader(bookId) {
    const id = safeID(bookId);
    const book = this.getBook(id);
    if (!book) return null;
    const file = this.db.prepare('SELECT relative_path AS relativePath FROM library_files WHERE book_id = ? ORDER BY relative_path LIMIT 1').get(id);
    if (!file) return { bookId: id, format: book.extension || '', token: '' };
    const token = crypto.randomBytes(24).toString('base64url');
    this.readerTokens.set(token, { relativePath: file.relativePath, bookId: id, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { bookId: id, format: book.extension || '', token };
  }

  resolveReaderToken(token) {
    const entry = this.readerTokens.get(text(token));
    if (!entry || entry.expiresAt < Date.now()) {
      this.readerTokens.delete(text(token));
      return null;
    }
    const candidate = path.resolve(this.libraryRoot, entry.relativePath);
    const relative = path.relative(this.libraryRoot, candidate);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return { ...entry, path: candidate };
  }

  close() {
    this.readerTokens.clear();
    this.db.close();
  }
}

module.exports = { LibraryStore, safeRelativePath };
