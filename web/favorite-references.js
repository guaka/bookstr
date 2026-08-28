(function initBookstrFavoriteReferences(root) {
  const MD5 = /^[a-f0-9]{32}$/i;
  const SHA256 = /^[a-f0-9]{64}$/i;

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isbn(value) {
    const normalized = text(value).replace(/[^0-9Xx]/g, '').toUpperCase();
    return normalized.length === 10 || normalized.length === 13 ? normalized : '';
  }

  function httpUrl(value) {
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

  function positiveTimestamp(value) {
    const candidate = text(value);
    if (!/^[0-9]+$/.test(candidate)) return 0;
    const parsed = Number(candidate);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  function parseTag(tag) {
    if (!Array.isArray(tag) || tag.length < 4 || text(tag[0]) !== 'book') return null;
    const type = text(tag[1]);
    const rawIdentifier = text(tag[2]);
    const addedAt = positiveTimestamp(tag[3]);
    const suppliedLocator = httpUrl(tag[4]);
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

  function parseTags(tags) {
    if (!Array.isArray(tags)) return [];
    const refs = [];
    const indexes = new Map();
    for (const tag of tags) {
      const ref = parseTag(tag);
      if (!ref) continue;
      const key = `${ref.type}:${ref.identifier}`;
      const index = indexes.get(key);
      if (index === undefined) {
        indexes.set(key, refs.length);
        refs.push(ref);
        continue;
      }
      const old = refs[index];
      refs[index] = {
        ...old,
        locator: old.locator || ref.locator,
        addedAt: old.addedAt && ref.addedAt ? Math.min(old.addedAt, ref.addedAt) : old.addedAt || ref.addedAt,
      };
    }
    return refs;
  }

  function appendWebReference(entries, ref, pseudoIdForSeed) {
    let entry;
    let existing;
    if (ref.type === 'libvault') {
      existing = entries.find(item => item.md5 === ref.identifier);
      entry = { md5: ref.identifier, url: ref.locator, readUrl: ref.locator };
    } else if (ref.type === 'bookstr') {
      existing = entries.find(item => item.md5 === ref.identifier);
      entry = { md5: ref.identifier, url: ref.locator, readUrl: ref.locator };
    } else if (ref.type === 'isbn') {
      existing = entries.find(item => item.isbn === ref.identifier);
      entry = { md5: pseudoIdForSeed(ref.identifier), isbn: ref.identifier, url: ref.locator };
    } else if (ref.type === 'url') {
      existing = entries.find(item => item.url === ref.identifier || item.readUrl === ref.identifier);
      entry = { md5: pseudoIdForSeed(ref.identifier), url: ref.identifier, readUrl: ref.identifier };
    } else {
      existing = entries.find(item => item.blossomSha256 === ref.identifier);
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

  root.BookstrFavoriteReferences = { appendWebReference, parseTag, parseTags };
})(globalThis);
