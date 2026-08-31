(function attachCoverAssets(root) {
  const BLOSSOM_BASE = 'https://blossom.bfr.ee';
  const failedByBook = new Map();
  const resolvedByBook = new Map();

  function normalizeCoverUrl(value, desktop) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (/^https:\/\/lib\.b\.bfr\.ee\/api\/(?:covers|placeholder)\//i.test(url)) return '';
    if (/^\/\//.test(url)) return `https:${url}`;
    if (/^(?:https:|data:image\/|blob:|app:)/i.test(url)) return url;
    if (!desktop && /^(?:\/|\.\/)/.test(url)) return url;
    return '';
  }

  function placeholderCoverUrl(book) {
    const seed = String(book?.md5 || book?.title || 'Book');
    let hue = 0;
    for (const character of seed) hue = (hue * 31 + character.charCodeAt(0)) % 360;
    const initial = String(book?.title || 'B').trim().charAt(0).toUpperCase().replace(/[^A-Z0-9]/, 'B') || 'B';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 168"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="hsl(${hue} 42% 42%)"/><stop offset="1" stop-color="hsl(${hue} 48% 22%)"/></linearGradient></defs><rect width="120" height="168" rx="4" fill="url(#g)"/><path d="M18 20h84v128H18z" fill="none" stroke="white" stroke-opacity=".34" stroke-width="2"/><text x="60" y="103" text-anchor="middle" fill="white" font-family="Georgia,serif" font-size="64" font-weight="700">${initial}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function bookCoverCandidates(book, options = {}) {
    const desktop = Boolean(options.desktop);
    const key = String(options.key || book?.md5 || book?.sha256 || book?.title || '').trim().toLowerCase();
    const candidates = [];
    const add = value => {
      const url = normalizeCoverUrl(value, desktop);
      if (url && !candidates.includes(url)) candidates.push(url);
    };
    add(options.localCoverUrl);
    for (const value of [
      book?.coverUrl,
      book?.cover_url,
      book?.thumbnail,
      book?.image,
      book?.metadata?.coverUrl,
      book?.metadata?.cover_url,
      book?.imageLinks?.thumbnail,
      book?.imageLinks?.smallThumbnail,
      book?.cover?.url,
    ]) add(value);

    const coverId = book?.coverId || book?.cover_id || '';
    if (coverId) add(`https://covers.openlibrary.org/b/id/${encodeURIComponent(coverId)}-M.jpg`);
    const isbn = String(root.BookMetadata?.isbnForBook?.(book) || '').trim();
    if (isbn) add(`https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg?default=false`);

    const coverSha256 = String(book?.coverSha256 || book?.cover_sha256 || '').trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(coverSha256)) {
      const format = String(book?.coverFormat || book?.cover_format || '').replace(/^\./, '').toLowerCase();
      const formats = ['jpg', 'jpeg', 'png', 'webp'];
      if (formats.includes(format)) formats.unshift(format);
      for (const extension of [...new Set(formats)]) add(`${options.blossomBase || BLOSSOM_BASE}/${coverSha256}.${extension}`);
    }

    const placeholder = placeholderCoverUrl(book);
    const failed = failedByBook.get(key);
    const usable = failed ? candidates.filter(url => !failed.has(url)) : candidates;
    const resolved = resolvedByBook.get(key);
    if (resolved && usable.includes(resolved)) usable.splice(usable.indexOf(resolved), 1);
    if (resolved) usable.unshift(resolved);
    usable.push(placeholder);
    return [...new Set(usable)];
  }

  function attachImageFallback(image, candidates, options = {}) {
    if (!image || !Array.isArray(candidates) || !candidates.length) return;
    const key = String(options.key || '').trim().toLowerCase();
    let index = Math.max(0, candidates.indexOf(image.getAttribute?.('src') || image.src));
    if (!image.getAttribute?.('src') && !image.src) image.src = candidates[index];
    const markLoaded = () => {
      image.classList?.add('is-loaded');
      const url = candidates[index];
      if (key && url && !url.startsWith('data:image/')) resolvedByBook.set(key, url);
    };
    image.addEventListener('load', markLoaded);
    image.addEventListener('error', () => {
      image.classList?.remove('is-loaded');
      const failedUrl = candidates[index];
      if (key && failedUrl && !failedUrl.startsWith('data:image/')) {
        if (!failedByBook.has(key)) failedByBook.set(key, new Set());
        failedByBook.get(key).add(failedUrl);
        if (resolvedByBook.get(key) === failedUrl) resolvedByBook.delete(key);
      }
      index += 1;
      if (index < candidates.length) image.src = candidates[index];
      else image.remove?.();
    });
    if (image.complete && Number(image.naturalWidth || 0) > 0) markLoaded();
  }

  root.CoverAssets = { attachImageFallback, bookCoverCandidates, normalizeCoverUrl, placeholderCoverUrl };
})(typeof window !== 'undefined' ? window : globalThis);
