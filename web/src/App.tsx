import { useCallback, useEffect, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { Settings } from './components/Settings'
import { fetchCatalog, getSetting, setSetting } from './lib/catalog'
import {
  pullProgress,
  waitForNip07,
  connectNip07,
  getAuthMode,
  restoreNip46,
} from './lib/nostr'
import type { CatalogBook } from './types'
import './App.css'

type Screen = 'library' | 'settings' | 'reader'
type Route = { screen: Screen; bookId?: string }

const DEFAULT_CATALOG = `${import.meta.env.BASE_URL}catalog/catalog.json`

function routeFromHash(): Route {
  const path = window.location.hash.slice(1) || '/'
  if (path === '/settings') return { screen: 'settings' }
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalogUrl, setCatalogUrl] = useState(DEFAULT_CATALOG)
  const [theme, setTheme] = useState<'paper' | 'night'>('paper')

  const active = route.bookId
    ? books.find((book) => book.id === route.bookId) ?? null
    : null

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = (await getSetting('catalogUrl', DEFAULT_CATALOG)) || DEFAULT_CATALOG
      setCatalogUrl(url)
      const catalog = await fetchCatalog(url)
      setBooks(catalog.books)
      try {
        await pullProgress()
      } catch {
        /* offline / no nsec */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBooks([])
    } finally {
      setLoading(false)
    }
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
    void (async () => {
      const t = await getSetting('theme', 'paper')
      setTheme(t === 'night' ? 'night' : 'paper')
      // Rehydrate an existing session (do not prompt after Disconnect)
      try {
        const mode = await getAuthMode()
        if (mode === 'nip07' && (await waitForNip07())) {
          await connectNip07()
        } else if (mode === 'nip46') {
          await restoreNip46()
        }
      } catch {
        /* extension / bunker unavailable */
      }
      await refresh()
    })()
  }, [refresh])

  if (route.screen === 'reader' && active) {
    return (
      <Reader
        book={active}
        catalogUrl={catalogUrl}
        theme={theme}
        onClose={() => {
          navigate('/')
          void refresh()
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

  return (
    <Library
      books={books}
      loading={loading}
      error={error}
      onRefresh={() => void refresh()}
      onSettings={() => navigate('/settings')}
      onOpen={(book) => {
        navigate(`/read/${encodeURIComponent(book.id)}`)
      }}
    />
  )
}
