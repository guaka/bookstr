import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { resetCatalogDbForTests, setSetting } from "./catalog";
import {
  clearIdentity,
  connectNip07,
  createBlossomDownloadAuthorization,
  getAuthMode,
  getRelays,
  hasNip07,
  restorePreferredIdentity,
  setNsec,
  setRelays,
  waitForNip07,
} from "./nostr";

describe("nostr identity helpers", () => {
  beforeEach(async () => {
    await resetCatalogDbForTests();
    Reflect.deleteProperty(window, "nostr");
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await resetCatalogDbForTests();
    Reflect.deleteProperty(window, "nostr");
  });

  it("parses relays from newlines and commas", async () => {
    await setRelays("wss://a.example\nwss://b.example, wss://c.example\n");
    expect(await getRelays()).toEqual([
      "wss://a.example",
      "wss://b.example",
      "wss://c.example",
    ]);
  });

  it("stores and clears nsec mode", async () => {
    const sk = generateSecretKey();
    const nsec = nip19.nsecEncode(sk);
    const npub = await setNsec(nsec);
    expect(npub).toBe(nip19.npubEncode(getPublicKey(sk)));
    expect(await getAuthMode()).toBe("nsec");

    await clearIdentity();
    expect(await getAuthMode()).toBe("none");
    expect(await setNsec("")).toBe("");
  });

  it("rejects non-nsec secrets", async () => {
    await expect(
      setNsec("npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"),
    ).rejects.toThrow(/Expected nsec/);
  });

  it("detects NIP-07 availability", async () => {
    expect(hasNip07()).toBe(false);
    window.nostr = {
      getPublicKey: async () => "ab",
      signEvent: async (e) => ({ ...e, id: "1", pubkey: "ab", sig: "s" }),
    };
    expect(hasNip07()).toBe(true);
    expect(await waitForNip07(50)).toBe(true);
  });

  it("detects a Firefox signer injected after page load", async () => {
    window.setTimeout(() => {
      window.nostr = {
        getPublicKey: async () => "ab",
        signEvent: async (event) => ({
          ...event,
          id: "1",
          pubkey: "ab",
          sig: "s",
        }),
      };
    }, 25);
    await expect(waitForNip07(500)).resolves.toBe(true);
  });

  it("creates a signed Blossom download authorization with NIP-07", async () => {
    const pubkey = getPublicKey(generateSecretKey());
    window.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: vi.fn(async (event) => ({
        ...event,
        id: "1",
        pubkey,
        sig: "s",
      })),
    };
    await connectNip07();
    const value = await createBlossomDownloadAuthorization(
      "a".repeat(64),
      "blossom.bfr.ee",
    );
    expect(value.startsWith("Nostr ")).toBe(true);
    const event = JSON.parse(atob(value.slice(6))) as {
      kind: number;
      tags: string[][];
    };
    expect(event.kind).toBe(24242);
    expect(event.tags).toContainEqual(["t", "get"]);
    expect(event.tags).toContainEqual(["server", "blossom.bfr.ee"]);
    expect(event.tags).toContainEqual(["x", "a".repeat(64)]);
  });

  it("automatically prefers an available NIP-07 signer", async () => {
    const extensionKey = getPublicKey(generateSecretKey());
    window.nostr = {
      getPublicKey: vi.fn(async () => extensionKey),
      signEvent: async (event) => ({
        ...event,
        id: "1",
        pubkey: extensionKey,
        sig: "s",
      }),
    };

    const identity = await restorePreferredIdentity();
    expect(identity?.mode).toBe("nip07");
    expect(identity?.npub).toBe(nip19.npubEncode(extensionKey));
    expect(await getAuthMode()).toBe("nip07");
  });

  it("reads authMode from settings", async () => {
    await setSetting("authMode", "nip46");
    expect(await getAuthMode()).toBe("nip46");
    await setSetting("authMode", "bogus");
    expect(await getAuthMode()).toBe("none");
  });
});
