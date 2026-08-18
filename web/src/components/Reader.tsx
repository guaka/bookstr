import { useCallback, useEffect, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import type {
  CatalogBook,
  DictionaryEntry,
  ReadingProgress,
  Theme,
  TranslationLanguage,
  VocabularyWord,
} from '../types'
import { downloadAndVerify, getProgress, saveProgress } from '../lib/catalog'
import {
  extractSurroundingSentence,
  lookupWord,
  normalizeSelectedWord,
  rememberVocabulary,
} from '../lib/dictionary'
import { publishProgress, publishVocabularyWord } from '../lib/nostr'
import { formatProgress } from '../lib/progress'
import { BackIcon, CloseIcon, ExternalLinkIcon, HomeIcon, NextIcon, SettingsIcon } from './Icons'

const FONT_SIZE_KEY = 'bookstr.fontSize'
const FONT_SIZE_MIN = 70
const FONT_SIZE_MAX = 180
const FONT_SIZE_STEP = 10

type FontSizeThemes = Rendition['themes'] & {
  fontSize(size: string): void
}

type VisibleSection = {
  index: number
  href: string
  pages: number[]
  totalPages: number
  mapping: { start: string; end: string }
}

type ContinuousRendition = Rendition & {
  manager: { currentLocation(): VisibleSection[] }
}

function applyFontSize(rendition: Rendition, size: number) {
  ;(rendition.themes as FontSizeThemes).fontSize(`${size}%`)
}

function initialFontSize() {
  try {
    const stored = Number.parseInt(window.localStorage.getItem(FONT_SIZE_KEY) ?? '', 10)
    if (Number.isFinite(stored)) {
      return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, stored))
    }
  } catch {
    // Reading remains available when storage is disabled.
  }
  return 100
}

type Props = {
  book: CatalogBook
  catalogUrl: string
  onClose: () => void
  onSettings: () => void
  onProgressSaved: (progress: ReadingProgress) => void
  onVocabularySaved: (word: VocabularyWord) => void
  settingsOpen: boolean
  theme: Theme
  translationLanguage: TranslationLanguage
}

type DictionaryCard = {
  word: string
  loading: boolean
  entry?: DictionaryEntry
  error?: string
}

export function Reader({
  book,
  catalogUrl,
  onClose,
  onSettings,
  onProgressSaved,
  onVocabularySaved,
  settingsOpen,
  theme,
  translationLanguage,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const bookRef = useRef<Book | null>(null)
  const onCloseRef = useRef(onClose)
  const onProgressSavedRef = useRef(onProgressSaved)
  const onVocabularySavedRef = useRef(onVocabularySaved)
  const settingsOpenRef = useRef(settingsOpen)
  const dictionaryOpenRef = useRef(false)
  const themeRef = useRef(theme)
  const translationLanguageRef = useRef(translationLanguage)
  const [pct, setPct] = useState('0%')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fontSize, setFontSize] = useState(initialFontSize)
  const [dictionary, setDictionary] = useState<DictionaryCard | null>(null)
  const fontSizeRef = useRef(fontSize)
  const saveTimer = useRef<number | null>(null)
  onCloseRef.current = onClose
  onProgressSavedRef.current = onProgressSaved
  onVocabularySavedRef.current = onVocabularySaved
  settingsOpenRef.current = settingsOpen
  dictionaryOpenRef.current = dictionary !== null
  themeRef.current = theme
  translationLanguageRef.current = translationLanguage

  const changeFontSize = useCallback((delta: number) => {
    setFontSize((current) => {
      const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, current + delta))
      fontSizeRef.current = next
      if (renditionRef.current) applyFontSize(renditionRef.current, next)
      try {
        window.localStorage.setItem(FONT_SIZE_KEY, String(next))
      } catch {
        // Keep the in-memory preference when storage is disabled.
      }
      return next
    })
  }, [])

  const handleKey = useCallback((event: KeyboardEvent) => {
    if (settingsOpenRef.current) return
    const rendition = renditionRef.current
    if (event.key === 'Escape') {
      event.preventDefault()
      if (dictionaryOpenRef.current) {
        dictionaryOpenRef.current = false
        setDictionary(null)
        return
      }
      onCloseRef.current()
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      void rendition?.prev()
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      void rendition?.next()
      return
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      changeFontSize(FONT_SIZE_STEP)
      return
    }
    if (event.key === '-') {
      event.preventDefault()
      changeFontSize(-FONT_SIZE_STEP)
      return
    }
    if (
      event.key === ' ' ||
      event.key === 'PageDown' ||
      event.key === 'PageUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp'
    ) {
      event.preventDefault()
      const scroller = hostRef.current?.querySelector<HTMLElement>('.epub-container')
      const backwards =
        event.key === 'PageUp' || event.key === 'ArrowUp' || (event.key === ' ' && event.shiftKey)
      scroller?.scrollBy({
        top: (backwards ? -1 : 1) * scroller.clientHeight * 0.9,
        behavior: 'smooth',
      })
    }
  }, [changeFontSize])

  useEffect(() => {
    let cancelled = false
    let scroller: HTMLElement | null = null
    let onScroll: (() => void) | null = null
    let scrollPersistTimer: number | null = null
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
          manager: 'continuous',
          flow: 'scrolled-doc',
          allowScriptedContent: true,
        })
        renditionRef.current = rendition
        rendition.themes.select(themeRef.current)
        rendition.themes.register('white', {
          body: {
            background: '#ffffff',
            color: '#1a1714',
            'font-family': 'Georgia, "Literata", serif',
            'line-height': '1.55',
            width: 'min(46rem, calc(100% - 2rem)) !important',
            'max-width': '46rem !important',
            'box-sizing': 'border-box',
            margin: '0 auto !important',
            padding: '0.4em 0.6em !important',
          },
          a: { color: '#1a1714' },
        })
        rendition.themes.register('paper', {
          body: {
            background: '#f4f0e6',
            color: '#1a1714',
            'font-family': 'Georgia, "Literata", serif',
            'line-height': '1.55',
            width: 'min(46rem, calc(100% - 2rem)) !important',
            'max-width': '46rem !important',
            'box-sizing': 'border-box',
            margin: '0 auto !important',
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
            width: 'min(46rem, calc(100% - 2rem)) !important',
            'max-width': '46rem !important',
            'box-sizing': 'border-box',
            margin: '0 auto !important',
            padding: '0.4em 0.6em !important',
          },
          a: { color: '#e8e4dc' },
        })
        rendition.themes.select(themeRef.current)
        applyFontSize(rendition, fontSizeRef.current)
        // Dense generated locations keep progress accurate even in a book's
        // opening pages. The previous 1,600-character spacing stayed at zero
        // across several reader screens.
        await epub.locations.generate(100)

        const persist = async (reportedLocation?: unknown) => {
          const loc = (reportedLocation ?? rendition.currentLocation()) as {
            start?: {
              cfi?: string
              href?: string
              percentage?: number
              index?: number
              displayed?: { page?: number; total?: number }
            }
            end?: {
              cfi?: string
              href?: string
              percentage?: number
              index?: number
              displayed?: { page?: number; total?: number }
            }
          }
          // epub.js can keep a one-page cover in the visible range while the
          // reader is already inside the following section. Use that last
          // visible section's start mapping for both progress and resuming.
          const visible = (rendition as ContinuousRendition).manager.currentLocation()
          const current = visible.at(-1)
          const cfi = current?.mapping.start ?? loc?.start?.cfi
          const generatedLocation = cfi ? epub.locations.locationFromCfi(cfi) : -1
          const page = current?.pages[0] ?? loc?.end?.displayed?.page ?? 1
          const totalPages = current?.totalPages ?? loc?.end?.displayed?.total ?? 1
          const pageProgress = Math.max(0, page - 1) / Math.max(1, totalPages)
          const generatedProgress =
            cfi && generatedLocation >= 0 ? epub.locations.percentageFromCfi(cfi) : pageProgress
          const progression = Math.max(0, Math.min(1, generatedProgress))
          setPct(formatProgress(progression))
          const progress = {
            v: 1 as const,
            bookId: book.id,
            title: book.title,
            author: book.author,
            locator: {
              href: current?.href ?? loc?.start?.href,
              progression,
              cfi,
            },
            updatedAt: Date.now(),
          }
          await saveProgress(progress)
          onProgressSavedRef.current(progress)
          if (saveTimer.current) window.clearTimeout(saveTimer.current)
          saveTimer.current = window.setTimeout(() => {
            void publishProgress(progress)
          }, 2000)
        }

        rendition.on('relocated', (...args: unknown[]) => {
          void persist(args[0])
        })

        rendition.on('click', (...args: unknown[]) => {
          const e = args[0] as MouseEvent
          const w = hostRef.current?.clientWidth ?? 1
          const x = e.clientX
          if (x < w * 0.28) void rendition.prev()
          else if (x > w * 0.72) void rendition.next()
        })
        rendition.on('keydown', (...args: unknown[]) => {
          handleKey(args[0] as KeyboardEvent)
        })
        rendition.on('selected', (...args: unknown[]) => {
          const cfi = typeof args[0] === 'string' ? args[0] : undefined
          const contents = args[1] as { window?: Window } | undefined
          const selectedRange = contents?.window?.getSelection()
          const selection = selectedRange?.toString() ?? ''
          const word = normalizeSelectedWord(selection)
          if (!word) return
          const selectionNode = selectedRange?.anchorNode
          const selectionElement =
            selectionNode?.nodeType === Node.ELEMENT_NODE
              ? (selectionNode as Element)
              : selectionNode?.parentElement
          const contextElement = selectionElement?.closest('p, li, blockquote, dd, dt') ?? selectionElement
          const contextSentence = extractSurroundingSentence(
            contextElement?.textContent ?? '',
            selection,
          )

          dictionaryOpenRef.current = true
          setDictionary({ word, loading: true })
          void lookupWord(word, book.language ?? 'en', translationLanguageRef.current)
            .then(async (entry) => {
              const saved = await rememberVocabulary(entry, {
                bookId: book.id,
                bookTitle: book.title,
                cfi,
                contextSentence,
              })
              onVocabularySavedRef.current(saved)
              setDictionary({ word, loading: false, entry })
              try {
                await publishVocabularyWord(saved)
              } catch {
                // The local word list remains useful while offline or unsigned.
              }
            })
            .catch((lookupError: unknown) => {
              setDictionary({
                word,
                loading: false,
                error: lookupError instanceof Error ? lookupError.message : String(lookupError),
              })
            })
        })

        const saved = await getProgress(book.id)
        if (saved?.locator?.cfi) {
          await rendition.display(saved.locator.cfi)
        } else {
          await rendition.display()
        }
        await persist()

        scroller = hostRef.current?.querySelector<HTMLElement>('.epub-container') ?? null
        onScroll = () => {
          if (scrollPersistTimer) window.clearTimeout(scrollPersistTimer)
          scrollPersistTimer = window.setTimeout(() => {
            void persist()
          }, 250)
        }
        scroller?.addEventListener('scroll', onScroll, { passive: true })

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
      if (scroller && onScroll) scroller.removeEventListener('scroll', onScroll)
      if (scrollPersistTimer) window.clearTimeout(scrollPersistTimer)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      renditionRef.current?.destroy()
      bookRef.current?.destroy()
    }
  }, [book, catalogUrl, handleKey])

  useEffect(() => {
    renditionRef.current?.themes.select(theme)
  }, [theme])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  return (
    <div className={`reader theme-${theme}`}>
      <div ref={hostRef} className="reader-surface" />
      <button
        type="button"
        className="icon-button reader-home"
        onClick={onClose}
        aria-label="Back to library"
      >
        <HomeIcon />
      </button>
      {loading && <div className="reader-status">Opening…</div>}
      {error && (
        <div className="reader-status error">
          <p>{error}</p>
          <button type="button" onClick={onClose}>
            Back
          </button>
        </div>
      )}
      {!error && (
        <div className="reader-chrome">
          <div className="reader-meta">
            <strong>{book.title}</strong>
            <span>{pct}</span>
          </div>
          <div className="reader-actions">
            <div className="reader-font-controls" aria-label="Font size controls">
              <button
                className="icon-button font-size-button"
                type="button"
                onClick={() => changeFontSize(-FONT_SIZE_STEP)}
                disabled={fontSize <= FONT_SIZE_MIN}
                aria-label="Decrease font size"
              >
                A−
              </button>
              <span className="font-size-value" aria-live="polite">
                {fontSize}%
              </span>
              <button
                className="icon-button font-size-button"
                type="button"
                onClick={() => changeFontSize(FONT_SIZE_STEP)}
                disabled={fontSize >= FONT_SIZE_MAX}
                aria-label="Increase font size"
              >
                A+
              </button>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={onSettings}
              aria-label="Settings"
            >
              <SettingsIcon />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => void renditionRef.current?.prev()}
              aria-label="Previous section"
            >
              <BackIcon />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => void renditionRef.current?.next()}
              aria-label="Next section"
            >
              <NextIcon />
            </button>
          </div>
        </div>
      )}
      {dictionary && (
        <aside className="dictionary-card" aria-live="polite" aria-label={`Definition of ${dictionary.word}`}>
          <div className="dictionary-heading">
            <div>
              <strong>{dictionary.word}</strong>
              {dictionary.entry?.partOfSpeech && <span>{dictionary.entry.partOfSpeech}</span>}
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => setDictionary(null)}
              aria-label="Close definition"
            >
              <CloseIcon />
            </button>
          </div>
          {dictionary.loading && <p className="muted">Looking up…</p>}
          {dictionary.error && <p className="error">{dictionary.error}</p>}
          {dictionary.entry && (
            <>
              <ol>
                {dictionary.entry.definitions.map((definition) => (
                  <li key={definition}>{definition}</li>
                ))}
              </ol>
              {dictionary.entry.translation && (
                <p className="dictionary-translation">
                  <span>{dictionary.entry.language === 'pt' ? 'English' : 'Portuguese'}</span>{' '}
                  {dictionary.entry.translation}
                </p>
              )}
              <div className="dictionary-footer">
                <span>Saved to Words</span>
                <a href={dictionary.entry.sourceUrl} target="_blank" rel="noreferrer">
                  Wiktionary <ExternalLinkIcon />
                </a>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  )
}
