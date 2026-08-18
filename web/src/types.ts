/// <reference types="vite/client" />

export type Theme = 'white' | 'paper' | 'night'

export interface CatalogBook {
  id: string
  title: string
  author: string
  language?: string
  license?: string
  licenseUrl?: string
  coverUrl?: string
  epubUrl: string
  sourceUrl?: string
  isbn?: string
  libvaultMd5?: string
}

export interface ExternalFavorite {
  key: string
  title: string
  detail: string
  url?: string
  isbn?: string
  libvaultMd5?: string
}

export interface DictionaryEntry {
  key: string
  word: string
  language: string
  partOfSpeech?: string
  definitions: string[]
  translation?: string
  sourceUrl: string
  updatedAt: number
}

export interface VocabularyWord extends DictionaryEntry {
  syncId: string
  bookId: string
  bookTitle: string
  cfi?: string
  lookupCount: number
  firstSeenAt: number
  lastSeenAt: number
}

export interface Catalog {
  version: number
  books: CatalogBook[]
}

export interface ReadingProgress {
  v: 1
  bookId: string
  title?: string
  author?: string
  locator: {
    href?: string
    progression: number
    cfi?: string
  }
  updatedAt: number
}
