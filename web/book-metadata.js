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
      source.source?.book?.title,
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

  const LANGUAGE_ALIASES = {
    eng: 'en', english: 'en',
    por: 'pt', portuguese: 'pt', português: 'pt', portugues: 'pt',
    fra: 'fr', fre: 'fr', french: 'fr', français: 'fr', francais: 'fr',
    deu: 'de', ger: 'de', german: 'de', deutsch: 'de',
    spa: 'es', spanish: 'es', español: 'es', espanol: 'es',
    ita: 'it', italian: 'it', italiano: 'it',
    nld: 'nl', dut: 'nl', dutch: 'nl', nederlands: 'nl',
    rus: 'ru', russian: 'ru', русский: 'ru',
    zho: 'zh', chi: 'zh', chinese: 'zh', 中文: 'zh',
    jpn: 'ja', japanese: 'ja', 日本語: 'ja',
    ara: 'ar', arabic: 'ar', pol: 'pl', polish: 'pl',
    swe: 'sv', swedish: 'sv', nor: 'no', norwegian: 'no',
    dan: 'da', danish: 'da', fin: 'fi', finnish: 'fi',
    ces: 'cs', cze: 'cs', czech: 'cs', ukr: 'uk', ukrainian: 'uk',
    tur: 'tr', turkish: 'tr', ell: 'el', gre: 'el', greek: 'el',
    heb: 'he', hebrew: 'he', lat: 'la', latin: 'la',
  };

  function normalizeLanguage(value) {
    const raw = String(value || '').trim().toLowerCase();
    const first = raw.split(/[,;|]/, 1)[0].trim().replace(/^\/languages\//, '').replaceAll('_', '-');
    if (!first || ['unknown', 'und', 'undefined', 'null', 'multi', 'multiple'].includes(first)) return '';
    return LANGUAGE_ALIASES[first]
      || (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(first) ? first : '')
      || (/^[\p{L}][\p{L} .'-]{1,40}$/u.test(first) ? first : '');
  }

  function languageForBook(ref) {
    const source = ref && typeof ref === 'object' ? ref : {};
    const metadata = metadataObject(source.metadata);
    const raw = source.language || source.lang || source.languageCode || source.sourceLanguage
      || (Array.isArray(source.languages) ? source.languages[0] : source.languages)
      || metadata.language || metadata.lang
      || (Array.isArray(metadata.languages) ? metadata.languages[0] : metadata.languages);
    if (raw && typeof raw === 'object') return normalizeLanguage(raw.code || raw.id || raw.name || '');
    return normalizeLanguage(raw);
  }

  function yearForBook(ref) {
    const source = ref && typeof ref === 'object' ? ref : {};
    const metadata = metadataObject(source.metadata);
    const raw = source.year || source.issued || source.publicationYear || source.published || source.date
      || metadata.year || metadata.issued || metadata.publicationYear || metadata.published;
    const match = String(raw || '').match(/\b(1[0-9]{3}|20[0-9]{2}|2100)\b/);
    return match?.[1] || '';
  }

  function safeLicenseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function cleanRightsValue(value) {
    const cleaned = String(value || '').trim();
    return ['null', 'undefined'].includes(cleaned.toLowerCase()) ? '' : cleaned;
  }

  function creativeCommonsLicense(license, licenseUrl = '') {
    const evidence = `${license || ''} ${licenseUrl || ''}`;
    const urlMatch = evidence.match(/creativecommons\.org\/(?:licenses\/([a-z-]+)|publicdomain\/(zero))\/(\d(?:\.\d)?)/i);
    if (urlMatch) {
      const code = urlMatch[2] ? 'CC0' : `CC ${urlMatch[1].toUpperCase()}`;
      return `${code} ${urlMatch[3]}`;
    }
    const textMatch = evidence.match(/\b(CC0|CC[ -]BY(?:-NC)?(?:-ND|-SA)?)(?:[ -]?(\d(?:\.\d)?))?\b/i);
    if (textMatch) return `${textMatch[1].toUpperCase().replace('CC-', 'CC ')}${textMatch[2] ? ` ${textMatch[2]}` : ''}`;
    if (!/creative\s*commons/i.test(evidence)) return '';
    const terms = [
      /attribution/i.test(evidence) ? 'BY' : '',
      /noncommercial|non-commercial/i.test(evidence) ? 'NC' : '',
      /no derivatives|no-derivatives/i.test(evidence) ? 'ND' : '',
      /sharealike|share-alike|share alike/i.test(evidence) ? 'SA' : '',
    ].filter(Boolean);
    const version = evidence.match(/creative\s*commons[\s\S]{0,120}?\(?(\d(?:\.\d)?)\)?/i)?.[1] || '';
    return `CC${terms.length ? ` ${terms.join('-')}` : ''}${version ? ` ${version}` : ''}`;
  }

  function normalizeRights(ref) {
    const source = ref && typeof ref === 'object' ? ref : {};
    const metadata = metadataObject(source.metadata);
    const aliases = {
      public_domain: 'public_domain', 'public-domain': 'public_domain', 'public domain': 'public_domain', pd: 'public_domain',
      open_license: 'open_license', 'open-license': 'open_license', 'open license': 'open_license', open: 'open_license',
      copyrighted: 'copyrighted', copyright: 'copyrighted',
    };
    let rightsStatus = aliases[String(
      source.rights_status || source.rightsStatus || metadata.rights_status || metadata.rightsStatus || '',
    ).trim().toLowerCase()] || 'unknown';
    let license = cleanRightsValue(source.license || source.rights || metadata.license || metadata.rights);
    let licenseUrl = safeLicenseUrl(
      source.license_url || source.licenseUrl || metadata.license_url || metadata.licenseUrl,
    );
    const copyright = source.copyright ?? metadata.copyright;
    if (!licenseUrl) {
      const match = license.match(/https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses\/[a-z-]+|publicdomain\/zero)\/\d(?:\.\d)?\/?/i)
        || license.match(/https?:\/\/[^\s<>"']+/i);
      if (match) licenseUrl = safeLicenseUrl(match[0].replace(/[),.;]+$/, ''));
    }
    const evidence = `${license} ${licenseUrl}`.toLowerCase();
    if (/public[ -]domain|no known copyright restrictions|creativecommons\.org\/publicdomain\/(?:zero|mark)|\bcc0(?:\s|$|[./-])/.test(evidence)) {
      rightsStatus = 'public_domain';
    } else if (/creative\s*commons|creativecommons\.org\/licenses\/|\bcc[ -]?by|gnu free documentation|\bgfdl\b|free art license|open publication license|unlicense/.test(evidence)) {
      rightsStatus = 'open_license';
    } else if (rightsStatus === 'unknown' && typeof copyright === 'boolean') {
      rightsStatus = copyright ? 'copyrighted' : 'public_domain';
      if (!copyright && !license) license = 'Public domain in the U.S.';
    } else if (rightsStatus === 'unknown' && /all rights reserved|copyrighted|copyright ©|^©/.test(evidence)) {
      rightsStatus = 'copyrighted';
    }
    return {
      rights_status: rightsStatus,
      license,
      license_url: licenseUrl,
      rights_source: cleanRightsValue(
        source.rights_source || source.rightsSource || metadata.rights_source || metadata.rightsSource || '',
      ),
    };
  }

  function rightsLabel(ref) {
    const rights = normalizeRights(ref);
    const cc = creativeCommonsLicense(rights.license, rights.license_url);
    if (rights.rights_status === 'public_domain') return cc.startsWith('CC0') ? 'CC0' : 'PD';
    if (rights.rights_status === 'open_license') return cc || 'OPEN';
    return '©';
  }

  function rightsAccessibleLabel(ref) {
    const rights = normalizeRights(ref);
    if (rights.rights_status === 'copyrighted') return 'Copyrighted';
    if (rights.rights_status === 'unknown') return 'No open license identified';
    const cc = creativeCommonsLicense(rights.license, rights.license_url);
    if (cc) return cc;
    return rights.license || (rights.rights_status === 'public_domain' ? 'Public domain' : 'Open license');
  }

  function preferredRights(existing, incoming) {
    const current = normalizeRights(existing);
    const next = normalizeRights(incoming);
    if (next.rights_status !== 'unknown') return next;
    if (current.rights_status !== 'unknown') return current;
    if (next.license || next.license_url || next.rights_source) return next;
    return current;
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
    if (Number.isFinite(numeric) && String(value ?? '').trim() !== '') {
      return numeric > 0 ? Math.floor(numeric > 10_000_000_000 ? numeric / 1000 : numeric) : 0;
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
    const existingRights = normalizeRights(entry);
    const incomingRights = normalizeRights(incoming);
    for (const [key, value] of Object.entries(incoming || {})) {
      if (value === '' || value == null) continue;
      if (key === 'title') {
        if (isPlaceholderTitle(entry.title) || !isPlaceholderTitle(value)) entry.title = value;
      } else {
        entry[key] = value;
      }
    }
    Object.assign(entry, preferredRights(existingRights, incomingRights));
    if (favoriteAddedAt) entry.favoriteAddedAt = favoriteAddedAt;
    return entry;
  }

  function normalizeReadUrl(value, baseUrl) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
    try {
      const url = new URL(raw, baseUrl);
      url.hash = '';
      return url.href;
    } catch {
      return raw;
    }
  }

  function findBookByReadUrl(readUrl, ...collections) {
    const comparable = value => {
      const normalized = normalizeReadUrl(value);
      try {
        const url = new URL(normalized);
        url.search = '';
        url.hash = '';
        return url.href;
      } catch { return normalized; }
    };
    const wanted = comparable(readUrl);
    return collections.flat().find(book => [book?.readUrl, book?.url, book?.blossomUrl]
      .some(value => value && comparable(value) === wanted)) || null;
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

  function torrentMetadataForBook(book) {
    const source = book?.torrent || book?.torrentDescriptor || {};
    const torrentId = String(book?.torrentId || book?.torrent_id || source.magnetURI || source.magnetUri || '').trim();
    const torrentFile = String(book?.torrentFile || book?.torrent_file || source.torrentFile || '').trim();
    const rawAnnounce = book?.torrentAnnounce || book?.torrent_announce || source.announce;
    const announce = Array.isArray(rawAnnounce)
      ? rawAnnounce.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    if (!torrentId && !torrentFile) return null;
    return { torrentId, torrentFile, announce };
  }

  function libgenTorrentMetadataForBook(book) {
    const md5 = String(book?.md5 || book?.libvaultMd5 || '').trim().toLowerCase();
    const libgenId = Number(book?.libgenId || book?.libgen_id || book?.sourceNativeId || book?.source_native_id || '');
    if (!/^[a-f0-9]{32}$/.test(md5) || !Number.isSafeInteger(libgenId) || libgenId <= 0) return null;
    return { md5, libgenId, batch: Math.floor(libgenId / 1000) * 1000 };
  }

  function canonicalReadUrl(book, apiBase = 'https://books-api.guaka.org/api') {
    const gutenbergId = String(book?.md5 || book?.id || '').match(/^gutenberg:(\d+)$/i)?.[1]
      || (String(book?.source || '').toLowerCase() === 'gutenberg' && /^\d+$/.test(String(book?.sourceNativeId || ''))
        ? String(book.sourceNativeId)
        : '');
    if (gutenbergId) return `${String(apiBase).replace(/\/$/, '')}/books/${gutenbergId}/download`;
    const direct = String(book?.readUrl || book?.url || '');
    if (!direct) return '';
    try {
      const url = new URL(direct);
      if (/^\/api\/read\/[a-f0-9]{32}\/?$/i.test(url.pathname)) return '';
      if (url.hostname.toLowerCase() === 'blossom.bfr.ee') return '';
    } catch {}
    return direct;
  }

  function canonicalCatalogUrl(book) {
    const source = String(book?.source || '').trim().toLowerCase();
    const legacyId = String(book?.md5 || book?.id || '').trim().match(/^openlibrary:(.+)$/i)?.[1] || '';
    if (source !== 'openlibrary' && !legacyId) return '';
    const rawId = String(book?.sourceNativeId || book?.source_native_id || legacyId).trim();
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
    if (torrentMetadataForBook(book)) available.push('WebTorrent');
    if (libgenTorrentMetadataForBook(book)) available.push('Torrent');
    if (readUrl && source.includes('internet-archive')) available.push('Internet Archive');
    if (readUrl && source === 'oapen') available.push('OAPEN');
    if (!available.length) available.push('Metadata only');
    if (isCached) available.push('Cached');
    return [...new Set(available)];
  }

  function availabilityForBook(book, isCached = false) {
    const sources = availabilitySourcesForBook(book, isCached);
    return sources.includes('Cached') && sources.includes('Metadata only')
      ? 'Cached'
      : sources.join(' · ');
  }

  function availabilitySortRank(value) {
    const label = String(value || '').trim().toLowerCase();
    if (label.includes('seeding')) return 0;
    if (/\b(?:ready|cached|gutenberg|internet archive|oapen)\b/.test(label)) return 1;
    if (label.includes('downloading')) return 2;
    if (label.includes('finding peers') || label.includes('queued')) return 3;
    if (/\b(?:available|torrent|webtorrent)\b/.test(label)) return 4;
    if (!label || label === '—' || label.includes('metadata only')) return 5;
    if (label.includes('unavailable') || label.includes('failed')) return 6;
    return 5;
  }

  function internetArchiveFile(files, metadata = {}) {
    if (['true', '1'].includes(String(metadata?.['access-restricted-item'] || '').toLowerCase())) return null;
    const available = (Array.isArray(files) ? files : []).filter(file => (
      file?.name
      && !['true', '1'].includes(String(file.private || '').toLowerCase())
      && !/[\\/]_?meta\.xml$/i.test(file.name)
      && !/(?:encrypted|lcp|acsm)/i.test(String(file.format || ''))
      && !/(?:_lcp|\.lcp)\.epub$|_encrypted\.pdf$|\.acsm$/i.test(file.name)
    ));
    return available.find(file => /epub/i.test(file.format || '') || /\.epub$/i.test(file.name))
      || available.find(file => /pdf/i.test(file.format || '') || /\.pdf$/i.test(file.name))
      || null;
  }

  function matchingTorrentCatalogRecord(book, candidates = []) {
    const torrentRecords = candidates.filter(candidate => libgenTorrentMetadataForBook(candidate));
    const isbn = isbnForBook(book);
    const formatRank = { epub: 4, pdf: 3, fb2: 2, cbz: 1, cbr: 1 };
    const exact = torrentRecords.filter(candidate => (
      (isbn && isbnForBook(candidate) === isbn) || sameLibraryBook(book, candidate)
    )).map((candidate, index) => ({
      candidate,
      index,
      formatRank: formatRank[String(candidate?.extension || candidate?.format || '').replace(/^\./, '').toLowerCase()] || 0,
    })).filter(entry => entry.formatRank > 0)
      .sort((left, right) => right.formatRank - left.formatRank || left.index - right.index);
    if (exact.length) return exact[0].candidate;
    const normalizeWords = value => String(value || '').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const wantedRawTitle = String(resolveTitle(book) || '').trim().toLocaleLowerCase();
    const wantedTitle = normalizeWords(wantedRawTitle);
    const titleRank = candidate => {
      const offered = normalizeWords(candidate?.title);
      if (!wantedTitle || !offered) return 0;
      if (offered === wantedTitle) return 4;
      const rawOffered = String(candidate?.title || '').trim().toLocaleLowerCase();
      if (rawOffered.startsWith(wantedRawTitle)) {
        const suffix = rawOffered.slice(wantedRawTitle.length).trimStart();
        if (/^[:\-–—]/.test(suffix)) return 3;
        if (/^\./.test(suffix)) return 2;
      }
      return 0;
    };
    const wantedAuthors = normalizeWords(book?.authors || book?.author);
    const wantedAuthorTokens = new Set(wantedAuthors.split(' ').filter(word => word.length > 1));
    const authorRank = candidate => {
      const candidateAuthors = normalizeWords(candidate?.authors || candidate?.author);
      const candidateTokens = [...new Set(candidateAuthors.split(' ').filter(word => word.length > 1))];
      if (!wantedAuthorTokens.size || !candidateTokens.length) return 0;
      const overlap = candidateTokens.filter(word => wantedAuthorTokens.has(word)).length;
      return overlap >= Math.min(2, candidateTokens.length) && overlap / candidateTokens.length >= 0.6
        ? overlap / candidateTokens.length + (wantedAuthors.startsWith(candidateAuthors) ? 0.25 : 0)
        : 0;
    };
    const wantedYear = String(book?.year || '').trim();
    const wantedLanguage = normalizeWords(languageForBook(book));
    const wantedPublisher = normalizeWords(book?.publisher);
    const matches = torrentRecords.map((candidate, index) => {
      const candidateIsbn = isbnForBook(candidate);
      const candidateYear = String(candidate?.year || '').trim();
      const candidateFormat = String(candidate?.extension || candidate?.format || '').replace(/^\./, '').toLowerCase();
      const candidateLanguage = normalizeWords(languageForBook(candidate));
      const candidateTitleRank = titleRank(candidate);
      const candidateAuthorRank = authorRank(candidate);
      const eligible = candidateTitleRank > 0
        && candidateAuthorRank > 0
        && (!isbn || !candidateIsbn || candidateIsbn === isbn)
        && (!wantedYear || !candidateYear || candidateYear === wantedYear)
        && (!wantedLanguage || !candidateLanguage || candidateLanguage === wantedLanguage)
        && candidateFormat in formatRank;
      if (!eligible) return null;
      const publisherBonus = wantedPublisher && normalizeWords(candidate?.publisher) === wantedPublisher ? 5 : 0;
      const languageBonus = wantedLanguage && candidateLanguage === wantedLanguage ? 5 : 0;
      return {
        candidate,
        index,
        formatRank: formatRank[candidateFormat],
        score: candidateTitleRank * 100 + candidateAuthorRank * 10
          + (formatRank[candidateFormat] || 0) + publisherBonus + languageBonus,
      };
    }).filter(Boolean).sort((left, right) => right.formatRank - left.formatRank
      || right.score - left.score || left.index - right.index);
    return matches[0]?.candidate || null;
  }

  function sortBooks(books, key, direction = 'asc', isCached = () => false, availabilityLabel = null) {
    const value = book => {
      if (key === 'title') return book?.title || '';
      if (key === 'author') return book?.authors || book?.author || '';
      if (key === 'rights') return rightsLabel(book);
      if (key === 'year') return Number.parseInt(book?.year, 10) || 0;
      if (key === 'availability') {
        const label = typeof availabilityLabel === 'function'
          ? availabilityLabel(book)
          : availabilityForBook(book, isCached(book));
        return availabilitySortRank(label);
      }
      if (key === 'cached') return isCached(book) ? 1 : 0;
      if (key === 'format') return book?.extension || book?.format || '';
      if (key === 'language') {
        const language = String(book?.language || '').trim();
        if (!language || typeof Intl?.DisplayNames !== 'function') return language;
        try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) || language; }
        catch { return language; }
      }
      return '';
    };
    const multiplier = direction === 'desc' ? -1 : 1;
    return [...books].sort((left, right) => {
      const leftValue = value(left);
      const rightValue = value(right);
      const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? (leftValue - rightValue) * multiplier
        : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
      if (comparison) return comparison;
      return String(left?.title || '').localeCompare(String(right?.title || ''), undefined, { numeric: true, sensitivity: 'base' });
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

  function gutenbergIdForBook(book) {
    const md5Match = String(book?.md5 || '').trim().match(/^gutenberg:(\d+)$/i);
    if (md5Match) return md5Match[1];
    const source = String(book?.source || '').trim().toLowerCase();
    const sourceId = String(book?.sourceNativeId || book?.source_native_id || '').trim();
    if (source === 'gutenberg' && /^\d+$/.test(sourceId)) return sourceId;
    const readUrl = String(book?.readUrl || book?.url || book?.sourceUrl || book?.source_url || '');
    try {
      const url = new URL(readUrl);
      const trustedEndpoint = (url.protocol === 'app:' && url.hostname === 'bookstr')
        || url.hostname === 'books-api.guaka.org';
      return trustedEndpoint ? url.pathname.match(/^\/api\/books\/(\d+)\/download\/?$/)?.[1] || '' : '';
    } catch {
      return '';
    }
  }

  function isLocalGutenbergCopy(book) {
    const readUrl = String(book?.readUrl || book?.url || '');
    return Boolean(gutenbergIdForBook(book) && /^app:\/\/bookstr\//i.test(readUrl));
  }

  function preserveLocalGutenbergField(existing, incoming, key) {
    if (!isLocalGutenbergCopy(existing) || isLocalGutenbergCopy(incoming)) return false;
    return new Set(['md5', 'id', 'readUrl', 'url', 'sourceUrl', 'source_url', 'blossomSha256', 'sha256', 'progression', 'furthestProgression', 'cfi', 'updatedAt', 'lastReadAt']).has(key);
  }

  function preserveCanonicalMd5(existing, incoming, key) {
    if (key !== 'md5') return false;
    const current = String(existing?.md5 || '').trim();
    const candidate = String(incoming?.md5 || '').trim();
    return /^[a-f0-9]{32}$/i.test(current) && !/^[a-f0-9]{32}$/i.test(candidate);
  }

  function dedupeLibraryBooks(books) {
    const merged = new Map();
    for (const book of books.filter(Boolean)) {
      const matchingEntry = [...merged.entries()].find(([, candidate]) => sameLibraryBook(candidate, book));
      const identity = matchingEntry?.[0] || bookIdentity(book);
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
        if (preserveLocalGutenbergField(existing, book, key)) continue;
        if (preserveCanonicalMd5(existing, book, key)) continue;
        if (value !== '' && value != null) next[key] = value;
        if ((key === 'author' || key === 'authors') && existingHasRealTitle && !incomingHasRealTitle) {
          next[key] = existing.authors || existing.author || next[key];
        }
      }
      next.title = title;
      Object.assign(next, preferredRights(existing, book));
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
    const identifiers = Array.isArray(book?.identifiers) ? book.identifiers : [];
    const isbn = identifiers.find(item => /^isbn(?:10|13)?$/i.test(String(item?.type || '').replace(/[^a-z0-9]/gi, '')))?.value;
    const direct = book?.isbn || book?.isbn13 || book?.isbn10;
    return String(isbn || direct || '').replace(/[^0-9X]/gi, '').toUpperCase();
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
      torrentId: incoming.torrentId || incoming.torrent_id || incoming.magnetURI || incoming.magnet_uri || incoming.torrent?.magnetURI || '',
      torrentFile: incoming.torrentFile || incoming.torrent_file || incoming.torrent?.torrentFile || '',
      torrentAnnounce: incoming.torrentAnnounce || incoming.torrent_announce || incoming.torrent?.announce || [],
      libgenId: incoming.libgenId || incoming.libgen_id || incoming.sourceNativeId || incoming.source_native_id || '',
      ...normalizeRights(incoming),
    };
    for (const [field, value] of Object.entries(fields)) {
      if (!value || (field === 'title' && isPlaceholderTitle(value))) continue;
      if (replaceIdentity || !next[field] || isPlaceholderTitle(next[field])) {
        next[field] = value;
        if (provenance) next.metadataProvenance[field] = provenance;
      }
    }
    Object.assign(next, preferredRights(base, incoming));
    next.metadataLookupComplete = true;
    return next;
  }

  function sameLibraryBook(left, right) {
    const format = book => String(book?.extension || book?.format || '')
      .trim().toLowerCase().replace(/^\./, '');
    const leftFormat = format(left);
    const rightFormat = format(right);
    if (leftFormat && rightFormat && leftFormat !== rightFormat) return false;
    const leftGutenbergId = gutenbergIdForBook(left);
    const rightGutenbergId = gutenbergIdForBook(right);
    if (leftGutenbergId && rightGutenbergId) return leftGutenbergId === rightGutenbergId;
    const contentDigests = book => new Set([
      book?.sha256,
      book?.blossomSha256,
      book?.blossom_sha256,
      /^[a-f0-9]{64}$/i.test(String(book?.md5 || '').trim()) ? book.md5 : '',
    ]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => /^[a-f0-9]{64}$/.test(value)));
    const leftDigests = contentDigests(left);
    const rightDigests = contentDigests(right);
    if (leftDigests.size && rightDigests.size && [...leftDigests].some(digest => rightDigests.has(digest))) return true;
    const stableIds = book => new Set([book?.md5, book?.libvaultMd5, book?.id]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean));
    const leftIds = stableIds(left);
    const rightIds = stableIds(right);
    if (leftIds.size && rightIds.size) return [...leftIds].some(id => rightIds.has(id));
    const leftBlossom = String(left?.blossomSha256 || left?.blossom_sha256 || '').trim().toLowerCase();
    const rightBlossom = String(right?.blossomSha256 || right?.blossom_sha256 || '').trim().toLowerCase();
    if (leftBlossom && rightBlossom) return leftBlossom === rightBlossom;
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
        entry = { ...book, ...normalizeRights(book) };
        merged.push(entry);
      } else {
        const existingTitle = resolveTitle(entry);
        const incomingTitle = resolveTitle(book);
        const incomingHasRealTitle = !isPlaceholderTitle(incomingTitle);
        const existingHasRealTitle = !isPlaceholderTitle(existingTitle);
        for (const [key, value] of Object.entries(book || {})) {
          if (value === '' || value == null) continue;
          if (preserveLocalGutenbergField(entry, book, key)) continue;
          if (preserveCanonicalMd5(entry, book, key)) continue;
          if ((key === 'author' || key === 'authors') && existingHasRealTitle && !incomingHasRealTitle) continue;
          entry[key] = value;
        }
        Object.assign(entry, preferredRights(entry, book));
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
    metadataObject,
    isPlaceholderTitle,
    resolveTitle,
    languageForBook,
    normalizeLanguage,
    yearForBook,
    normalizeRights,
    preferredRights,
    rightsLabel,
    rightsAccessibleLabel,
    authorSearchName,
    readingProgressForBook,
    normalizeFavoriteAddedAt,
    earliestFavoriteAddedAt,
    favoriteAddedTag,
    mergeFavoriteEntry,
    normalizeReadUrl,
    findBookByReadUrl,
    metadataEndpointForReadUrl,
    torrentMetadataForBook,
    libgenTorrentMetadataForBook,
    canonicalReadUrl,
    canonicalCatalogUrl,
    availabilityForBook,
    availabilitySourcesForBook,
    internetArchiveFile,
    matchingTorrentCatalogRecord,
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
