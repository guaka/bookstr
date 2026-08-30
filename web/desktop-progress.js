(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BookstrDesktopProgress = api;
})(globalThis, function() {
  'use strict';

  function clampProgress(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.max(0, Math.min(1, numericValue));
  }

  function progressPosition(payload) {
    const progression = clampProgress(payload?.progression ?? payload?.locator?.progression);
    const furthestProgression = Math.max(
      progression,
      clampProgress(payload?.furthestProgression ?? payload?.locator?.furthestProgression),
    );
    return { progression, furthestProgression };
  }

  function isProgressAhead(candidate, baseline) {
    const next = progressPosition(candidate);
    const current = progressPosition(baseline);
    return next.furthestProgression > current.furthestProgression
      || (next.furthestProgression === current.furthestProgression && next.progression > current.progression);
  }

  const profiles = {
    main: { requireId: true, includeLanguage: true },
    web: {
      requireId: true,
      trimReadUrl: true,
      webAliases: true,
      rejectInvalidProgress: true,
      preserveWebFurthest: true,
      lowerCaseExtension: true,
      lowerCaseLanguage: true,
      includeLanguage: true,
    },
  };

  function normalizeProgressPayload(payload, profile = 'main') {
    const settings = profiles[profile] || profiles.main;
    if (!payload || typeof payload !== 'object') return null;
    const webAliases = Boolean(settings.webAliases);
    const rawMd5 = String(payload.md5 || payload.bookId || (webAliases && payload.book?.md5) || '');
    const md5 = rawMd5.trim().toLowerCase();
    if (settings.requireId && !md5) return null;

    const progression = Number(payload.progression);
    if (settings.rejectInvalidProgress && !Number.isFinite(progression)) return null;
    const furthest = payload.furthestProgression || (webAliases && payload.locator?.furthestProgression) || 0;
    const extension = String(payload.extension || (webAliases && payload.format) || 'epub');
    const readUrl = String(payload.readUrl || (webAliases && payload.url) || '');
    const normalized = {
      md5,
      readUrl: settings.trimReadUrl ? readUrl.trim() : readUrl,
      progression: Number.isFinite(progression) ? clampProgress(progression) : 0,
      furthestProgression: settings.preserveWebFurthest
        ? (Number(furthest) || 0)
        : clampProgress(furthest),
      cfi: String(payload.cfi || (webAliases && (payload.locator?.locations?.cfi || payload.locator?.href)) || ''),
      title: String(payload.title || ''),
      authors: String(payload.authors || (webAliases && payload.author) || ''),
      year: String(payload.year || ''),
      extension: settings.lowerCaseExtension ? extension.toLowerCase() : extension,
      source: String(payload.source || ''),
      sourceNativeId: String(payload.sourceNativeId || (webAliases && payload.source_native_id) || ''),
      sourceUrl: String(payload.sourceUrl || (webAliases && payload.source_url) || ''),
      blossomUrl: String(payload.blossomUrl || (webAliases && payload.blossom_url) || ''),
      blossomSha256: String(payload.blossomSha256 || (webAliases && payload.blossom_sha256) || ''),
      rights_status: String(payload.rights_status || payload.rightsStatus || 'unknown'),
      license: String(payload.license || payload.rights || ''),
      license_url: String(payload.license_url || payload.licenseUrl || ''),
      rights_source: String(payload.rights_source || payload.rightsSource || ''),
    };
    if (settings.includeLanguage) {
      normalized.language = settings.lowerCaseLanguage
        ? String(payload.language || '').toLowerCase()
        : String(payload.language || '');
    }
    return normalized;
  }

  return { clampProgress, progressPosition, isProgressAhead, normalizeProgressPayload };
});
