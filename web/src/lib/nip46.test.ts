import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCatalogDbForTests } from "./catalog";
import { buildNostrConnectUri, getNip46ClientName, NIP46_PERMS } from "./nostr";

beforeEach(async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
  });
  await resetCatalogDbForTests();
});

describe("buildNostrConnectUri", () => {
  it("builds a nostrconnect URI with relays, secret, and progress perms", () => {
    const pubkey = "a".repeat(64);
    const uri = buildNostrConnectUri({
      clientPubkey: pubkey,
      relays: ["wss://relay.damus.io", "wss://nos.lol"],
      secret: "deadbeef",
      name: "bookstr",
      url: "https://bookstr.example",
    });

    expect(uri.startsWith(`nostrconnect://${pubkey}?`)).toBe(true);
    const parsed = new URL(uri);
    expect(parsed.protocol).toBe("nostrconnect:");
    expect(parsed.searchParams.get("secret")).toBe("deadbeef");
    expect(parsed.searchParams.getAll("relay")).toEqual([
      "wss://relay.damus.io",
      "wss://nos.lol",
    ]);
    expect(parsed.searchParams.get("name")).toBe("bookstr");
    expect(parsed.searchParams.get("url")).toBe("https://bookstr.example");
    const perms = parsed.searchParams.get("perms") ?? "";
    for (const p of NIP46_PERMS) {
      expect(perms.split(",")).toContain(p);
    }
  });
});

describe("getNip46ClientName", () => {
  it("returns a stable, recognizable name for this browser profile", async () => {
    const first = await getNip46ClientName();
    const second = await getNip46ClientName();

    expect(second).toBe(first);
    expect(first).toMatch(/^bookstr web · .+\/.+ · [a-f0-9]{6}$/);
  });
});
