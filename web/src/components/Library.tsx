import type { CatalogBook, ExternalFavorite, ReadingProgress, VocabularyWord } from '../types'
import { formatProgress } from '../lib/progress'
import { Footer } from './Footer'
import { BookIcon, ExternalLinkIcon, HeartIcon, SettingsIcon, WordsIcon } from './Icons'

type Props = {
  books: CatalogBook[]
  onOpen: (book: CatalogBook) => void
  onSettings: () => void
  onFavorites: () => void
  onWords: () => void
  onHome: () => void
  onToggleFavorite: (bookId: string) => void
  favoriteIds: ReadonlySet<string>
  progressById: ReadonlyMap<string, ReadingProgress>
  externalFavorites: ExternalFavorite[]
  vocabulary: VocabularyWord[]
  favoritesActive: boolean
  wordsActive: boolean
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
        const progressLabel = progress ? formatProgress(progress.locator.progression, ' read') : null
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
  onWords,
  onHome,
  onToggleFavorite,
  favoriteIds,
  progressById,
  externalFavorites,
  vocabulary,
  favoritesActive,
  wordsActive,
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
          <button
            className={`icon-button ${wordsActive ? 'active' : ''}`}
            type="button"
            onClick={onWords}
            aria-label="Words"
            aria-pressed={wordsActive}
          >
            <WordsIcon />
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
            {favorites.length === 0 && externalFavorites.length === 0 ? (
              <p className="muted shelf-empty">Heart a book to keep it here.</p>
            ) : (
              <>
                {favorites.length > 0 && (
                  <BookRows
                    books={favorites}
                    empty=""
                    onOpen={onOpen}
                    onToggleFavorite={onToggleFavorite}
                    favoriteIds={favoriteIds}
                    progressById={progressById}
                  />
                )}
                {externalFavorites.length > 0 && (
                  <ul className="book-list external-favorites">
                    {externalFavorites.map((favorite) => (
                      <li className="book-item" key={favorite.key}>
                        <a
                          className="book-row external-favorite"
                          href={favorite.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="book-title">{favorite.title}</span>
                          <span className="book-author">{favorite.detail}</span>
                          <span className="external-favorite-source">
                            LibVault <ExternalLinkIcon />
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="book-shelf" aria-labelledby="words-heading">
            <h2 id="words-heading">Words</h2>
            {vocabulary.length === 0 ? (
              <p className="muted shelf-empty">Select a word while reading to look it up and save it here.</p>
            ) : (
              <ul className="word-list">
                {vocabulary.map((word) => (
                  <li className="word-item" key={word.key}>
                    <div className="word-heading">
                      <strong>{word.word}</strong>
                      {word.partOfSpeech && <span>{word.partOfSpeech}</span>}
                    </div>
                    <p>{word.translation ?? word.definitions[0]}</p>
                    {word.contextSentence && (
                      <blockquote className="word-context-sentence">“{word.contextSentence}”</blockquote>
                    )}
                    <div className="word-context">
                      <span>{word.bookTitle}</span>
                      {word.lookupCount > 1 && <span>Looked up {word.lookupCount} times</span>}
                      <a href={word.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${word.word} in Wiktionary`}>
                        Wiktionary <ExternalLinkIcon />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
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
