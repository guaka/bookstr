import { useCallback, useEffect, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { Settings } from './components/Settings'
import { fetchCatalog, getSetting, setSetting } from './lib/catalog'
import { pullProgress } from './lib/nostr'
import type { CatalogBook } from './types'
import './App.css'

type Screen = 'library' | 'settings' | 'reader'

const DEFAULT_CATALOG = `${import.meta.env.BASE_URL}catalog/catalog.json`

export default function App() {
  const [screen, setScreen] = useState<Screen>('library')
  const [books, setBooks] = useState<CatalogBook[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalogUrl, setCatalogUrl] = useState(DEFAULT_CATALOG)
  const [active, setActive] = useState<CatalogBook | null>(null)
  const [theme, setTheme] = useState<'paper' | 'night'>('paper')

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
    void (async () => {
      const t = await getSetting('theme', 'paper')
      setTheme(t === 'night' ? 'night' : 'paper')
      await refresh()
    })()
  }, [refresh])

  if (screen === 'reader' && active) {
    return (
      <Reader
        book={active}
        catalogUrl={catalogUrl}
        theme={theme}
        onClose={() => {
          setActive(null)
          setScreen('library')
          void refresh()
        }}
      />
    )
  }

  if (screen === 'settings') {
    return (
      <Settings
        theme={theme}
        onTheme={(t) => {
          setTheme(t)
          void setSetting('theme', t)
        }}
        onBack={() => {
          setScreen('library')
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
      onSettings={() => setScreen('settings')}
      onOpen={(book) => {
        setActive(book)
        setScreen('reader')
      }}
    />
  )
}
