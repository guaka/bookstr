(function (root) {
  'use strict';

  function metadataObject(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string') return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function isPlaceholderTitle(value) {
    const title = String(value || '').trim();
    return !title
      || /^(?:Untitled book|LibVault favorite|Saved in Nostr|Saved book)$/i.test(title)
      || /^(?:book\s+)?[a-f0-9]{8,64}$/i.test(title);
  }

  function titleFromUrl(readUrl, baseUrl) {
    if (!readUrl) return '';
    try {
      const pathname = new URL(readUrl, baseUrl || 'https://books.guaka.org/').pathname;
      const filename = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
      const title = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      if (!title || /^(?:download|read|book)$/i.test(title) || /^[a-f0-9]{16,64}$/i.test(title.replace(/\s+/g, ''))) return '';
      return title;
    } catch {
      return '';
    }
  }

  function resolveTitle(ref, readUrl, baseUrl) {
    const source = ref && typeof ref === 'object' ? ref : {};
    const metadata = metadataObject(source.metadata);
    const candidates = [
      source.title,
      source.bookTitle,
      source.book_title,
      source.publicationTitle,
      source.displayTitle,
      source.name,
      source.book?.title,
      source.publication?.title,
      metadata.title,
      metadata.bookTitle,
      metadata.name,
      metadata.book?.title,
    ];
    const title = candidates.map(value => String(value || '').trim()).find(value => !isPlaceholderTitle(value));
    return title || titleFromUrl(readUrl || source.readUrl || source.blossomUrl || source.url, baseUrl) || 'Untitled book';
  }

  function languageForBook(ref) {
    const source = ref && typeof ref === 'object' ? ref : {};
    const metadata = metadataObject(source.metadata);
    const raw = source.language || source.lang || source.languageCode || source.sourceLanguage
      || (Array.isArray(source.languages) ? source.languages[0] : source.languages)
      || metadata.language || metadata.lang
      || (Array.isArray(metadata.languages) ? metadata.languages[0] : metadata.languages);
    if (raw && typeof raw === 'object') return String(raw.code || raw.id || raw.name || '').trim().toLowerCase();
    return String(raw || '').trim().toLowerCase();
  }

  function yearForBook(ref) {
    const source = ref && typeof ref === 'object' ? ref : {};
    const metadata = metadataObject(source.metadata);
    const raw = source.year || source.issued || source.publicationYear || source.published || source.date
      || metadata.year || metadata.issued || metadata.publicationYear || metadata.published;
    const match = String(raw || '').match(/\b(1[0-9]{3}|20[0-9]{2}|2100)\b/);
    return match?.[1] || '';
  }

  function authorSearchName(value) {
    return String(value || '')
      .replace(/\s*\((?:c\.?\s*)?\d{3,4}\??\s*[-–—]\s*(?:\d{0,4}\??|present)?\)\s*$/i, '')
      .replace(/,\s*(?:born\s+|b\.?\s*)?\d{3,4}\??\s*[-–—]\s*(?:\d{0,4}\??|present)?\s*$/i, '')
      .trim();
  }

  function readingProgressForBook(ref) {
    const source = ref && typeof ref === 'object' ? ref : {};
    const locator = metadataObject(source.locator);
    const raw = source.progression ?? source.progress ?? locator.progression ?? source.furthestProgression;
    const progression = Number(raw);
    if (!Number.isFinite(progression)) return null;
    return Math.max(0, Math.min(1, progression));
  }

  function normalizeFavoriteAddedAt(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric > 10_000_000_000 ? numeric / 1000 : numeric);
    }
    const milliseconds = Date.parse(value || '');
    return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.floor(milliseconds / 1000) : 0;
  }

  function earliestFavoriteAddedAt(...values) {
    const timestamps = values.map(normalizeFavoriteAddedAt).filter(Boolean);
    return timestamps.length ? Math.min(...timestamps) : 0;
  }

  function favoriteAddedTag(md5, value) {
    const id = String(md5 || '').trim().toLowerCase();
    const timestamp = normalizeFavoriteAddedAt(value);
    return /^[a-f0-9]{32}$/.test(id) && timestamp
      ? ['libvault-added', id, String(timestamp)]
      : null;
  }

  function mergeFavoriteEntry(entries, incoming) {
    const id = String(incoming?.md5 || '').trim().toLowerCase();
    let entry = entries.find(item => String(item?.md5 || '').toLowerCase() === id);
    if (!entry) {
      entry = { md5: id };
      entries.push(entry);
    }
    const favoriteAddedAt = earliestFavoriteAddedAt(entry.favoriteAddedAt, incoming?.favoriteAddedAt);
    for (const [key, value] of Object.entries(incoming || {})) {
      if (value === '' || value == null) continue;
      if (key === 'title') {
        if (isPlaceholderTitle(entry.title) || !isPlaceholderTitle(value)) entry.title = value;
      } else {
        entry[key] = value;
      }
    }
    if (favoriteAddedAt) entry.favoriteAddedAt = favoriteAddedAt;
    return entry;
  }

  function normalizeReadUrl(value, baseUrl) {
    try {
      const url = new URL(String(value || ''), baseUrl || 'https://books.guaka.org/');
      url.hash = '';
      return url.href;
    } catch {
      return String(value || '').trim();
    }
  }

  function findBookByReadUrl(readUrl, ...collections) {
    const wanted = normalizeReadUrl(readUrl);
    return collections.flat().find(book => [book?.readUrl, book?.url, book?.blossomUrl]
      .some(value => value && normalizeReadUrl(value) === wanted)) || null;
  }

  function metadataEndpointForReadUrl(readUrl) {
    try {
      const url = new URL(readUrl);
      if (!/^\/api\/books\/\d+\/download\/?$/.test(url.pathname)) return '';
      url.pathname = url.pathname.replace(/\/download\/?$/, '');
      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return '';
    }
  }

  function canonicalReadUrl(book, apiBase = 'https://books-api.guaka.org/api') {
    const gutenbergId = String(book?.md5 || book?.id || '').match(/^gutenberg:(\d+)$/i)?.[1]
      || (String(book?.source || '').toLowerCase() === 'gutenberg' && /^\d+$/.test(String(book?.sourceNativeId || ''))
        ? String(book.sourceNativeId)
        : '');
    if (gutenbergId) return `${String(apiBase).replace(/\/$/, '')}/books/${gutenbergId}/download`;
    const direct = String(book?.blossomUrl || book?.readUrl || book?.url || '');
    if (!direct) return '';
    try {
      const url = new URL(direct);
      if (/^\/api\/read\/[a-f0-9]{32}\/?$/i.test(url.pathname)) return '';
    } catch {}
    return direct;
  }

  function canonicalCatalogUrl(book) {
    const source = String(book?.source || '').trim().toLowerCase();
    if (source !== 'openlibrary') return '';
    const rawId = String(book?.sourceNativeId || book?.source_native_id || '').trim();
    if (!rawId) return '';
    const olid = /^OL\d+[WM]$/i.test(rawId)
      ? rawId.toUpperCase()
      : /^\d+$/.test(rawId)
        ? `OL${rawId}W`
        : '';
    if (!olid) return '';
    return `https://openlibrary.org/${olid.endsWith('M') ? 'books' : 'works'}/${olid}`;
  }

  function availabilitySourcesForBook(book, isCached = false) {
    const source = String(book?.source || '').toLowerCase();
    const readUrl = String(book?.readUrl || book?.url || '');
    const available = [];
    if (source.includes('gutenberg') || /^gutenberg:\d+$/i.test(String(book?.md5 || '')) || /\/api\/books\/\d+(?:\/download)?(?:\?|$)/i.test(readUrl)) available.push('Gutenberg');
    if (book?.blossomUrl || book?.blossomSha256 || source.includes('blossom')) available.push('Blossom');
    if (isCached) available.push('Cached');
    return available.length ? [...new Set(available)] : ['Metadata only'];
  }

  function availabilityForBook(book, isCached = false) {
    return availabilitySourcesForBook(book, isCached).join(' · ');
  }

  function sortBooks(books, key, direction = 'asc', isCached = () => false) {
    const value = book => {
      if (key === 'title') return book?.title || '';
      if (key === 'author') return book?.authors || book?.author || '';
      if (key === 'year') return Number.parseInt(book?.year, 10) || 0;
      if (key === 'availability') return availabilityForBook(book);
      if (key === 'cached') return isCached(book) ? 1 : 0;
      if (key === 'format') return book?.extension || book?.format || '';
      if (key === 'language') return book?.language || '';
      return '';
    };
    const multiplier = direction === 'desc' ? -1 : 1;
    return [...books].sort((left, right) => {
      const leftValue = value(left);
      const rightValue = value(right);
      if (typeof leftValue === 'number' && typeof rightValue === 'number') return (leftValue - rightValue) * multiplier;
      return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
    });
  }

  function bookIdentity(book) {
    const md5 = String(book?.md5 || '').trim().toLowerCase();
    if (md5) return `id:${md5}`;
    const source = String(book?.source || '').trim().toLowerCase();
    const sourceId = String(book?.sourceNativeId || book?.source_native_id || book?.id || '').trim().toLowerCase();
    if (sourceId) return `source:${source || 'book'}:${sourceId}`;
    const blossomSha256 = String(book?.blossomSha256 || book?.blossom_sha256 || book?.sha256 || '').trim().toLowerCase();
    if (blossomSha256) return `sha256:${blossomSha256}`;
    const isbn = isbnForBook(book);
    if (isbn) return `isbn:${isbn}`;
    const readUrl = book?.readUrl || book?.url || book?.blossomUrl;
    if (readUrl) return `url:${normalizeReadUrl(readUrl)}`;
    return ['title', resolveTitle(book), book?.authors || book?.author || '', yearForBook(book), languageForBook(book)]
      .map(value => String(value || '').trim().toLowerCase())
      .join(':');
  }

  function dedupeLibraryBooks(books) {
    const merged = new Map();
    for (const book of books.filter(Boolean)) {
      const identity = bookIdentity(book);
      const existing = merged.get(identity);
      if (!existing) {
        merged.set(identity, { ...book, title: resolveTitle(book) });
        continue;
      }
      const existingTitle = resolveTitle(existing);
      const incomingTitle = resolveTitle(book);
      const incomingHasRealTitle = !isPlaceholderTitle(incomingTitle);
      const existingHasRealTitle = !isPlaceholderTitle(existingTitle);
      const favoriteAddedAt = earliestFavoriteAddedAt(existing.favoriteAddedAt, book.favoriteAddedAt);
      const title = incomingHasRealTitle ? incomingTitle : existingTitle;
      const next = { ...existing };
      for (const [key, value] of Object.entries(book)) {
        if (value !== '' && value != null) next[key] = value;
        if ((key === 'author' || key === 'authors') && existingHasRealTitle && !incomingHasRealTitle) {
          next[key] = existing.authors || existing.author || next[key];
        }
      }
      next.title = title;
      if (!next.authors) next.authors = next.author || '';
      if (favoriteAddedAt) next.favoriteAddedAt = favoriteAddedAt;
      merged.set(identity, next);
    }
    return [...merged.values()];
  }

  function matchesBookFilter(book, query, isCached = () => false) {
    const terms = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const searchable = [
      resolveTitle(book),
      book?.authors || book?.author,
      book?.year,
      availabilityForBook(book),
      isCached(book) ? 'cached yes' : 'cached no',
      book?.extension || book?.format,
      book?.language,
      book?.isReading ? 'reading currently reading' : '',
      book?.isFavorite ? 'favorite favourite heart' : '',
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  }

  function isbnForBook(book) {
    const direct = book?.isbn || book?.isbn13 || book?.isbn10;
    if (direct) return String(direct).replace(/[^0-9X]/gi, '').toUpperCase();
    const identifiers = Array.isArray(book?.identifiers) ? book.identifiers : [];
    const isbn = identifiers.find(item => String(item?.type || '').toLowerCase() === 'isbn')?.value;
    return String(isbn || '').replace(/[^0-9X]/gi, '').toUpperCase();
  }

  function enrichBookMetadata(book, metadata, provenance = '') {
    const base = book && typeof book === 'object' ? book : {};
    const incoming = metadata && typeof metadata === 'object' ? metadata : {};
    const next = { ...base, metadataProvenance: { ...(base.metadataProvenance || {}) } };
    const baseTitle = resolveTitle(base);
    const incomingTitle = resolveTitle(incoming);
    const replaceIdentity = isPlaceholderTitle(baseTitle) && !isPlaceholderTitle(incomingTitle);
    const fields = {
      title: incomingTitle,
      authors: incoming.authors || incoming.author || incoming.creator || '',
      year: yearForBook(incoming),
      language: languageForBook(incoming),
      readUrl: canonicalReadUrl(incoming),
      extension: incoming.extension || incoming.format || '',
      source: incoming.source || '',
      isbn: isbnForBook(incoming),
      coverId: incoming.coverId || incoming.cover_id || '',
      coverUrl: incoming.coverUrl || incoming.cover_url || incoming.thumbnail || incoming.image || '',
      coverSha256: incoming.coverSha256 || incoming.cover_sha256 || '',
      publisher: incoming.publisher || incoming.publishers?.[0] || '',
      blossomUrl: incoming.blossomUrl || incoming.blossom_url || '',
      blossomSha256: incoming.blossomSha256 || incoming.blossom_sha256 || incoming.sha256 || '',
    };
    for (const [field, value] of Object.entries(fields)) {
      if (!value || (field === 'title' && isPlaceholderTitle(value))) continue;
      if (replaceIdentity || !next[field] || isPlaceholderTitle(next[field])) {
        next[field] = value;
        if (provenance) next.metadataProvenance[field] = provenance;
      }
    }
    next.metadataLookupComplete = true;
    return next;
  }

  function sameLibraryBook(left, right) {
    const leftId = String(left?.md5 || left?.libvaultMd5 || left?.id || '').trim().toLowerCase();
    const rightId = String(right?.md5 || right?.libvaultMd5 || right?.id || '').trim().toLowerCase();
    if (leftId && rightId) return leftId === rightId;
    const leftUrl = left?.readUrl || left?.url || left?.blossomUrl;
    const rightUrl = right?.readUrl || right?.url || right?.blossomUrl;
    if (leftUrl && rightUrl && normalizeReadUrl(leftUrl) === normalizeReadUrl(rightUrl)) return true;
    const leftIsbn = isbnForBook(left);
    const rightIsbn = isbnForBook(right);
    return Boolean(leftIsbn && rightIsbn && leftIsbn === rightIsbn);
  }

  function mergeLibraryState(reading, favorites) {
    const merged = [];
    const add = (book, status) => {
      let entry = merged.find(item => sameLibraryBook(item, book));
      if (!entry) {
        entry = { ...book };
        merged.push(entry);
      } else {
        const existingTitle = resolveTitle(entry);
        const incomingTitle = resolveTitle(book);
        const incomingHasRealTitle = !isPlaceholderTitle(incomingTitle);
        const existingHasRealTitle = !isPlaceholderTitle(existingTitle);
        for (const [key, value] of Object.entries(book || {})) {
          if (value === '' || value == null) continue;
          if ((key === 'author' || key === 'authors') && existingHasRealTitle && !incomingHasRealTitle) continue;
          entry[key] = value;
        }
        entry.title = incomingHasRealTitle ? incomingTitle : existingTitle;
      }
      if (status === 'reading') {
        entry.isReading = true;
        entry.readingUpdatedAt = Math.max(Number(entry.readingUpdatedAt || 0), Number(book.updatedAt || book.lastReadAt || 0));
      } else {
        entry.isFavorite = true;
        entry.favoriteAddedAt = Math.max(Number(entry.favoriteAddedAt || 0), Number(book.favoriteAddedAt || book.updatedAt || 0));
      }
    };
    reading.filter(Boolean).forEach(book => add(book, 'reading'));
    favorites.filter(Boolean).forEach(book => add(book, 'favorite'));
    return merged.sort((left, right) => {
      if (left.isReading !== right.isReading) return left.isReading ? -1 : 1;
      const leftTime = left.isReading ? left.readingUpdatedAt : left.favoriteAddedAt;
      const rightTime = right.isReading ? right.readingUpdatedAt : right.favoriteAddedAt;
      return Number(rightTime || 0) - Number(leftTime || 0)
        || resolveTitle(left).localeCompare(resolveTitle(right));
    });
  }

  root.BookMetadata = {
    isPlaceholderTitle,
    resolveTitle,
    languageForBook,
    yearForBook,
    authorSearchName,
    readingProgressForBook,
    normalizeFavoriteAddedAt,
    earliestFavoriteAddedAt,
    favoriteAddedTag,
    mergeFavoriteEntry,
    normalizeReadUrl,
    findBookByReadUrl,
    metadataEndpointForReadUrl,
    canonicalReadUrl,
    canonicalCatalogUrl,
    availabilityForBook,
    availabilitySourcesForBook,
    sortBooks,
    dedupeLibraryBooks,
    matchesBookFilter,
    sameLibraryBook,
    mergeLibraryState,
    isbnForBook,
    enrichBookMetadata,
    bookIdentity,
  };
})(globalThis);
