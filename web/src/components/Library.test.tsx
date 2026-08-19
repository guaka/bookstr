import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Library } from "../components/Library";
import type { CatalogBook } from "../types";

const books: CatalogBook[] = [
  {
    id: "1",
    title: "Little Brother",
    author: "Cory Doctorow",
    license: "CC BY-NC-SA 3.0",
    epubUrl: "./books/1.epub",
  },
];

describe("Library", () => {
  it("renders books and wires actions", () => {
    const onOpen = vi.fn();
    const onSettings = vi.fn();

    render(
      <Library
        books={books}
        loading={false}
        error={null}
        onOpen={onOpen}
        onSettings={onSettings}
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set(["1"])}
        progressById={new Map()}
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive={false}
        wordsActive={false}
        nostrFavoritesStatus="idle"
        nostrFavoritesMessage=""
        onRetryNostr={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Bookstr home" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Favorites" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reading" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Examples" })).toBeNull();
    expect(screen.getByText("Little Brother")).toBeTruthy();
    expect(screen.getByText("Cory Doctorow")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Bookstr on GitHub" })
        .getAttribute("href"),
    ).toBe("https://github.com/guaka/bookstr");
    expect(screen.getByText(/^(Development build|Built .+ UTC)$/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSettings).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();

    fireEvent.click(screen.getByText("Little Brother").closest("button")!);
    expect(onOpen).toHaveBeenCalledWith(books[0]);
  });

  it("shows loading and empty states", () => {
    const { rerender } = render(
      <Library
        books={[]}
        loading
        error={null}
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set()}
        progressById={new Map()}
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive={false}
        wordsActive={false}
        nostrFavoritesStatus="idle"
        nostrFavoritesMessage=""
        onRetryNostr={vi.fn()}
      />,
    );
    expect(screen.getByText(/Loading catalog/)).toBeTruthy();

    rerender(
      <Library
        books={[]}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set()}
        progressById={new Map()}
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive={false}
        wordsActive={false}
        nostrFavoritesStatus="idle"
        nostrFavoritesMessage=""
        onRetryNostr={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/Heart a book/).length).toBeGreaterThan(0);

    rerender(
      <Library
        books={[]}
        loading={false}
        error="boom"
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set()}
        progressById={new Map()}
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive={false}
        wordsActive={false}
        nostrFavoritesStatus="idle"
        nostrFavoritesMessage=""
        onRetryNostr={vi.fn()}
      />,
    );
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("shows a retry when Nostr favorites fail to sync", () => {
    const onRetryNostr = vi.fn();
    render(
      <Library
        books={books}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set()}
        progressById={new Map()}
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive={false}
        wordsActive={false}
        nostrFavoritesStatus="error"
        nostrFavoritesMessage="Could not read LibVault favorites"
        onRetryNostr={onRetryNostr}
      />,
    );

    expect(screen.getByText("Could not read LibVault favorites")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryNostr).toHaveBeenCalledTimes(1);
  });

  it("searches favorites and shows metadata, Blossom, and progress", () => {
    const favoriteBooks: CatalogBook[] = [
      {
        ...books[0],
        year: "2008",
        format: "epub",
        blossomSha256: "a".repeat(64),
      },
      {
        id: "2",
        title: "Another Book",
        author: "Someone",
        epubUrl: "./books/2.epub",
      },
    ];
    const { container } = render(
      <Library
        books={favoriteBooks}
        loading={false}
        error={null}
        onOpen={vi.fn()}
        onSettings={vi.fn()}
        onFavorites={vi.fn()}
        onWords={vi.fn()}
        onHome={vi.fn()}
        onToggleFavorite={vi.fn()}
        favoriteIds={new Set(["1", "2"])}
        progressById={
          new Map([
            [
              "1",
              {
                v: 1,
                bookId: "1",
                locator: { progression: 0.42 },
                updatedAt: 1,
              },
            ],
          ])
        }
        externalFavorites={[]}
        vocabulary={[]}
        favoritesActive
        wordsActive={false}
        nostrFavoritesStatus="synced"
        nostrFavoritesMessage="Synced"
        onRetryNostr={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Cory Doctorow · 2008").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("EPUB · On Blossom").length).toBeGreaterThan(0);
    expect(screen.getAllByText("42% read").length).toBeGreaterThan(0);
    fireEvent.change(
      container.querySelector('input[placeholder="Search favorites"]')!,
      {
        target: { value: "another" },
      },
    );
    const shelf = container.querySelector(
      'section[aria-labelledby="favorites-heading"]',
    )!;
    expect(shelf.textContent).toContain("Another Book");
    expect(shelf.textContent).not.toContain("Little Brother");
  });
});
