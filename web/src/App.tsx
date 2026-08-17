import { useCallback, useEffect, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { Settings } from './components/Settings'
import { fetchCatalog, getSetting, setSetting } from './lib/catalog'
import {
  pullProgress,
  restorePreferredIdentity,
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
  const [loading, setLoading] = useState(true)
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
      // Match LibVault: start NIP-07 detection in the background so catalog
      // rendering never waits for an extension to inject or answer.
      const identity = restorePreferredIdentity()
      try {
        await refresh()
        await identity
        await pullProgress()
      } catch {
        /* catalog error is rendered; signer/relay failures remain offline-first */
      }
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
      onSettings={() => navigate('/settings')}
      onOpen={(book) => {
        navigate(`/read/${encodeURIComponent(book.id)}`)
      }}
    />
  )
}
