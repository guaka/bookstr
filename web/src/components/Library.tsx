import type { CatalogBook, ReadingProgress } from '../types'
import { Footer } from './Footer'
import { BookIcon, HeartIcon, SettingsIcon } from './Icons'

type Props = {
  books: CatalogBook[]
  onOpen: (book: CatalogBook) => void
  onSettings: () => void
  onFavorites: () => void
  onHome: () => void
  onToggleFavorite: (bookId: string) => void
  favoriteIds: ReadonlySet<string>
  progressById: ReadonlyMap<string, ReadingProgress>
  favoritesActive: boolean
  loading: boolean
  error: string | null
}

type BookRowsProps = Pick<Props, 'onOpen' | 'onToggleFavorite' | 'favoriteIds' | 'progressById'> & {
  books: CatalogBook[]
  empty: string
}

function BookRows({
  books,
  empty,
  onOpen,
  onToggleFavorite,
  favoriteIds,
  progressById,
}: BookRowsProps) {
  if (books.length === 0) return <p className="muted shelf-empty">{empty}</p>

  return (
    <ul className="book-list">
      {books.map((book) => {
        const favorite = favoriteIds.has(book.id)
        const progress = progressById.get(book.id)
        const percentage = progress
          ? Math.max(0, Math.min(100, Math.round(progress.locator.progression * 100)))
          : null
        const progressLabel =
          progress && progress.locator.progression > 0 && percentage === 0
            ? '<1% read'
            : percentage !== null
              ? `${percentage}% read`
              : null
        return (
          <li className="book-item" key={book.id}>
            <button type="button" className="book-row" onClick={() => onOpen(book)}>
              <span className="book-title">{book.title}</span>
              <span className="book-author">{book.author}</span>
              <span className="book-facts">
                {book.license && <span className="book-license">{book.license}</span>}
                {progressLabel && <span className="book-progress">{progressLabel}</span>}
              </span>
            </button>
            <button
              className={`icon-button book-favorite ${favorite ? 'active' : ''}`}
              type="button"
              onClick={() => onToggleFavorite(book.id)}
              aria-label={`${favorite ? 'Remove' : 'Add'} ${book.title} ${favorite ? 'from' : 'to'} favorites`}
              aria-pressed={favorite}
            >
              <HeartIcon filled={favorite} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function Library({
  books,
  onOpen,
  onSettings,
  onFavorites,
  onHome,
  onToggleFavorite,
  favoriteIds,
  progressById,
  favoritesActive,
  loading,
  error,
}: Props) {
  const favorites = books.filter((book) => favoriteIds.has(book.id))
  const reading = books
    .filter((book) => progressById.has(book.id) && !favoriteIds.has(book.id))
    .sort(
      (a, b) =>
        (progressById.get(b.id)?.updatedAt ?? 0) - (progressById.get(a.id)?.updatedAt ?? 0),
    )
  const examples = books.filter(
    (book) => !favoriteIds.has(book.id) && !progressById.has(book.id),
  )

  return (
    <div className="library">
      <header className="library-header">
        <button className="brand-link" type="button" onClick={onHome} aria-label="Bookstr home">
          <span className="brand-mark">
            <BookIcon />
          </span>
          <span className="brand-name">bookstr</span>
        </button>
        <div className="library-header-actions">
          <button
            className={`icon-button ${favoritesActive ? 'active' : ''}`}
            type="button"
            onClick={onFavorites}
            aria-label="Favorites"
            aria-pressed={favoritesActive}
          >
            <HeartIcon filled={favoritesActive} />
          </button>
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

      {!error && (!loading || books.length > 0) && (
        <>
          <section className="book-shelf" aria-labelledby="reading-heading">
            <h1 id="reading-heading">Reading</h1>
            <BookRows
              books={reading}
              empty="Books you open will appear here with their progress."
              onOpen={onOpen}
              onToggleFavorite={onToggleFavorite}
              favoriteIds={favoriteIds}
              progressById={progressById}
            />
          </section>

          <section className="book-shelf" aria-labelledby="favorites-heading">
            <h2 id="favorites-heading">Favorites</h2>
            <BookRows
              books={favorites}
              empty="Heart a book to keep it here."
              onOpen={onOpen}
              onToggleFavorite={onToggleFavorite}
              favoriteIds={favoriteIds}
              progressById={progressById}
            />
          </section>

          <section className="book-shelf" aria-labelledby="examples-heading">
            <h2 id="examples-heading">Examples</h2>
            <BookRows
              books={examples}
              empty="All example books are in Favorites or Reading."
              onOpen={onOpen}
              onToggleFavorite={onToggleFavorite}
              favoriteIds={favoriteIds}
              progressById={progressById}
            />
          </section>

          <section className="book-shelf more-books" aria-labelledby="more-books-heading">
            <h2 id="more-books-heading">More books</h2>
            <p className="muted">More legal catalogs are being connected. Explore the sources:</p>
            <div className="source-links">
              <a href="https://standardebooks.org/ebooks" target="_blank" rel="noreferrer">
                Standard Ebooks
              </a>
              <a href="https://www.gutenberg.org/" target="_blank" rel="noreferrer">
                Project Gutenberg
              </a>
              <a href="https://wikisource.org/" target="_blank" rel="noreferrer">
                Wikisource
              </a>
            </div>
          </section>
        </>
      )}

      <Footer />
    </div>
  )
}
