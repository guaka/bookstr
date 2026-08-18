import { useCallback, useEffect, useMemo, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { Settings } from './components/Settings'
import { fetchCatalog, getSetting, listProgress, setSetting } from './lib/catalog'
import { loadFavorites, saveFavorites } from './lib/favorites'
import {
  pullSharedFavorites,
  pullProgress,
  restorePreferredIdentity,
} from './lib/nostr'
import type { CatalogBook, ExternalFavorite, ReadingProgress, Theme } from './types'
import './App.css'

type Screen = 'library' | 'settings' | 'reader'
type Route = { screen: Screen; bookId?: string; section?: 'favorites' }

const DEFAULT_CATALOG = `${import.meta.env.BASE_URL}catalog/catalog.json`

function routeFromHash(): Route {
  const path = window.location.hash.slice(1) || '/'
  if (path === '/settings') return { screen: 'settings' }
  if (path === '/favorites') return { screen: 'library', section: 'favorites' }
  if (path.startsWith('/read/')) {
    try {
      return { screen: 'reader', bookId: decodeURIComponent(path.slice('/read/'.length)) }
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
  const [books, setBooks] = useState<CatalogBook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>('white')
  const [favoriteIds, setFavoriteIds] = useState(() => new Set(loadFavorites()))
  const [externalFavorites, setExternalFavorites] = useState<ExternalFavorite[]>([])
  const [progress, setProgress] = useState<ReadingProgress[]>([])
  const progressById = useMemo(
    () => new Map(progress.map((item) => [item.bookId, item])),
    [progress],
  )

  const active = route.bookId
    ? books.find((book) => book.id === route.bookId) ?? null
    : null

  const refresh = useCallback(async () => {
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
        await pullProgress()
        await refreshProgress()
      } catch {
        /* catalog error is rendered; signer/relay failures remain offline-first */
      }
    })()
  }, [refresh, refreshProgress])

  if (route.screen === 'reader' && active) {
    return (
      <Reader
        book={active}
        catalogUrl={DEFAULT_CATALOG}
        theme={theme}
        onClose={() => {
          navigate('/')
          void Promise.all([refresh(), refreshProgress()])
        }}
      />
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
      favoritesActive={route.section === 'favorites'}
      onHome={() => navigate('/')}
      onFavorites={() => navigate('/favorites')}
      onToggleFavorite={toggleFavorite}
      onSettings={() => navigate('/settings')}
      onOpen={(book) => {
        navigate(`/read/${encodeURIComponent(book.id)}`)
      }}
    />
  )
}
