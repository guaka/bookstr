import { useState } from "react";
import { getBookFormat } from "../lib/catalog";
import type {
  CatalogBook,
  ExternalFavorite,
  ReadingProgress,
  VocabularyWord,
} from "../types";
import { formatProgress } from "../lib/progress";
import { Footer } from "./Footer";
import {
  BookIcon,
  ExternalLinkIcon,
  HeartIcon,
  SettingsIcon,
  WordsIcon,
} from "./Icons";

type Props = {
  books: CatalogBook[];
  onOpen: (book: CatalogBook) => void;
  onSettings: () => void;
  onFavorites: () => void;
  onWords: () => void;
  onHome: () => void;
  onToggleFavorite: (bookId: string) => void;
  favoriteIds: ReadonlySet<string>;
  progressById: ReadonlyMap<string, ReadingProgress>;
  externalFavorites: ExternalFavorite[];
  vocabulary: VocabularyWord[];
  favoritesActive: boolean;
  wordsActive: boolean;
  nostrFavoritesStatus:
    "idle" | "syncing" | "synced" | "disconnected" | "error";
  nostrFavoritesMessage: string;
  onRetryNostr: () => void;
  loading: boolean;
  error: string | null;
  openingBookId?: string | null;
  openingBookMessage?: string | null;
};

type BookRowsProps = Pick<
  Props,
  "onOpen" | "onToggleFavorite" | "favoriteIds" | "progressById"
> & {
  books: CatalogBook[];
  empty: string;
  openingBookId: string | null;
  openingBookMessage?: string | null;
  showPublicationStatus?: boolean;
  openDisabledReason?: (book: CatalogBook) => string | null;
};

function cleanAuthor(author?: string) {
  const value = author?.trim();
  return value && value.toLowerCase() !== "unknown" ? value : "Author unknown";
}

function publicationLabel(format: string, blossomSha256?: string) {
  return `${format.toUpperCase()} · ${blossomSha256 ? "On Blossom" : "Not on Blossom"}`;
}

function BookRows({
  books,
  empty,
  onOpen,
  onToggleFavorite,
  favoriteIds,
  progressById,
  openingBookId = null,
  openingBookMessage = null,
  showPublicationStatus = false,
  openDisabledReason,
}: BookRowsProps) {
  if (books.length === 0) return <p className="muted shelf-empty">{empty}</p>;

  return (
    <ul className="book-list">
      {books.map((book) => {
        const favorite = favoriteIds.has(book.id);
        const progress = progressById.get(book.id);
        const progressLabel = progress
          ? formatProgress(progress.locator.progression, " read")
          : null;
        const opening = openingBookId === book.id;
        const disabledReason = openDisabledReason?.(book) ?? null;
        return (
          <li className="book-item" key={book.id}>
            <button
              type="button"
              className="book-row"
              disabled={openingBookId !== null || disabledReason !== null}
              title={disabledReason ?? ""}
              onClick={disabledReason ? undefined : () => onOpen(book)}
            >
              <span className="book-title">{book.title}</span>
              <span className="book-author">
                {cleanAuthor(book.author)}
                {book.year ? ` · ${book.year}` : ""}
              </span>
              <span className="book-facts">
                {book.license && (
                  <span className="book-license">{book.license}</span>
                )}
                {showPublicationStatus && (
                  <span
                    className={`book-publication ${book.blossomSha256 ? "available" : ""}`}
                  >
                    {publicationLabel(getBookFormat(book), book.blossomSha256)}
                  </span>
                )}
                {progressLabel && (
                  <span className="book-progress">{progressLabel}</span>
                )}
                {opening && (
                  <span className="book-opening">
                    {openingBookMessage || "Downloading and opening…"}
                  </span>
                )}
                {!opening && disabledReason && (
                  <span className="book-opening">{disabledReason}</span>
                )}
              </span>
              {progress && progress.locator.progression > 0 && (
                <progress
                  max={1}
                  value={progress.locator.progression}
                  aria-label={`${progressLabel}`}
                />
              )}
            </button>
            <button
              className={`icon-button book-favorite ${favorite ? "active" : ""}`}
              type="button"
              onClick={() => onToggleFavorite(book.id)}
              aria-label={`${favorite ? "Remove" : "Add"} ${book.title} ${favorite ? "from" : "to"} favorites`}
              aria-pressed={favorite}
            >
              <HeartIcon filled={favorite} />
            </button>
          </li>
        );
      })}
    </ul>
  );
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
  nostrFavoritesStatus,
  nostrFavoritesMessage,
  onRetryNostr,
  loading,
  error,
  openingBookId = null,
  openingBookMessage = null,
}: Props) {
  const [favoriteQuery, setFavoriteQuery] = useState("");
  const favorites = books.filter((book) => favoriteIds.has(book.id));
  const booksById = new Map<string, CatalogBook>(books.map((book) => [book.id, book]));
  const readingById = new Map<string, { book: CatalogBook; updatedAt: number }>();
  const favoriteSet = new Set(favoriteIds);

  for (const book of books) {
    const progress = progressById.get(book.id);
    if (!progress || favoriteSet.has(book.id)) continue;
    readingById.set(book.id, { book, updatedAt: progress.updatedAt });
  }

  for (const [bookId, progress] of progressById) {
    if (favoriteSet.has(bookId) || booksById.has(bookId)) continue;
    readingById.set(bookId, {
      book: {
        id: bookId,
        title: progress.title || "Unknown title",
        author: progress.author || "Unknown author",
        epubUrl: "",
        format: "epub",
        unresolved: true,
      },
      updatedAt: progress.updatedAt,
    });
  }

  const reading = [...readingById.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ book }) => book);
  const openDisabledReason = (book: CatalogBook): string | null =>
    book.unresolved
      ? "Waiting for book metadata from Nostr favorites."
      : null;
  const query = favoriteQuery.trim().toLocaleLowerCase();
  const visibleFavorites = favorites.filter(
    (book) =>
      !query ||
      [book.title, book.author, book.year, getBookFormat(book)].some((value) =>
        value?.toLocaleLowerCase().includes(query),
      ),
  );
  const visibleExternalFavorites = externalFavorites.filter(
    (favorite) =>
      !query ||
      [favorite.title, favorite.author, favorite.year, favorite.format].some(
        (value) => value?.toLocaleLowerCase().includes(query),
      ),
  );

  return (
    <div className="library">
      <header className="library-header">
        <button
          className="brand-link"
          type="button"
          onClick={onHome}
          aria-label="Bookstr home"
        >
          <span className="brand-mark">
            <BookIcon />
          </span>
          <span className="brand-name">bookstr</span>
        </button>
        <div className="library-header-actions">
          <button
            className={`icon-button ${favoritesActive ? "active" : ""}`}
            type="button"
            onClick={onFavorites}
            aria-label="Favorites"
            aria-pressed={favoritesActive}
          >
            <HeartIcon filled={favoritesActive} />
          </button>
          <button
            className={`icon-button ${wordsActive ? "active" : ""}`}
            type="button"
            onClick={onWords}
            aria-label="Words"
            aria-pressed={wordsActive}
          >
            <WordsIcon />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onSettings}
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {loading && books.length === 0 && (
        <ul className="book-list" aria-label="Loading library">
          {Array.from({ length: 5 }, (_, index) => (
            <li key={index}>
              <div className="book-row book-row-placeholder">
                {index === 0 ? (
                  <span className="muted">Loading books…</span>
                ) : (
                  <span className="skeleton-line" aria-hidden="true" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(!loading || books.length > 0) && (
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
              openingBookId={openingBookId}
              openingBookMessage={openingBookMessage}
              openDisabledReason={openDisabledReason}
            />
          </section>

          <section className="book-shelf" aria-labelledby="favorites-heading">
            <h2 id="favorites-heading">Favorites</h2>
            {nostrFavoritesStatus !== "idle" &&
              (nostrFavoritesStatus === "error" ||
                nostrFavoritesStatus === "disconnected" ||
                (favorites.length === 0 && externalFavorites.length === 0)) && (
                <div
                  className={`shelf-sync ${nostrFavoritesStatus}`}
                  role="status"
                >
                  <span>{nostrFavoritesMessage}</span>
                  {(nostrFavoritesStatus === "error" ||
                    nostrFavoritesStatus === "disconnected" ||
                    nostrFavoritesStatus === "synced") && (
                    <button type="button" onClick={onRetryNostr}>
                      Retry
                    </button>
                  )}
                </div>
              )}
            {favorites.length > 0 || externalFavorites.length > 0 ? (
              <>
                <label className="favorite-search">
                  <span className="visually-hidden">Search favorites</span>
                  <input
                    type="search"
                    value={favoriteQuery}
                    onChange={(event) => setFavoriteQuery(event.target.value)}
                    placeholder="Search favorites"
                  />
                </label>
                {visibleFavorites.length === 0 &&
                  visibleExternalFavorites.length === 0 && (
                    <p className="muted shelf-empty">
                      No favorites match “{favoriteQuery.trim()}”.
                    </p>
                  )}
                {visibleFavorites.length > 0 && (
                  <BookRows
                    books={visibleFavorites}
                    empty=""
                    onOpen={onOpen}
                    onToggleFavorite={onToggleFavorite}
                    favoriteIds={favoriteIds}
                    progressById={progressById}
                    openingBookId={openingBookId}
                    openingBookMessage={openingBookMessage}
                    showPublicationStatus
                  />
                )}
                {visibleExternalFavorites.length > 0 && (
                  <ul className="book-list external-favorites">
                    {visibleExternalFavorites.map((favorite) => (
                      <li className="book-item" key={favorite.key}>
                        <a
                          className="book-row external-favorite"
                          href={favorite.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="book-title">{favorite.title}</span>
                          <span className="book-author">
                            {cleanAuthor(favorite.author)}
                            {favorite.year ? ` · ${favorite.year}` : ""}
                          </span>
                          <span className="book-publication">
                            {publicationLabel(
                              favorite.format ?? "epub",
                              favorite.blossomSha256,
                            )}
                          </span>
                          <span className="external-favorite-source">
                            LibVault <ExternalLinkIcon />
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}
          </section>

          <section className="book-shelf" aria-labelledby="words-heading">
            <h2 id="words-heading">Words</h2>
            {vocabulary.length === 0 ? (
              <p className="muted shelf-empty">
                Select a word while reading to look it up and save it here.
              </p>
            ) : (
              <ul className="word-list">
                {vocabulary.map((word) => (
                  <li className="word-item" key={word.key}>
                    <div className="word-heading">
                      <strong>{word.word}</strong>
                      {word.partOfSpeech && <span>{word.partOfSpeech}</span>}
                    </div>
                    <p>
                      {word.translation ??
                        word.definitions[0] ??
                        "No definition found"}
                    </p>
                    {word.contextSentence && (
                      <blockquote className="word-context-sentence">
                        “{word.contextSentence}”
                      </blockquote>
                    )}
                    <div className="word-context">
                      <span>{word.bookTitle}</span>
                      {word.lookupCount > 1 && (
                        <span>Looked up {word.lookupCount} times</span>
                      )}
                      <a
                        href={word.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${word.word} in Wiktionary`}
                      >
                        Wiktionary <ExternalLinkIcon />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Footer />
    </div>
  );
}
