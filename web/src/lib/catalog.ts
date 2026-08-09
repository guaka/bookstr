import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Catalog, CatalogBook, ReadingProgress } from '../types'

interface BookstrDB extends DBSchema {
  epubs: {
    key: string
    value: { id: string; blob: Blob; cachedAt: number }
  }
  progress: {
    key: string
    value: ReadingProgress
  }
  settings: {
    key: string
    value: string
  }
}

let dbPromise: Promise<IDBPDatabase<BookstrDB>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<BookstrDB>('bookstr', 1, {
      upgrade(database) {
        database.createObjectStore('epubs', { keyPath: 'id' })
        database.createObjectStore('progress', { keyPath: 'bookId' })
        database.createObjectStore('settings')
      },
    })
  }
  return dbPromise
}

/** Test-only: close and drop IndexedDB so suites start clean. */
export async function resetCatalogDbForTests(): Promise<void> {
  if (dbPromise) {
    const database = await dbPromise
    database.close()
    dbPromise = null
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('bookstr')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'))
    req.onblocked = () => resolve()
  })
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const value = await (await db()).get('settings', key)
  return value ?? fallback
}

export async function setSetting(key: string, value: string): Promise<void> {
  await (await db()).put('settings', value, key)
}

export async function getProgress(bookId: string): Promise<ReadingProgress | undefined> {
  return (await db()).get('progress', bookId)
}

export async function saveProgress(progress: ReadingProgress): Promise<void> {
  await (await db()).put('progress', progress)
}

export async function listProgress(): Promise<ReadingProgress[]> {
  return (await db()).getAll('progress')
}

export function resolveCatalogUrl(catalogUrl: string, epubUrl: string): string {
  try {
    return new URL(epubUrl, catalogUrl).toString()
  } catch {
    return epubUrl
  }
}

export async function fetchCatalog(catalogUrl: string): Promise<Catalog> {
  const res = await fetch(catalogUrl)
  if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`)
  const data = (await res.json()) as Catalog
  if (!data?.books || !Array.isArray(data.books)) {
    throw new Error('Invalid catalog.json')
  }
  return data
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function getCachedEpub(id: string): Promise<Blob | undefined> {
  const row = await (await db()).get('epubs', id)
  return row?.blob
}

export async function downloadAndVerify(
  book: CatalogBook,
  catalogUrl: string,
): Promise<Blob> {
  const cached = await getCachedEpub(book.id)
  if (cached) return cached

  const url = resolveCatalogUrl(catalogUrl, book.epubUrl)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`)
  const buffer = await res.arrayBuffer()
  const hash = await sha256Hex(buffer)
  if (hash !== book.id.toLowerCase()) {
    throw new Error(`SHA-256 mismatch: expected ${book.id}, got ${hash}`)
  }
  const blob = new Blob([buffer], { type: 'application/epub+zip' })
  await (await db()).put('epubs', { id: book.id, blob, cachedAt: Date.now() })
  return blob
}
