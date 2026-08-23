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
    return String(book?.readUrl || book?.url || book?.blossomUrl || '');
  }

  function availabilityForBook(book) {
    const source = String(book?.source || '').toLowerCase();
    const readUrl = String(book?.readUrl || book?.url || '');
    if (book?.blossomUrl || book?.blossomSha256 || source.includes('blossom')) return 'Blossom';
    if (source.includes('gutenberg') || /\/api\/books\/\d+(?:\/download)?(?:\?|$)/i.test(readUrl)) return 'Gutenberg';
    if (source.includes('libvault') || /^[a-f0-9]{32}$/i.test(String(book?.md5 || ''))) return 'LibVault';
    return 'Other';
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
    const readUrl = book?.readUrl || book?.url || book?.blossomUrl;
    return readUrl ? `url:${normalizeReadUrl(readUrl)}` : `title:${resolveTitle(book)}:${book?.authors || book?.author || ''}`;
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
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  }

  root.BookMetadata = {
    isPlaceholderTitle,
    resolveTitle,
    languageForBook,
    normalizeFavoriteAddedAt,
    earliestFavoriteAddedAt,
    favoriteAddedTag,
    mergeFavoriteEntry,
    normalizeReadUrl,
    findBookByReadUrl,
    metadataEndpointForReadUrl,
    canonicalReadUrl,
    availabilityForBook,
    sortBooks,
    dedupeLibraryBooks,
    matchesBookFilter,
  };
})(globalThis);
