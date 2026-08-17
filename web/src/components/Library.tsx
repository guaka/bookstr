import type { CatalogBook } from '../types'
import { Footer } from './Footer'
import { SettingsIcon } from './Icons'

type Props = {
  books: CatalogBook[]
  onOpen: (book: CatalogBook) => void
  onSettings: () => void
  loading: boolean
  error: string | null
}

export function Library({ books, onOpen, onSettings, loading, error }: Props) {
  return (
    <div className="library">
      <header className="library-header">
        <h1>bookstr</h1>
        <div className="library-header-actions">
          <button className="icon-button" type="button" onClick={onSettings} aria-label="Settings">
            <SettingsIcon />
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {loading && books.length === 0 && (
        <ul className="book-list" aria-label="Loading catalog">
          {Array.from({ length: 5 }, (_, index) => (
            <li key={index}>
              <div className="book-row book-row-placeholder">
                {index === 0 ? (
                  <span className="muted">Loading catalog…</span>
                ) : (
                  <span className="skeleton-line" aria-hidden="true" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && books.length === 0 && (
        <p className="muted">No books. Set a catalog URL in Settings.</p>
      )}
      {(!loading || books.length > 0) && !error && (
        <ul className="book-list">
          {books.map((b) => (
            <li key={b.id}>
              <button type="button" className="book-row" onClick={() => onOpen(b)}>
                <span className="book-title">{b.title}</span>
                <span className="book-author">{b.author}</span>
                {b.license && <span className="book-license">{b.license}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Footer />
    </div>
  )
}
