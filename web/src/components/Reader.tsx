import { useEffect, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import type { CatalogBook } from '../types'
import { downloadAndVerify, getProgress, saveProgress } from '../lib/catalog'
import { publishProgress } from '../lib/nostr'

type Props = {
  book: CatalogBook
  catalogUrl: string
  onClose: () => void
  theme: 'paper' | 'night'
}

export function Reader({ book, catalogUrl, onClose, theme }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const bookRef = useRef<Book | null>(null)
  const [chrome, setChrome] = useState(false)
  const [pct, setPct] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const blob = await downloadAndVerify(book, catalogUrl)
        if (cancelled || !hostRef.current) return
        const epub = ePub(await blob.arrayBuffer())
        bookRef.current = epub
        const rendition = epub.renderTo(hostRef.current, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          allowScriptedContent: true,
        })
        renditionRef.current = rendition
        rendition.themes.select(theme === 'night' ? 'night' : 'paper')
        rendition.themes.register('paper', {
          body: {
            background: '#f4f0e6',
            color: '#1a1714',
            'font-family': 'Georgia, "Literata", serif',
            'line-height': '1.55',
            margin: '0 !important',
            padding: '0.4em 0.6em !important',
          },
          a: { color: '#1a1714' },
        })
        rendition.themes.register('night', {
          body: {
            background: '#121212',
            color: '#e8e4dc',
            'font-family': 'Georgia, "Literata", serif',
            'line-height': '1.55',
            margin: '0 !important',
            padding: '0.4em 0.6em !important',
          },
          a: { color: '#e8e4dc' },
        })
        rendition.themes.select(theme === 'night' ? 'night' : 'paper')

        const saved = await getProgress(book.id)
        if (saved?.locator?.cfi) {
          await rendition.display(saved.locator.cfi)
        } else {
          await rendition.display()
        }

        const persist = async () => {
          const loc = rendition.currentLocation() as {
            start?: { cfi?: string; href?: string; percentage?: number }
          }
          const progression = loc?.start?.percentage ?? 0
          setPct(Math.round(progression * 100))
          const progress = {
            v: 1 as const,
            bookId: book.id,
            title: book.title,
            author: book.author,
            locator: {
              href: loc?.start?.href,
              progression,
              cfi: loc?.start?.cfi,
            },
            updatedAt: Date.now(),
          }
          await saveProgress(progress)
          if (saveTimer.current) window.clearTimeout(saveTimer.current)
          saveTimer.current = window.setTimeout(() => {
            void publishProgress(progress)
          }, 2000)
        }

        rendition.on('relocated', () => {
          void persist()
        })

        rendition.on('click', (...args: unknown[]) => {
          const e = args[0] as MouseEvent
          const w = hostRef.current?.clientWidth ?? 1
          const x = e.clientX
          if (x < w * 0.28) void rendition.prev()
          else if (x > w * 0.72) void rendition.next()
          else setChrome((c) => !c)
        })

        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      renditionRef.current?.destroy()
      bookRef.current?.destroy()
    }
  }, [book, catalogUrl, theme])

  useEffect(() => {
    renditionRef.current?.themes.select(theme === 'night' ? 'night' : 'paper')
  }, [theme])

  useEffect(() => {
    if (!chrome) return
    const t = window.setTimeout(() => setChrome(false), 3500)
    return () => window.clearTimeout(t)
  }, [chrome])

  return (
    <div className={`reader theme-${theme}`}>
      <div ref={hostRef} className="reader-surface" />
      {loading && <div className="reader-status">Opening…</div>}
      {error && (
        <div className="reader-status error">
          <p>{error}</p>
          <button type="button" onClick={onClose}>
            Back
          </button>
        </div>
      )}
      {chrome && !error && (
        <div className="reader-chrome">
          <button type="button" onClick={onClose}>
            ← Library
          </button>
          <div className="reader-meta">
            <strong>{book.title}</strong>
            <span>{pct}%</span>
          </div>
          <div className="reader-actions">
            <button type="button" onClick={() => void renditionRef.current?.prev()}>
              Prev
            </button>
            <button type="button" onClick={() => void renditionRef.current?.next()}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
