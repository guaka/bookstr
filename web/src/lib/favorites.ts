import type { ExternalFavorite } from "../types";

const FAVORITES_KEY = "bookstr.favorites";
const NOSTR_FAVORITES_PREFIX = "bookstr.nostrFavorites.";

export type CachedNostrFavorites = {
  bookIds: string[];
  external: ExternalFavorite[];
};

export function loadFavorites(): string[] {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(FAVORITES_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: Iterable<string>): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
  } catch {
    // Favorites still work for this session when storage is disabled.
  }
}

export function loadNostrFavorites(npub: string): CachedNostrFavorites | null {
  if (!npub) return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(`${NOSTR_FAVORITES_PREFIX}${npub}`) ?? "null",
    ) as Partial<CachedNostrFavorites> | null;
    if (
      !parsed ||
      !Array.isArray(parsed.bookIds) ||
      !Array.isArray(parsed.external)
    ) {
      return null;
    }
    return {
      bookIds: parsed.bookIds.filter(
        (id): id is string => typeof id === "string",
      ),
      external: parsed.external.filter(
        (favorite): favorite is ExternalFavorite =>
          Boolean(favorite) &&
          typeof favorite === "object" &&
          typeof favorite.key === "string" &&
          typeof favorite.title === "string",
      ),
    };
  } catch {
    return null;
  }
}

export function saveNostrFavorites(
  npub: string,
  favorites: CachedNostrFavorites,
): void {
  if (!npub) return;
  try {
    window.localStorage.setItem(
      `${NOSTR_FAVORITES_PREFIX}${npub}`,
      JSON.stringify(favorites),
    );
  } catch {
    // Relay sync remains available when storage is disabled or full.
  }
}
