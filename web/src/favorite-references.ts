const __bookstrFavoriteReferencesApi = (function initBookstrFavoriteReferences(root: typeof globalThis & { BookstrFavoriteReferences?: unknown }) {
  type FavoriteReference = { type: string; identifier: string; locator: string; addedAt: number };
  type WebReference = Record<string, unknown> & {
    md5?: string; isbn?: string; url?: string; readUrl?: string; blossomSha256?: string;
    blossomUrl?: string; favoriteAddedAt?: number;
  };
  const MD5 = /^[a-f0-9]{32}$/i;
  const SHA256 = /^[a-f0-9]{64}$/i;

  function text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isbn(value: unknown) {
    const normalized = text(value).replace(/[^0-9Xx]/g, '').toUpperCase();
    return normalized.length === 10 || normalized.length === 13 ? normalized : '';
  }

  function httpUrl(value: unknown) {
    const candidate = text(value);
    if (!candidate) return '';
    try {
      const parsed = new URL(candidate);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname
        ? candidate
        : '';
    } catch {
      return '';
    }
  }

  function positiveTimestamp(value: unknown) {
    const candidate = text(value);
    if (!/^[0-9]+$/.test(candidate)) return 0;
    const parsed = Number(candidate);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  function parseTag(tag: unknown): FavoriteReference | null {
    const values: unknown[] = Array.isArray(tag) ? tag : [];
    if (values.length < 4 || text(values[0]) !== 'book') return null;
    const type = text(values[1]);
    const rawIdentifier = text(values[2]);
    const addedAt = positiveTimestamp(values[3]);
    const suppliedLocator = httpUrl(values[4]);
    let identifier = rawIdentifier;
    let locator = suppliedLocator;
    if (type === 'libvault') {
      if (!MD5.test(identifier)) return null;
      identifier = identifier.toLowerCase();
    } else if (type === 'bookstr') {
      if (!identifier) return null;
    } else if (type === 'isbn') {
      identifier = isbn(identifier);
      if (!identifier) return null;
    } else if (type === 'url') {
      identifier = httpUrl(identifier);
      if (!identifier) return null;
      locator = identifier;
    } else if (type === 'blossom') {
      if (!SHA256.test(identifier)) return null;
      identifier = identifier.toLowerCase();
    } else {
      return null;
    }
    return { type, identifier, locator, addedAt };
  }

  function parseTags(tags: unknown): FavoriteReference[] {
    if (!Array.isArray(tags)) return [];
    const values: unknown[] = tags;
    const refs: FavoriteReference[] = [];
    const indexes = new Map<string, number>();
    for (const tag of values) {
      const ref = parseTag(tag);
      if (!ref) continue;
      const key = `${ref.type}:${ref.identifier}`;
      const index = indexes.get(key);
      if (index === undefined) {
        indexes.set(key, refs.length);
        refs.push(ref);
        continue;
      }
      const old = refs[index]!;
      refs[index] = {
        ...old,
        locator: old.locator || ref.locator,
        addedAt: old.addedAt && ref.addedAt ? Math.min(old.addedAt, ref.addedAt) : old.addedAt || ref.addedAt,
      };
    }
    return refs;
  }

  function appendWebReference(entries: WebReference[], ref: FavoriteReference, pseudoIdForSeed: (seed: string) => string): WebReference {
    let entry: WebReference;
    let existing: WebReference | undefined;
    if (ref.type === 'libvault') {
      existing = entries.find((item: WebReference) => item.md5 === ref.identifier);
      entry = { md5: ref.identifier, url: ref.locator, readUrl: ref.locator };
    } else if (ref.type === 'bookstr') {
      existing = entries.find((item: WebReference) => item.md5 === ref.identifier);
      entry = { md5: ref.identifier, url: ref.locator, readUrl: ref.locator };
    } else if (ref.type === 'isbn') {
      existing = entries.find((item: WebReference) => item.isbn === ref.identifier);
      entry = { md5: pseudoIdForSeed(ref.identifier), isbn: ref.identifier, url: ref.locator };
    } else if (ref.type === 'url') {
      existing = entries.find((item: WebReference) => item.url === ref.identifier || item.readUrl === ref.identifier);
      entry = { md5: pseudoIdForSeed(ref.identifier), url: ref.identifier, readUrl: ref.identifier };
    } else {
      existing = entries.find((item: WebReference) => item.blossomSha256 === ref.identifier);
      entry = {
        md5: ref.identifier,
        blossomSha256: ref.identifier,
        blossomUrl: ref.locator,
        url: ref.locator,
      };
    }
    if (!existing) {
      entry.favoriteAddedAt = ref.addedAt;
      entries.push(entry);
      return entry;
    }
    existing.url ||= entry.url;
    existing.readUrl ||= entry.readUrl;
    existing.blossomUrl ||= entry.blossomUrl;
    if (ref.addedAt && (!existing.favoriteAddedAt || ref.addedAt < existing.favoriteAddedAt)) {
      existing.favoriteAddedAt = ref.addedAt;
    }
    return existing;
  }

  const __bookstrFavoriteReferencesApi = { appendWebReference, parseTag, parseTags };
  root.BookstrFavoriteReferences = __bookstrFavoriteReferencesApi;
  return __bookstrFavoriteReferencesApi;
})(globalThis);
export type FavoriteReferencesApi = typeof __bookstrFavoriteReferencesApi;
