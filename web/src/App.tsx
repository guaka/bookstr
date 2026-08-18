import { useCallback, useEffect, useMemo, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { Settings } from './components/Settings'
import { fetchCatalog, getSetting, listProgress, listVocabulary, setSetting } from './lib/catalog'
import { loadFavorites, saveFavorites } from './lib/favorites'
import {
  pullSharedFavorites,
  pullProgress,
  pullVocabulary,
  restorePreferredIdentity,
} from './lib/nostr'
import type { CatalogBook, ExternalFavorite, ReadingProgress, Theme, VocabularyWord } from './types'
import './App.css'

type Screen = 'library' | 'settings' | 'reader'
type Route = { screen: Screen; bookId?: string; section?: 'favorites' | 'words'; settingsOpen?: boolean }

const DEFAULT_CATALOG = `${import.meta.env.BASE_URL}catalog/catalog.json`

function libvaultBookFromLocation(): CatalogBook | null {
  const params = new URLSearchParams(window.location.search)
  const md5 = (params.get('libvaultMd5') || '').toLowerCase()
  if (!/^[a-f0-9]{32}$/.test(md5)) return null
  return {
    id: md5,
    libvaultMd5: md5,
    title: params.get('title') || 'LibVault EPUB',
    author: params.get('author') || 'Unknown author',
    epubUrl: `/api/files/${md5}`,
  }
}

const LIBVAULT_BOOK = libvaultBookFromLocation()

function routeFromHash(): Route {
  const path = window.location.hash.slice(1) || '/'
  if (path === '/settings') return { screen: 'settings' }
  if (path === '/favorites') return { screen: 'library', section: 'favorites' }
  if (path === '/words') return { screen: 'library', section: 'words' }
  if (path.startsWith('/read/')) {
    try {
      const raw = path.slice('/read/'.length)
      const settingsOpen = raw.endsWith('/settings')
      const encodedBookId = settingsOpen ? raw.slice(0, -'/settings'.length) : raw
      return { screen: 'reader', bookId: decodeURIComponent(encodedBookId), settingsOpen }
    } catch {
      return { screen: 'library' }
    }
  }
  return { screen: 'library' }
}

function navigate(path: string) {
  window.location.hash = path
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [books, setBooks] = useState<CatalogBook[]>(LIBVAULT_BOOK ? [LIBVAULT_BOOK] : [])
  const [loading, setLoading] = useState(!LIBVAULT_BOOK)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>('white')
  const [favoriteIds, setFavoriteIds] = useState(() => new Set(loadFavorites()))
  const [externalFavorites, setExternalFavorites] = useState<ExternalFavorite[]>([])
  const [progress, setProgress] = useState<ReadingProgress[]>([])
  const [vocabulary, setVocabulary] = useState<VocabularyWord[]>([])
  const progressById = useMemo(
    () => new Map(progress.map((item) => [item.bookId, item])),
    [progress],
  )

  const active = route.bookId
    ? books.find((book) => book.id === route.bookId) ?? null
    : null

  const refresh = useCallback(async () => {
	if (LIBVAULT_BOOK) {
	  setBooks([LIBVAULT_BOOK])
	  setLoading(false)
	  return [LIBVAULT_BOOK]
	}
    setLoading(true)
    setError(null)
    try {
      const catalog = await fetchCatalog(DEFAULT_CATALOG)
      setBooks(catalog.books)
      return catalog.books
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBooks([])
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshProgress = useCallback(async () => {
    setProgress(await listProgress())
  }, [])

  const refreshVocabulary = useCallback(async () => {
    setVocabulary((await listVocabulary()).sort((a, b) => b.lastSeenAt - a.lastSeenAt))
  }, [])

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#/`,
      )
    }
    const onHashChange = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (route.section === 'favorites') {
      requestAnimationFrame(() => document.getElementById('favorites-heading')?.scrollIntoView())
    }
    if (route.section === 'words') {
      requestAnimationFrame(() => document.getElementById('words-heading')?.scrollIntoView())
    }
  }, [route.section])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    void (async () => {
      const t = await getSetting('theme', 'white')
      setTheme(t === 'night' || t === 'paper' ? t : 'white')
      // Match LibVault: start NIP-07 detection in the background so catalog
      // rendering never waits for an extension to inject or answer.
      const identity = restorePreferredIdentity()
      try {
        const loadedBooks = await refresh()
        await identity
        const shared = await pullSharedFavorites(loadedBooks)
        setFavoriteIds((current) => {
          const merged = new Set([...current, ...shared.bookIds])
          saveFavorites(merged)
          return merged
        })
        setExternalFavorites(shared.external)
        await Promise.all([pullProgress(), pullVocabulary()])
        await Promise.all([refreshProgress(), refreshVocabulary()])
      } catch {
        /* catalog error is rendered; signer/relay failures remain offline-first */
      }
    })()
  }, [refresh, refreshProgress, refreshVocabulary])

  if (route.screen === 'reader' && active) {
    return (
      <>
        <Reader
          book={active}
          catalogUrl={DEFAULT_CATALOG}
          theme={theme}
          settingsOpen={Boolean(route.settingsOpen)}
          onSettings={() => navigate(`/read/${encodeURIComponent(active.id)}/settings`)}
          onVocabularySaved={(word) => {
            setVocabulary((current) => [word, ...current.filter((item) => item.key !== word.key)])
          }}
          onClose={() => {
            navigate('/')
            void Promise.all([refresh(), refreshProgress(), refreshVocabulary()])
          }}
        />
        {route.settingsOpen && (
          <Settings
            theme={theme}
            onTheme={(t) => {
              setTheme(t)
              void setSetting('theme', t)
            }}
            onBack={() => navigate(`/read/${encodeURIComponent(active.id)}`)}
          />
        )}
      </>
    )
  }

  if (route.screen === 'settings') {
    return (
      <Settings
        theme={theme}
        onTheme={(t) => {
          setTheme(t)
          void setSetting('theme', t)
        }}
        onBack={() => {
          navigate('/')
          void refresh()
        }}
      />
    )
  }

  const toggleFavorite = (bookId: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current)
      if (next.has(bookId)) next.delete(bookId)
      else next.add(bookId)
      saveFavorites(next)
      return next
    })
  }

  return (
    <Library
      books={books}
      loading={loading}
      error={error}
      favoriteIds={favoriteIds}
      progressById={progressById}
      externalFavorites={externalFavorites}
      vocabulary={vocabulary}
      favoritesActive={route.section === 'favorites'}
      wordsActive={route.section === 'words'}
      onHome={() => navigate('/')}
      onFavorites={() => navigate('/favorites')}
      onWords={() => navigate('/words')}
      onToggleFavorite={toggleFavorite}
      onSettings={() => navigate('/settings')}
      onOpen={(book) => {
        navigate(`/read/${encodeURIComponent(book.id)}`)
      }}
    />
  )
}
