import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadAndVerify,
  catalogBookFromBlossomFavorite,
  fetchCatalog,
  getProgress,
  getBookFormat,
  getSetting,
  listProgress,
  resetCatalogDbForTests,
  resolveCatalogUrl,
  saveProgress,
  setSetting,
  sha256Hex,
} from "./catalog";
import type { CatalogBook } from "../types";

describe("catalog helpers", () => {
  beforeEach(async () => {
    await resetCatalogDbForTests();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await resetCatalogDbForTests();
  });

  it("persists settings and progress in IndexedDB", async () => {
    const localValues = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return localValues.size;
      },
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
      removeItem: (key: string) => localValues.delete(key),
      key: (index: number) => [...localValues.keys()][index] ?? null,
    });
    await setSetting("theme", "night");
    expect(localStorage.getItem("bookstr.setting.theme")).toBe("night");
    expect(await getSetting("theme")).toBe("night");
    expect(await getSetting("missing", "fallback")).toBe("fallback");

    const progress = {
      v: 1 as const,
      bookId: "abc",
      locator: { progression: 0.2 },
      updatedAt: 100,
    };
    await saveProgress(progress);
    expect(await getProgress("abc")).toEqual(progress);
    expect(await listProgress()).toHaveLength(1);
  });

  it("returns epubUrl unchanged when URL construction fails", () => {
    expect(resolveCatalogUrl("not a url", "also broken")).toBe("also broken");
  });

  it("fetchCatalog rejects non-OK and invalid payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    await expect(fetchCatalog("/catalog.json")).rejects.toThrow(
      "Catalog HTTP 503",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: 1 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(fetchCatalog("/catalog.json")).rejects.toThrow(
      "Invalid catalog.json",
    );
  });

  it("fetchCatalog returns books", async () => {
    const payload = {
      version: 1,
      books: [{ id: "aa", title: "T", author: "A", epubUrl: "./x.epub" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(fetchCatalog("/c.json")).resolves.toEqual(payload);
  });

  it("downloadAndVerify checks sha256 and caches", async () => {
    const bytes = new TextEncoder().encode("epub-bytes");
    const id = await sha256Hex(bytes.buffer);
    const book: CatalogBook = {
      id,
      title: "T",
      author: "A",
      epubUrl: "./books/x.epub",
    };

    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await downloadAndVerify(
      book,
      "https://books.example.org/catalog.json",
    );
    expect(await first.text()).toBe("epub-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await downloadAndVerify(
      book,
      "https://books.example.org/catalog.json",
    );
    expect(await second.text()).toBe("epub-bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downloadAndVerify rejects hash mismatches", async () => {
    const book: CatalogBook = {
      id: "0".repeat(64),
      title: "T",
      author: "A",
      epubUrl: "./books/x.epub",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new TextEncoder().encode("nope"), { status: 200 }),
      ),
    );
    await expect(
      downloadAndVerify(book, "https://books.example.org/catalog.json"),
    ).rejects.toThrow(/SHA-256 mismatch/);
  });

  it("caches a same-origin LibVault EPUB by MD5", async () => {
    const md5 = "13d8fb7e2afacb7f49811d40afb0d7c8";
    const book: CatalogBook = {
      id: md5,
      libvaultMd5: md5,
      title: "LibVault book",
      author: "Author",
      epubUrl: `/api/files/${md5}`,
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(new TextEncoder().encode("epub"), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await downloadAndVerify(
      book,
      "/bookstr/catalog/catalog.json",
    );
    expect(await first.text()).toBe("epub");
    await downloadAndVerify(book, "/bookstr/catalog/catalog.json");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("detects and caches a LibVault PDF", async () => {
    const md5 = "23d8fb7e2afacb7f49811d40afb0d7c8";
    const book: CatalogBook = {
      id: md5,
      libvaultMd5: md5,
      title: "LibVault PDF",
      author: "Author",
      epubUrl: `/api/files/${md5}`,
      format: "pdf",
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(new TextEncoder().encode("%PDF-1.7"), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(getBookFormat(book)).toBe("pdf");
    const first = await downloadAndVerify(
      book,
      "/bookstr/catalog/catalog.json",
    );
    expect(first.type).toBe("application/pdf");
    await downloadAndVerify(book, "/bookstr/catalog/catalog.json");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("turns a trusted Blossom PDF favorite into a readable catalog book", () => {
    expect(
      catalogBookFromBlossomFavorite({
        key: "favorite",
        title: "A PDF",
        detail: "An Author",
        author: "An Author",
        year: "2025",
        format: "pdf",
        libvaultMd5: "a".repeat(32),
        blossomSha256: "b".repeat(64),
        blossomUrl: `https://blossom.bfr.ee/${"b".repeat(64)}`,
      }),
    ).toMatchObject({
      id: "b".repeat(64),
      title: "A PDF",
      author: "An Author",
      year: "2025",
      format: "pdf",
    });
  });

  it("downloads and verifies a Blossom favorite that also has a LibVault MD5", async () => {
    const bytes = new TextEncoder().encode("blossom epub");
    const sha256 = await sha256Hex(bytes.buffer);
    const book: CatalogBook = {
      id: sha256,
      libvaultMd5: "a".repeat(32),
      blossomSha256: sha256,
      title: "Blossom book",
      author: "Author",
      epubUrl: `https://blossom.bfr.ee/${sha256}`,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { status: 200 })),
    );

    await expect(
      downloadAndVerify(book, "/catalog/catalog.json"),
    ).resolves.toBeInstanceOf(Blob);
  });

  it("rejects insecure Blossom favorite URLs", () => {
    expect(
      catalogBookFromBlossomFavorite({
        key: "favorite",
        title: "Nope",
        detail: "Unknown",
        blossomSha256: "b".repeat(64),
        blossomUrl: `http://blossom.example/${"b".repeat(64)}`,
      }),
    ).toBeNull();
  });
});
