import type { CatalogBook } from '../types'

type Props = {
  books: CatalogBook[]
  onOpen: (book: CatalogBook) => void
  onSettings: () => void
  loading: boolean
  error: string | null
  onRefresh: () => void
}

export function Library({ books, onOpen, onSettings, loading, error, onRefresh }: Props) {
  return (
    <div className="library">
      <header className="library-header">
        <h1>bookstr</h1>
        <div className="library-header-actions">
          <button type="button" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" onClick={onSettings}>
            Settings
          </button>
        </div>
      </header>
      {loading && <p className="muted">Loading catalog…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && books.length === 0 && (
        <p className="muted">No books. Set a catalog URL in Settings.</p>
      )}
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
    </div>
  )
}
