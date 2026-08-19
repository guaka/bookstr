import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BookFormat,
  Catalog,
  CatalogBook,
  DictionaryEntry,
  ReadingProgress,
  VocabularyWord,
} from "../types";

type CachedPublication = {
  id: string;
  blob: Blob;
  format: BookFormat;
  cachedAt: number;
};

interface BookstrDB extends DBSchema {
  epubs: {
    key: string;
    value: { id: string; blob: Blob; cachedAt: number };
  };
  progress: {
    key: string;
    value: ReadingProgress;
  };
  settings: {
    key: string;
    value: string;
  };
  dictionary: {
    key: string;
    value: DictionaryEntry;
  };
  vocabulary: {
    key: string;
    value: VocabularyWord;
  };
  publications: {
    key: string;
    value: CachedPublication;
  };
}

let dbPromise: Promise<IDBPDatabase<BookstrDB>> | null = null;
const SETTING_PREFIX = "bookstr.setting.";
const SETTING_READ_TIMEOUT_MS = 1_500;

function localSetting(key: string): string | undefined {
  try {
    return (
      globalThis.localStorage?.getItem(`${SETTING_PREFIX}${key}`) ?? undefined
    );
  } catch {
    return undefined;
  }
}

function cacheLocalSetting(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(`${SETTING_PREFIX}${key}`, value);
  } catch {
    /* IndexedDB remains the fallback when localStorage is unavailable. */
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error("Storage operation timed out")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function db() {
  if (!dbPromise) {
    dbPromise = openDB<BookstrDB>("bookstr", 3, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore("epubs", { keyPath: "id" });
          database.createObjectStore("progress", { keyPath: "bookId" });
          database.createObjectStore("settings");
        }
        if (oldVersion < 2) {
          database.createObjectStore("dictionary", { keyPath: "key" });
          database.createObjectStore("vocabulary", { keyPath: "key" });
        }
        if (oldVersion < 3) {
          database.createObjectStore("publications", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

/** Test-only: close and drop IndexedDB so suites start clean. */
export async function resetCatalogDbForTests(): Promise<void> {
  if (dbPromise) {
    const database = await dbPromise;
    database.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("bookstr");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("deleteDatabase failed"));
    req.onblocked = () => resolve();
  });
  try {
    for (let index = globalThis.localStorage.length - 1; index >= 0; index--) {
      const key = globalThis.localStorage.key(index);
      if (key?.startsWith(SETTING_PREFIX))
        globalThis.localStorage.removeItem(key);
    }
  } catch {
    /* ignore unavailable test storage */
  }
}

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const cached = localSetting(key);
  if (cached !== undefined) return cached;
  try {
    const value = await withTimeout(
      (async () => (await db()).get("settings", key))(),
      SETTING_READ_TIMEOUT_MS,
    );
    if (value !== undefined) cacheLocalSetting(key, value);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  cacheLocalSetting(key, value);
  // Do not let a blocked Firefox IndexedDB transaction freeze signer setup.
  void db()
    .then((database) => database.put("settings", value, key))
    .catch(() => undefined);
}

export async function getProgress(
  bookId: string,
): Promise<ReadingProgress | undefined> {
  return (await db()).get("progress", bookId);
}

export async function saveProgress(progress: ReadingProgress): Promise<void> {
  await (await db()).put("progress", progress);
}

export async function listProgress(): Promise<ReadingProgress[]> {
  return (await db()).getAll("progress");
}

export async function getDictionaryEntry(
  key: string,
): Promise<DictionaryEntry | undefined> {
  return (await db()).get("dictionary", key);
}

export async function saveDictionaryEntry(
  entry: DictionaryEntry,
): Promise<void> {
  await (await db()).put("dictionary", entry);
}

export async function getVocabularyWord(
  key: string,
): Promise<VocabularyWord | undefined> {
  return (await db()).get("vocabulary", key);
}

export async function saveVocabularyWord(word: VocabularyWord): Promise<void> {
  await (await db()).put("vocabulary", word);
}

export async function listVocabulary(): Promise<VocabularyWord[]> {
  return (await db()).getAll("vocabulary");
}

export function resolveCatalogUrl(catalogUrl: string, epubUrl: string): string {
  try {
    const relativeCatalog =
      catalogUrl.startsWith("/") ||
      catalogUrl.startsWith("./") ||
      catalogUrl.startsWith("../");
    const base = relativeCatalog
      ? new URL(catalogUrl, globalThis.location.href)
      : new URL(catalogUrl);
    return new URL(epubUrl, base).toString();
  } catch {
    return epubUrl;
  }
}

export async function fetchCatalog(catalogUrl: string): Promise<Catalog> {
  const res = await fetch(catalogUrl);
  if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
  const data = (await res.json()) as Catalog;
  if (!data?.books || !Array.isArray(data.books)) {
    throw new Error("Invalid catalog.json");
  }
  return data;
}

export function catalogBookFromBlossomFavorite(
  favorite: import("../types").ExternalFavorite,
): CatalogBook | null {
  const sha256 = favorite.blossomSha256?.toLowerCase();
  if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256) || !favorite.blossomUrl)
    return null;
  let source: URL;
  try {
    source = new URL(favorite.blossomUrl);
  } catch {
    return null;
  }
  if (source.protocol !== "https:") return null;
  return {
    id: sha256,
    title: favorite.title,
    author: favorite.author || "Unknown",
    epubUrl: source.toString(),
    isbn: favorite.isbn,
    libvaultMd5: favorite.libvaultMd5,
    format:
      favorite.format ??
      (source.pathname.toLowerCase().endsWith(".pdf") ? "pdf" : "epub"),
    blossomSha256: sha256,
    year: favorite.year,
  };
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedEpub(id: string): Promise<Blob | undefined> {
  return getCachedPublication(id, "epub");
}

export function getBookFormat(book: CatalogBook): BookFormat {
  if (book.format === "pdf") return "pdf";
  if (book.format === "epub") return "epub";
  try {
    const extension = new URL(
      book.epubUrl,
      globalThis.location?.href ?? "https://bookstr.invalid/",
    ).pathname
      .split(".")
      .pop()
      ?.toLowerCase();
    return extension === "pdf" ? "pdf" : "epub";
  } catch {
    return book.epubUrl.toLowerCase().split(/[?#]/, 1)[0].endsWith(".pdf")
      ? "pdf"
      : "epub";
  }
}

export async function getCachedPublication(
  id: string,
  format?: BookFormat,
): Promise<Blob | undefined> {
  const database = await db();
  const cached = await database.get("publications", id);
  if (cached && (!format || cached.format === format)) return cached.blob;

  // Preserve EPUBs cached by Bookstr database versions 1 and 2.
  if (!format || format === "epub") {
    const legacy = await database.get("epubs", id);
    if (legacy) {
      await database.put("publications", {
        id,
        blob: legacy.blob,
        format: "epub",
        cachedAt: legacy.cachedAt,
      });
      return legacy.blob;
    }
  }
  return undefined;
}

export async function downloadAndVerify(
  book: CatalogBook,
  catalogUrl: string,
): Promise<Blob> {
  const format = getBookFormat(book);
  const cached = await getCachedPublication(book.id, format);
  if (cached) return cached;

  const url = resolveCatalogUrl(catalogUrl, book.epubUrl);
  if (book.libvaultMd5 && !book.blossomSha256) {
    const source = new URL(url, globalThis.location.href);
    const expectedPath = `/api/files/${book.libvaultMd5.toLowerCase()}`;
    if (
      book.id.toLowerCase() !== book.libvaultMd5.toLowerCase() ||
      source.origin !== globalThis.location.origin ||
      source.pathname !== expectedPath
    ) {
      throw new Error("Untrusted LibVault EPUB source");
    }
  }
  if (book.blossomSha256) {
    const source = new URL(url);
    if (source.protocol !== "https:") {
      throw new Error("Untrusted Blossom source");
    }
  }
  let res = await fetch(url);
  if (book.blossomSha256 && (res.status === 401 || res.status === 403)) {
    const source = new URL(url);
    try {
      const { createBlossomDownloadAuthorization } = await import("./nostr");
      const headers = new Headers();
      headers.set(
        "Authorization",
        await createBlossomDownloadAuthorization(
          book.blossomSha256,
          source.hostname,
        ),
      );
      res = await fetch(url, { headers });
    } catch {
      // Preserve the original HTTP response when signer authorization fails.
    }
  }
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const expectedSha256 =
    book.blossomSha256 ?? (!book.libvaultMd5 ? book.id : null);
  if (expectedSha256) {
    const hash = await sha256Hex(buffer);
    if (hash !== expectedSha256.toLowerCase()) {
      throw new Error(
        `SHA-256 mismatch: expected ${expectedSha256}, got ${hash}`,
      );
    }
  }
  const blob = new Blob([buffer], {
    type: format === "pdf" ? "application/pdf" : "application/epub+zip",
  });
  await (
    await db()
  ).put("publications", { id: book.id, blob, format, cachedAt: Date.now() });
  return blob;
}
