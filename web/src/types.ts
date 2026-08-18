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
