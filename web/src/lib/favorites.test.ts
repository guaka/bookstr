import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNostrFavorites,
  saveNostrFavorites,
  type CachedNostrFavorites,
} from "./favorites";

describe("Nostr favorites cache", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it("stores favorites separately for each Nostr identity", () => {
    const favorites: CachedNostrFavorites = {
      bookIds: ["book-1"],
      external: [{ key: "external-1", title: "Cached book", detail: "Author" }],
    };

    saveNostrFavorites("npub-one", favorites);

    expect(loadNostrFavorites("npub-one")).toEqual(favorites);
    expect(loadNostrFavorites("npub-two")).toBeNull();
  });
});
