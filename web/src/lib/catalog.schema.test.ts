import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA256_RE = /^[a-f0-9]{64}$/;
const here = dirname(fileURLToPath(import.meta.url));

describe("seed catalog.json", () => {
  it("ships without bundled example books", () => {
    const path = resolve(here, "../../../catalog/catalog.json");
    const catalog = JSON.parse(readFileSync(path, "utf8")) as {
      version: number;
      books: Array<{
        id: string;
        title: string;
        author: string;
        epubUrl: string;
      }>;
    };

    expect(catalog.version).toBe(1);
    expect(catalog.books).toEqual([]);

    for (const book of catalog.books) {
      expect(book.id).toMatch(SHA256_RE);
      expect(book.title.trim().length).toBeGreaterThan(0);
      expect(book.author.trim().length).toBeGreaterThan(0);
      expect(book.epubUrl.trim().length).toBeGreaterThan(0);
    }

    const ids = catalog.books.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
