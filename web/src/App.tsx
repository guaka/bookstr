import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Library } from "./components/Library";
import {
  fetchCatalog,
  catalogBookFromBlossomFavorite,
  downloadAndVerify,
  getBookFormat,
  getSetting,
  listProgress,
  listVocabulary,
  setSetting,
} from "./lib/catalog";
import { loadFavorites, saveFavorites } from "./lib/favorites";
import type {
  CatalogBook,
  ExternalFavorite,
  ReadingProgress,
  Theme,
  TranslationLanguage,
  VocabularyWord,
} from "./types";
import "./App.css";

const Reader = lazy(() =>
  import("./components/Reader").then((module) => ({ default: module.Reader })),
);
const PdfReader = lazy(() =>
  import("./components/PdfReader").then((module) => ({
    default: module.PdfReader,
  })),
);
const Settings = lazy(() =>
  import("./components/Settings").then((module) => ({
    default: module.Settings,
  })),
);

type Screen = "library" | "settings" | "reader";
type Route = {
  screen: Screen;
  bookId?: string;
  section?: "favorites" | "words";
  settingsOpen?: boolean;
};
type FavoritesSyncStatus =
  "idle" | "syncing" | "synced" | "disconnected" | "error";

const DEFAULT_CATALOG = `${import.meta.env.BASE_URL}catalog/catalog.json`;

function libvaultBookFromLocation(): CatalogBook | null {
  const params = new URLSearchParams(window.location.search);
  const md5 = (params.get("libvaultMd5") || "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(md5)) return null;
  return {
    id: md5,
    libvaultMd5: md5,
    title: params.get("title") || "LibVault EPUB",
    author: params.get("author") || "Unknown author",
    epubUrl: `/api/files/${md5}`,
    format: params.get("format") === "pdf" ? "pdf" : "epub",
    year: params.get("year") || undefined,
  };
}

const LIBVAULT_BOOK = libvaultBookFromLocation();

function routeFromHash(): Route {
  const path = window.location.hash.slice(1) || "/";
  if (path === "/settings") return { screen: "settings" };
  if (path === "/favorites") return { screen: "library", section: "favorites" };
  if (path === "/words") return { screen: "library", section: "words" };
  if (path.startsWith("/read/")) {
    try {
      const raw = path.slice("/read/".length);
      const settingsOpen = raw.endsWith("/settings");
      const encodedBookId = settingsOpen
        ? raw.slice(0, -"/settings".length)
        : raw;
      return {
        screen: "reader",
        bookId: decodeURIComponent(encodedBookId),
        settingsOpen,
      };
    } catch {
      return { screen: "library" };
    }
  }
  return { screen: "library" };
}

function navigate(path: string) {
  window.location.hash = path;
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [books, setBooks] = useState<CatalogBook[]>(
    LIBVAULT_BOOK ? [LIBVAULT_BOOK] : [],
  );
  const [loading, setLoading] = useState(!LIBVAULT_BOOK);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("white");
  const [translationLanguage, setTranslationLanguage] =
    useState<TranslationLanguage>("en");
  const [favoriteIds, setFavoriteIds] = useState(
    () => new Set(loadFavorites()),
  );
  const [externalFavorites, setExternalFavorites] = useState<
    ExternalFavorite[]
  >([]);
  const [progress, setProgress] = useState<ReadingProgress[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabularyWord[]>([]);
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);
  const [favoritesSync, setFavoritesSync] = useState<{
    status: FavoritesSyncStatus;
    message: string;
  }>({ status: "idle", message: "" });
  const progressById = useMemo(
    () => new Map(progress.map((item) => [item.bookId, item])),
    [progress],
  );

  const active = route.bookId
    ? (books.find((book) => book.id === route.bookId) ?? null)
    : null;

  const refresh = useCallback(async () => {
    if (LIBVAULT_BOOK) {
      setBooks([LIBVAULT_BOOK]);
      setLoading(false);
      return [LIBVAULT_BOOK];
    }
    setLoading(true);
    setError(null);
    try {
      const catalog = await fetchCatalog(DEFAULT_CATALOG);
      setBooks(catalog.books);
      return catalog.books;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBooks([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshProgress = useCallback(async () => {
    setProgress(await listProgress());
  }, []);

  const refreshVocabulary = useCallback(async () => {
    setVocabulary(
      (await listVocabulary()).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    );
  }, []);

  const syncNostr = useCallback(
    async (catalogBooks: CatalogBook[]): Promise<string> => {
      setFavoritesSync({
        status: "syncing",
        message: "Syncing Nostr favorites…",
      });
      try {
        const nostr = await import("./lib/nostr");
        const identity = await nostr.restorePreferredIdentity();
        if (!identity) {
          const message =
            "Nostr is not connected. Open Settings to connect your signer.";
          setFavoritesSync({ status: "disconnected", message });
          return message;
        }

        const shared = await nostr.pullSharedFavorites(catalogBooks);
        const blossomBooks = shared.external
          .map(catalogBookFromBlossomFavorite)
          .filter((book): book is CatalogBook => book !== null);
        const blossomMd5s = new Set(
          blossomBooks.map((book) => book.libvaultMd5),
        );
        setBooks((current) =>
          [...current, ...blossomBooks].filter(
            (book, index, all) =>
              all.findIndex((candidate) => candidate.id === book.id) === index,
          ),
        );
        setFavoriteIds((current) => {
          const merged = new Set([
            ...current,
            ...shared.bookIds,
            ...blossomBooks.map((book) => book.id),
          ]);
          saveFavorites(merged);
          return merged;
        });
        setExternalFavorites(
          shared.external.filter(
            (favorite) => !blossomMd5s.has(favorite.libvaultMd5),
          ),
        );
        const favoriteCount = shared.bookIds.length + shared.external.length;
        const message = `Nostr synced ${favoriteCount} LibVault favorite${favoriteCount === 1 ? "" : "s"}.`;
        setFavoritesSync({ status: "synced", message });

        try {
          await Promise.all([nostr.pullProgress(), nostr.pullVocabulary()]);
          await Promise.all([refreshProgress(), refreshVocabulary()]);
        } catch {
          // Favorites already synced; progress and words remain offline-first.
        }
        return message;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFavoritesSync({ status: "error", message });
        return message;
      }
    },
    [refreshProgress, refreshVocabulary],
  );

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#/`,
      );
    }
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (route.section === "favorites") {
      requestAnimationFrame(() =>
        document.getElementById("favorites-heading")?.scrollIntoView(),
      );
    }
    if (route.section === "words") {
      requestAnimationFrame(() =>
        document.getElementById("words-heading")?.scrollIntoView(),
      );
    }
  }, [route.section]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void (async () => {
      const catalogPromise = refresh();
      const [t, storedTranslationLanguage, loadedBooks] = await Promise.all([
        getSetting("theme", "white"),
        getSetting("translationLanguage", "en"),
        catalogPromise,
      ]);
      setTheme(t === "night" || t === "paper" ? t : "white");
      setTranslationLanguage(storedTranslationLanguage === "pt" ? "pt" : "en");
      try {
        // Let React paint the catalog before loading signer, relay, QR, and
        // crypto code. Sync stays automatic but no longer delays interactivity.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        await syncNostr(loadedBooks);
      } catch {
        /* catalog error is rendered; signer/relay failures remain offline-first */
      }
    })();
  }, [refresh, syncNostr]);

  if (route.screen === "reader" && active) {
    const isPdf = getBookFormat(active) === "pdf";
    return (
      <>
        <Suspense
          fallback={
            <div className={`route-loading theme-${theme}`}>Opening book…</div>
          }
        >
          {isPdf ? (
            <PdfReader
              book={active}
              catalogUrl={DEFAULT_CATALOG}
              onSettings={() =>
                navigate(`/read/${encodeURIComponent(active.id)}/settings`)
              }
              onClose={() => navigate("/")}
            />
          ) : (
            <Reader
              book={active}
              catalogUrl={DEFAULT_CATALOG}
              theme={theme}
              translationLanguage={translationLanguage}
              settingsOpen={Boolean(route.settingsOpen)}
              onSettings={() =>
                navigate(`/read/${encodeURIComponent(active.id)}/settings`)
              }
              onProgressSaved={(savedProgress) => {
                setProgress((current) => [
                  savedProgress,
                  ...current.filter(
                    (item) => item.bookId !== savedProgress.bookId,
                  ),
                ]);
              }}
              onVocabularySaved={(word) => {
                setVocabulary((current) => [
                  word,
                  ...current.filter((item) => item.key !== word.key),
                ]);
              }}
              onClose={() => {
                navigate("/");
                void Promise.all([refresh(), refreshVocabulary()]);
              }}
            />
          )}
        </Suspense>
        {route.settingsOpen && (
          <Suspense fallback={null}>
            <Settings
              theme={theme}
              translationLanguage={translationLanguage}
              onTranslationLanguage={(language) => {
                setTranslationLanguage(language);
                void setSetting("translationLanguage", language);
              }}
              onTheme={(t) => {
                setTheme(t);
                void setSetting("theme", t);
              }}
              onSync={() => syncNostr(books)}
              onBack={() => navigate(`/read/${encodeURIComponent(active.id)}`)}
            />
          </Suspense>
        )}
      </>
    );
  }

  if (route.screen === "settings") {
    return (
      <Suspense
        fallback={
          <div className={`route-loading theme-${theme}`}>
            Opening settings…
          </div>
        }
      >
        <Settings
          theme={theme}
          translationLanguage={translationLanguage}
          onTranslationLanguage={(language) => {
            setTranslationLanguage(language);
            void setSetting("translationLanguage", language);
          }}
          onTheme={(t) => {
            setTheme(t);
            void setSetting("theme", t);
          }}
          onSync={() => syncNostr(books)}
          onBack={() => {
            navigate("/");
            void refresh();
          }}
        />
      </Suspense>
    );
  }

  const toggleFavorite = (bookId: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      saveFavorites(next);
      return next;
    });
  };

  return (
    <Library
      books={books}
      loading={loading}
      error={error}
      openingBookId={openingBookId}
      favoriteIds={favoriteIds}
      progressById={progressById}
      externalFavorites={externalFavorites}
      vocabulary={vocabulary}
      favoritesActive={route.section === "favorites"}
      wordsActive={route.section === "words"}
      nostrFavoritesStatus={favoritesSync.status}
      nostrFavoritesMessage={favoritesSync.message}
      onHome={() => navigate("/")}
      onFavorites={() => navigate("/favorites")}
      onWords={() => navigate("/words")}
      onRetryNostr={() => void syncNostr(books)}
      onToggleFavorite={toggleFavorite}
      onSettings={() => navigate("/settings")}
      onOpen={(book) => {
        if (openingBookId) return;
        setOpeningBookId(book.id);
        void downloadAndVerify(book, DEFAULT_CATALOG)
          .then(() => navigate(`/read/${encodeURIComponent(book.id)}`))
          .catch((reason) =>
            setError(reason instanceof Error ? reason.message : String(reason)),
          )
          .finally(() => setOpeningBookId(null));
      }}
    />
  );
}
