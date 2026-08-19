import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  nip44,
  SimplePool,
  type EventTemplate,
  type VerifiedEvent,
} from "nostr-tools";
import {
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
  toBunkerURL,
} from "nostr-tools/nip46";
import QRCode from "qrcode";
import type {
  BookFormat,
  CatalogBook,
  ExternalFavorite,
  ReadingProgress,
  VocabularyWord,
} from "../types";
import {
  getSetting,
  listProgress,
  listVocabulary,
  saveProgress,
  saveVocabularyWord,
  deleteVocabularyWord,
  setSetting,
} from "./catalog";
import { normalizeProgress, progressDTag } from "./progress";

const KIND = 30078;
const D_PREFIX = "app.bookstr.progress.";
const FAVORITES_KIND = 30003;
const BLOSSOM_AUTH_KIND = 24242;
const FAVORITES_D_TAG = "libvault-favorites";
const VOCABULARY_D_PREFIX = "app.bookstr.vocabulary.";

export const DEFAULT_RELAYS = ["wss://relay.nomadwiki.org"];

export type AuthMode = "nip07" | "nip46" | "nsec" | "none";

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: {
        kind: number;
        created_at: number;
        tags: string[][];
        content: string;
      }): Promise<{
        id: string;
        pubkey: string;
        created_at: number;
        kind: number;
        tags: string[][];
        content: string;
        sig: string;
      }>;
      nip44?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
    };
  }
}

function dTag(bookId: string) {
  return progressDTag(bookId);
}

export function hasNip07(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.nostr?.getPublicKey === "function"
  );
}

/** Wait briefly for extensions that inject after page load. */
export async function waitForNip07(timeoutMs = 5_000): Promise<boolean> {
  if (hasNip07()) return true;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (available: boolean) => {
      if (finished) return;
      finished = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("nostr:ready", check);
      resolve(available);
    };
    const check = () => {
      if (hasNip07()) finish(true);
    };
    const poll = window.setInterval(check, 100);
    const timeout = window.setTimeout(() => finish(hasNip07()), timeoutMs);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    // Several signers announce late injection with this de-facto event.
    window.addEventListener("nostr:ready", check);
    check();
  });
}

export async function getNsec(): Promise<string> {
  return getSetting("nsec");
}

export async function getNpub(): Promise<string> {
  return getSetting("npub");
}

export async function getAuthMode(): Promise<AuthMode> {
  const mode = await getSetting("authMode");
  if (mode === "nip07" || mode === "nip46" || mode === "nsec") return mode;
  return "none";
}

export async function getRelays(): Promise<string[]> {
  const raw = await getSetting("relays", DEFAULT_RELAYS.join("\n"));
  return raw
    .split(/[\n,]+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

export async function setRelays(text: string): Promise<void> {
  await setSetting("relays", text);
}

function hexToNpub(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex);
}

function secretFromNsec(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") throw new Error("Invalid nsec");
  return decoded.data as Uint8Array;
}

function randomConnectSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function browserName(): string {
  if (typeof navigator === "undefined") return "Browser";
  const nav = navigator as Navigator & { brave?: unknown };
  const ua = nav.userAgent;
  if (nav.brave) return "Brave";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return "Browser";
}

function platformName(): string {
  if (typeof navigator === "undefined") return "Device";
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  if (/android/i.test(platform)) return "Android";
  if (/iphone|ipad|ipod/i.test(platform)) return "iOS";
  if (/mac/i.test(platform)) return "macOS";
  if (/win/i.test(platform)) return "Windows";
  if (/linux/i.test(platform)) return "Linux";
  return "Device";
}

/** Stable, recognizable name for this browser profile in a remote signer. */
export async function getNip46ClientName(): Promise<string> {
  let id = await getSetting("nip46ClientId");
  if (!/^[a-f0-9]{6}$/i.test(id)) {
    id = [...crypto.getRandomValues(new Uint8Array(3))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await setSetting("nip46ClientId", id);
  }
  return `bookstr web · ${browserName()}/${platformName()} · ${id.toLowerCase()}`;
}

function withSignerTimeout<T>(
  promise: Promise<T>,
  message: string,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error(message)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Permissions requested from remote signers (Amber, etc.). */
export const NIP46_PERMS = [
  `sign_event:${KIND}`,
  `sign_event:${FAVORITES_KIND}`,
  `sign_event:${BLOSSOM_AUTH_KIND}`,
  "nip44_encrypt",
  "nip44_decrypt",
  "get_public_key",
] as const;

export function buildNostrConnectUri(params: {
  clientPubkey: string;
  relays: string[];
  secret: string;
  name?: string;
  url?: string;
}): string {
  return createNostrConnectURI({
    clientPubkey: params.clientPubkey,
    relays: params.relays,
    secret: params.secret,
    perms: [...NIP46_PERMS],
    name: params.name ?? "bookstr",
    url: params.url,
  });
}

let bunkerSigner: BunkerSigner | null = null;
let bunkerPool: SimplePool | null = null;
let bunkerRelays: string[] = [];
let nip07Pubkey: string | null = null;

async function closeBunker(): Promise<void> {
  if (bunkerSigner) {
    try {
      await bunkerSigner.close();
    } catch {
      /* ignore */
    }
    bunkerSigner = null;
  }
  if (bunkerPool) {
    try {
      bunkerPool.close(bunkerRelays);
    } catch {
      /* ignore */
    }
    bunkerPool = null;
    bunkerRelays = [];
  }
}

async function persistNip46(
  signer: BunkerSigner,
  clientSk: Uint8Array,
): Promise<string> {
  const pubkey = await signer.getPublicKey();
  const npub = hexToNpub(pubkey);
  await setSetting("nip46ClientNsec", nip19.nsecEncode(clientSk));
  await setSetting("bunkerUrl", toBunkerURL(signer.bp));
  await setSetting("npub", npub);
  await setSetting("nsec", "");
  await setSetting("authMode", "nip46");
  return npub;
}

async function getBunkerSigner(): Promise<BunkerSigner | null> {
  if (bunkerSigner) return bunkerSigner;
  const mode = await getAuthMode();
  if (mode !== "nip46") return null;

  const clientNsec = await getSetting("nip46ClientNsec");
  const bunkerUrl = await getSetting("bunkerUrl");
  if (!clientNsec || !bunkerUrl) return null;

  const bp = await parseBunkerInput(bunkerUrl);
  if (!bp) throw new Error("Stored bunker URL is invalid");

  const pool = new SimplePool();
  const signer = BunkerSigner.fromBunker(secretFromNsec(clientNsec), bp, {
    pool,
  });
  bunkerSigner = signer;
  bunkerPool = pool;
  bunkerRelays = bp.relays.length > 0 ? bp.relays : await getRelays();
  return signer;
}

/** Prefer NIP-07; only store nsec when the user explicitly pastes one. */
export async function connectNip07(): Promise<{
  npub: string;
  mode: AuthMode;
}> {
  const ok = await waitForNip07();
  if (!ok || !window.nostr) throw new Error("No NIP-07 extension found");
  await closeBunker();
  const pubkey = await withSignerTimeout(
    window.nostr.getPublicKey(),
    "NIP-07 signer did not return control to the page",
  );
  if (!/^[a-f0-9]{64}$/i.test(pubkey))
    throw new Error("NIP-07 signer returned an invalid public key");
  nip07Pubkey = pubkey;
  const npub = hexToNpub(pubkey);
  await setSetting("authMode", "nip07");
  await setSetting("npub", npub);
  await setSetting("nsec", "");
  await setSetting("nip46ClientNsec", "");
  await setSetting("bunkerUrl", "");
  return { npub, mode: "nip07" };
}

export type Nip46QrSession = {
  name: string;
  uri: string;
  qrDataUrl: string;
  cancel: () => void;
  done: Promise<{ npub: string; mode: AuthMode }>;
};

/**
 * Client-initiated NIP-46 connect: show `qrDataUrl` / `uri` for Amber to scan,
 * then await `done` (or call `cancel`).
 */
export async function startNip46QrConnect(
  timeoutMs = 300_000,
): Promise<Nip46QrSession> {
  await closeBunker();
  const relays = await getRelays();
  if (relays.length === 0)
    throw new Error("Add at least one relay before connecting");

  const clientSk = generateSecretKey();
  const secret = randomConnectSecret();
  const name = await getNip46ClientName();
  const uri = buildNostrConnectUri({
    clientPubkey: getPublicKey(clientSk),
    relays,
    secret,
    name,
    url: typeof window !== "undefined" ? window.location.origin : undefined,
  });
  const qrSvg = await withSignerTimeout(
    QRCode.toString(uri, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 280,
      color: { dark: "#1c1916", light: "#fffaf2" },
    }),
    "QR generation timed out",
    5_000,
  );
  const qrDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`;

  const pool = new SimplePool();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  const done = (async () => {
    try {
      const signer = await BunkerSigner.fromURI(
        clientSk,
        uri,
        { pool },
        ac.signal,
      );
      bunkerSigner = signer;
      bunkerPool = pool;
      bunkerRelays = relays;
      const npub = await persistNip46(signer, clientSk);
      return { npub, mode: "nip46" as AuthMode };
    } catch (e) {
      try {
        pool.close(relays);
      } catch {
        /* ignore */
      }
      if (ac.signal.aborted)
        throw new Error("NIP-46 connect cancelled or timed out");
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      clearTimeout(timer);
    }
  })();

  return {
    name,
    uri,
    qrDataUrl,
    cancel: () => ac.abort(),
    done,
  };
}

/** Bunker-initiated connect: paste `bunker://…` or a NIP-05 bunker identifier. */
export async function connectBunkerInput(
  input: string,
): Promise<{ npub: string; mode: AuthMode }> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Paste a bunker:// URI or bunker NIP-05");
  const bp = await parseBunkerInput(trimmed);
  if (!bp) throw new Error("Invalid bunker URI or NIP-05");

  await closeBunker();
  const clientSk = generateSecretKey();
  const pool = new SimplePool();
  const relays = bp.relays.length > 0 ? bp.relays : await getRelays();
  const signer = BunkerSigner.fromBunker(clientSk, bp, { pool });
  try {
    await signer.connect({
      name: await getNip46ClientName(),
      url: typeof window !== "undefined" ? window.location.origin : undefined,
    });
    bunkerSigner = signer;
    bunkerPool = pool;
    bunkerRelays = relays;
    const npub = await persistNip46(signer, clientSk);
    return { npub, mode: "nip46" };
  } catch (e) {
    try {
      pool.close(relays);
    } catch {
      /* ignore */
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Rehydrate a stored NIP-46 session after reload. */
export async function restoreNip46(): Promise<{
  npub: string;
  mode: AuthMode;
} | null> {
  if ((await getAuthMode()) !== "nip46") return null;
  const signer = await getBunkerSigner();
  if (!signer) return null;
  const pubkey = await signer.getPublicKey();
  const npub = hexToNpub(pubkey);
  await setSetting("npub", npub);
  return { npub, mode: "nip46" };
}

/** Prefer an injected browser signer, then restore the previously selected remote signer. */
export async function restorePreferredIdentity(): Promise<{
  npub: string;
  mode: AuthMode;
} | null> {
  const mode = await getAuthMode();
  if (await waitForNip07()) {
    try {
      return await connectNip07();
    } catch {
      // If the extension declines or is unavailable, preserve the configured fallback.
    }
  }
  return mode === "nip46" ? restoreNip46() : null;
}

export async function setNsec(nsec: string): Promise<string> {
  const trimmed = nsec.trim();
  if (!trimmed) {
    await clearIdentity();
    return "";
  }
  if (!trimmed.startsWith("nsec")) throw new Error("Expected nsec… bech32");
  await closeBunker();
  const sk = secretFromNsec(trimmed);
  const npub = nip19.npubEncode(getPublicKey(sk));
  await setSetting("nsec", trimmed);
  await setSetting("npub", npub);
  await setSetting("authMode", "nsec");
  await setSetting("nip46ClientNsec", "");
  await setSetting("bunkerUrl", "");
  return npub;
}

export async function clearIdentity(): Promise<void> {
  if (bunkerSigner) {
    try {
      await bunkerSigner.logout();
    } catch {
      /* ignore */
    }
  }
  await closeBunker();
  nip07Pubkey = null;
  await setSetting("nsec", "");
  await setSetting("npub", "");
  await setSetting("nip46ClientNsec", "");
  await setSetting("bunkerUrl", "");
  await setSetting("authMode", "none");
}

/** Prefer an injected browser signer, then use the configured fallback. */
export async function resolvePubkey(): Promise<string | null> {
  const mode = await getAuthMode();
  const nsec = await getNsec();

  if (hasNip07()) {
    if (nip07Pubkey) return nip07Pubkey;
    try {
      const { npub } = await connectNip07();
      const decoded = nip19.decode(npub);
      if (decoded.type !== "npub") return null;
      return decoded.data as string;
    } catch {
      return null;
    }
  }

  if (mode === "nip46") {
    try {
      const signer = await getBunkerSigner();
      if (!signer) return null;
      return await signer.getPublicKey();
    } catch {
      return null;
    }
  }

  if (mode === "nsec" && nsec) {
    return getPublicKey(secretFromNsec(nsec));
  }

  // Legacy: nsec stored without authMode
  if (nsec && mode === "none") {
    return getPublicKey(secretFromNsec(nsec));
  }

  return null;
}

async function signTemplate(template: EventTemplate): Promise<VerifiedEvent> {
  const mode = await getAuthMode();
  const nsec = await getNsec();

  if (hasNip07()) {
    if (!window.nostr) throw new Error("NIP-07 unavailable");
    if (!nip07Pubkey || mode !== "nip07") await connectNip07();
    const signed = await withSignerTimeout(
      window.nostr.signEvent(template),
      "Nostr signer did not approve the request",
      20_000,
    );
    return signed as VerifiedEvent;
  }

  if (mode === "nip46") {
    const signer = await getBunkerSigner();
    if (!signer) throw new Error("NIP-46 bunker not connected");
    return withSignerTimeout(
      signer.signEvent(template),
      "Remote signer did not approve the request",
      20_000,
    );
  }

  if (!nsec) throw new Error("No Nostr identity");
  return finalizeEvent(template, secretFromNsec(nsec));
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** BUD-11 authorization for downloading a private Blossom blob. */
export async function createBlossomDownloadAuthorization(
  hash: string,
  server: string,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Invalid Blossom SHA-256");
  if (!server || server.includes("/"))
    throw new Error("Invalid Blossom server");
  const now = Math.floor(Date.now() / 1000);
  const event = await signTemplate({
    kind: BLOSSOM_AUTH_KIND,
    created_at: now,
    tags: [
      ["t", "get"],
      ["expiration", String(now + 120)],
      ["server", server],
      ["x", hash.toLowerCase()],
    ],
    content: "Download a LibVault book",
  });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
}

async function decryptFromSelf(
  pubkey: string,
  ciphertext: string,
): Promise<string> {
  const mode = await getAuthMode();
  const nsec = await getNsec();

  if (window.nostr?.nip44?.decrypt) {
    return window.nostr.nip44.decrypt(pubkey, ciphertext);
  }

  if (mode === "nip46") {
    const signer = await getBunkerSigner();
    if (!signer) throw new Error("NIP-46 bunker not connected");
    return signer.nip44Decrypt(pubkey, ciphertext);
  }

  if (nsec) {
    const conversationKey = nip44.getConversationKey(
      secretFromNsec(nsec),
      pubkey,
    );
    return nip44.decrypt(ciphertext, conversationKey);
  }

  throw new Error("The active signer does not provide NIP-44 decryption");
}

async function encryptToSelf(
  pubkey: string,
  plaintext: string,
): Promise<string> {
  const mode = await getAuthMode();
  const nsec = await getNsec();

  if (window.nostr?.nip44?.encrypt) {
    return window.nostr.nip44.encrypt(pubkey, plaintext);
  }

  if (mode === "nip46") {
    const signer = await getBunkerSigner();
    if (!signer) throw new Error("NIP-46 bunker not connected");
    return signer.nip44Encrypt(pubkey, plaintext);
  }

  if (nsec) {
    const conversationKey = nip44.getConversationKey(
      secretFromNsec(nsec),
      pubkey,
    );
    return nip44.encrypt(plaintext, conversationKey);
  }

  throw new Error("The active signer does not provide NIP-44 encryption");
}

type SharedFavoriteRef = {
  bookstrId?: string;
  libvaultMd5?: string;
  isbn?: string;
  url?: string;
  title?: string;
  author?: string;
  year?: string;
  format?: BookFormat;
  blossomSha256?: string;
  blossomUrl?: string;
};

function normalizeIsbn(value?: string) {
  const normalized = value?.replace(/[^0-9X]/gi, "").toUpperCase() ?? "";
  return normalized.length === 10 || normalized.length === 13 ? normalized : "";
}

export function parseSharedFavoriteTags(value: unknown): SharedFavoriteRef[] {
  if (!Array.isArray(value)) return [];
  const refs: SharedFavoriteRef[] = [];
  let pendingUrl: string | undefined;
  let current: SharedFavoriteRef | undefined;

  for (const item of value) {
    if (!Array.isArray(item) || typeof item[0] !== "string") continue;
    const tag = item.filter((part): part is string => typeof part === "string");
    if (tag[0] === "r" && tag[1]) {
      pendingUrl = tag[1];
      continue;
    }
    if (tag[0] === "libvault" && /^[a-f0-9]{32}$/i.test(tag[1] ?? "")) {
      current = { libvaultMd5: tag[1].toLowerCase(), url: pendingUrl };
      refs.push(current);
      pendingUrl = undefined;
      continue;
    }
    if (tag[0] === "bookstr" && tag[1]) {
      current = {
        bookstrId: tag[1],
        title: tag[2] || undefined,
        author: tag[3] || undefined,
        url: tag[4] || pendingUrl,
      };
      refs.push(current);
      pendingUrl = undefined;
      continue;
    }
    if (tag[0] === "libvault-book" && /^[a-f0-9]{32}$/i.test(tag[1] ?? "")) {
      const md5 = tag[1].toLowerCase();
      current = refs.find((ref) => ref.libvaultMd5 === md5) ?? {
        libvaultMd5: md5,
      };
      if (!refs.includes(current)) refs.push(current);
      current.title = tag[2] || current.title;
      current.author = tag[3] || current.author;
      if (tag[4] === "pdf" || tag[4] === "epub") current.format = tag[4];
      if (tag[6]) current.year = tag[6];
      continue;
    }
    if (tag[0] === "blossom" && /^[a-f0-9]{32}$/i.test(tag[1] ?? "")) {
      const md5 = tag[1].toLowerCase();
      current = refs.find((ref) => ref.libvaultMd5 === md5);
      if (current) {
        current.blossomSha256 = tag[2] || current.blossomSha256;
        current.blossomUrl = tag[3] || current.blossomUrl;
        if (tag[4] === "pdf" || tag[4] === "epub") current.format = tag[4];
      }
      continue;
    }
    if (tag[0] === "i" && tag[1]?.startsWith("isbn:")) {
      const isbn = normalizeIsbn(tag[1].slice(5));
      if (!isbn) continue;
      if (current) {
        current.isbn = isbn;
        current.url ??= tag[2];
      } else {
        current = { isbn, url: tag[2] || pendingUrl };
        refs.push(current);
      }
      pendingUrl = undefined;
    }
  }

  return refs;
}

export function matchSharedFavorites(
  refs: SharedFavoriteRef[],
  books: CatalogBook[],
): { bookIds: string[]; external: ExternalFavorite[] } {
  const matched = new Set<string>();
  const external = new Map<string, ExternalFavorite>();

  for (const ref of refs) {
    const isbn = normalizeIsbn(ref.isbn);
    const book = books.find(
      (candidate) =>
        candidate.id === ref.bookstrId ||
        (ref.libvaultMd5 &&
          candidate.libvaultMd5?.toLowerCase() === ref.libvaultMd5) ||
        (isbn && normalizeIsbn(candidate.isbn) === isbn) ||
        (ref.url && candidate.sourceUrl === ref.url),
    );
    if (book) {
      matched.add(book.id);
      continue;
    }

    const key = ref.libvaultMd5 ?? ref.bookstrId ?? isbn ?? ref.url;
    if (!key) continue;
    external.set(key, {
      key,
      title: ref.title || "LibVault favorite",
      detail:
        ref.author ||
        (ref.libvaultMd5
          ? `Edition ${ref.libvaultMd5.slice(0, 8)}…`
          : isbn
            ? `ISBN ${isbn}`
            : "Saved on Nostr"),
      author: ref.author,
      url: ref.url,
      isbn: isbn || undefined,
      libvaultMd5: ref.libvaultMd5,
      year: ref.year,
      format: ref.format,
      blossomSha256: ref.blossomSha256,
      blossomUrl: ref.blossomUrl,
    });
  }

  return { bookIds: [...matched], external: [...external.values()] };
}

/** Read LibVault's private NIP-51 bookmark set without replacing it. */
export async function pullSharedFavorites(books: CatalogBook[]): Promise<{
  bookIds: string[];
  external: ExternalFavorite[];
}> {
  const pubkey = await resolvePubkey();
  if (!pubkey) return { bookIds: [], external: [] };

  // LibVault publishes this shared list to its interoperability relay even
  // when Bookstr uses another relay set for progress and saved words.
  const relays = [...new Set([...(await getRelays()), ...DEFAULT_RELAYS])];
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(
      relays,
      {
        kinds: [FAVORITES_KIND],
        authors: [pubkey],
        "#d": [FAVORITES_D_TAG],
      },
      { maxWait: 5000 },
    );
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest) return { bookIds: [], external: [] };
    const plaintext = await decryptFromSelf(pubkey, latest.content);
    return matchSharedFavorites(
      parseSharedFavoriteTags(JSON.parse(plaintext)),
      books,
    );
  } catch (error) {
    throw new Error(
      `Could not read LibVault favorites: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    pool.close(relays);
  }
}

export async function publishProgress(
  progress: ReadingProgress,
): Promise<void> {
  const pubkey = await resolvePubkey();
  if (!pubkey) return;

  const relays = await getRelays();
  const template: EventTemplate = {
    kind: KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", dTag(progress.bookId)]],
    content: JSON.stringify(progress),
  };
  const event = await signTemplate(template);
  const pool = new SimplePool();
  try {
    await Promise.any(pool.publish(relays, event));
  } finally {
    pool.close(relays);
  }
}

function validVocabularyWord(value: unknown): value is VocabularyWord {
  if (!value || typeof value !== "object") return false;
  const word = value as Partial<VocabularyWord>;
  return (
    typeof word.key === "string" &&
    typeof word.word === "string" &&
    typeof word.language === "string" &&
    typeof word.syncId === "string" &&
    Array.isArray(word.definitions) &&
    word.definitions.every((definition) => typeof definition === "string") &&
    typeof word.bookId === "string" &&
    typeof word.bookTitle === "string" &&
    typeof word.updatedAt === "number"
  );
}

export async function publishVocabularyWord(
  word: VocabularyWord,
): Promise<void> {
  const pubkey = await resolvePubkey();
  if (!pubkey) return;
  const content = await encryptToSelf(pubkey, JSON.stringify(word));
  const event = await signTemplate({
    kind: KIND,
    created_at: Math.floor(Date.now() / 1000),
    // A random stable identifier avoids leaking a dictionary-attackable hash
    // of the word in the otherwise encrypted event's public tags.
    tags: [["d", `${VOCABULARY_D_PREFIX}${word.syncId}`]],
    content,
  });
  const relays = await getRelays();
  const pool = new SimplePool();
  try {
    await Promise.any(pool.publish(relays, event));
  } finally {
    pool.close(relays);
  }
}

export async function pullVocabulary(): Promise<number> {
  const pubkey = await resolvePubkey();
  if (!pubkey) return 0;
  const relays = await getRelays();
  const pool = new SimplePool();
  let merged = 0;
  try {
    const events = await pool.querySync(relays, {
      kinds: [KIND],
      authors: [pubkey],
    });
    const local = new Map(
      (await listVocabulary()).map((word) => [word.key, word]),
    );
    for (const event of events) {
      const d = event.tags.find((tag) => tag[0] === "d")?.[1];
      if (!d?.startsWith(VOCABULARY_D_PREFIX)) continue;
      try {
        const word = JSON.parse(
          await decryptFromSelf(pubkey, event.content),
        ) as unknown;
        if (!validVocabularyWord(word)) continue;
        if (word.deleted) {
          const existing = local.get(word.key);
          if (!existing || word.updatedAt > existing.updatedAt) {
            await deleteVocabularyWord(word.key);
            local.delete(word.key);
            merged++;
          }
          continue;
        }
        if (
          !local.has(word.key) ||
          word.updatedAt > (local.get(word.key)?.updatedAt ?? 0)
        ) {
          await saveVocabularyWord(word);
          local.set(word.key, word);
          merged++;
        }
      } catch {
        /* skip undecryptable or malformed vocabulary entries */
      }
    }
  } finally {
    pool.close(relays);
  }
  return merged;
}

export async function pullProgress(): Promise<number> {
  const pubkey = await resolvePubkey();
  if (!pubkey) return 0;

  const relays = await getRelays();
  const pool = new SimplePool();
  let merged = 0;
  try {
    const events = await pool.querySync(relays, {
      kinds: [KIND],
      authors: [pubkey],
    });
    for (const ev of events) {
      const d = ev.tags.find((t) => t[0] === "d")?.[1];
      if (!d?.startsWith(D_PREFIX)) continue;
      try {
        const bookId = d.slice(D_PREFIX.length);
        const raw = JSON.parse(ev.content) as Record<string, unknown>;
        const remote = normalizeProgress(raw, bookId, ev.created_at);
        if (!remote) continue;
        const local = (await listProgress()).find(
          (p) => p.bookId === remote.bookId,
        );
        if (!local || remote.updatedAt > local.updatedAt) {
          await saveProgress(remote);
          merged++;
        }
      } catch {
        /* skip */
      }
    }
  } finally {
    pool.close(relays);
  }
  return merged;
}
