(function <T extends object>(root: typeof globalThis & { BookstrDesktopProgress?: unknown }, factory: () => T) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BookstrDesktopProgress = api;
})(globalThis as typeof globalThis & { BookstrDesktopProgress?: unknown }, function() {
  'use strict';

  interface ProgressProfile {
    requireId: boolean; trimReadUrl?: boolean; webAliases?: boolean; rejectInvalidProgress?: boolean;
    preserveWebFurthest?: boolean; lowerCaseExtension?: boolean; lowerCaseLanguage?: boolean; includeLanguage?: boolean;
  }

  function clampProgress(value: unknown): number {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.max(0, Math.min(1, numericValue));
  }

  function progressPosition(payload: ProgressInput | null | undefined) {
    const progression = clampProgress(payload?.progression ?? payload?.locator?.progression);
    const furthestProgression = Math.max(
      progression,
      clampProgress(payload?.furthestProgression ?? payload?.locator?.furthestProgression),
    );
    return { progression, furthestProgression };
  }

  function isProgressAhead(candidate: ProgressInput | null | undefined, baseline: ProgressInput | null | undefined): boolean {
    const next = progressPosition(candidate);
    const current = progressPosition(baseline);
    return next.furthestProgression > current.furthestProgression
      || (next.furthestProgression === current.furthestProgression && next.progression > current.progression);
  }

  const profiles: Record<string, ProgressProfile> = {
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

  function normalizeProgressPayload(payload: ProgressInput | null | undefined, profile = 'main') {
    const settings = profiles[profile] || profiles.main!;
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
    const normalized: ProgressPayload & { language?: string } = {
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

export interface ProgressPayload {
  md5: string;
  readUrl: string;
  progression: number;
  furthestProgression: number;
  cfi: string;
  title: string;
  authors: string;
  year: string;
  extension: string;
  source: string;
  sourceNativeId: string;
  sourceUrl: string;
  blossomUrl: string;
  blossomSha256: string;
  rights_status: string;
  license: string;
  license_url: string;
  rights_source: string;
  language?: string;
}
export interface ProgressInput {
  progression?: unknown; furthestProgression?: unknown; md5?: unknown; bookId?: unknown;
  readUrl?: unknown; cfi?: unknown; title?: unknown; authors?: unknown; year?: unknown;
  extension?: unknown; source?: unknown; sourceNativeId?: unknown; sourceUrl?: unknown;
  blossomUrl?: unknown; blossomSha256?: unknown; rights_status?: unknown; rightsStatus?: unknown;
  license?: unknown; rights?: unknown; license_url?: unknown; licenseUrl?: unknown;
  rights_source?: unknown; rightsSource?: unknown; language?: unknown; author?: unknown; format?: unknown;
  url?: unknown; source_native_id?: unknown; source_url?: unknown; blossom_url?: unknown; blossom_sha256?: unknown;
  locator?: { progression?: unknown; furthestProgression?: unknown; href?: unknown; locations?: { cfi?: unknown } };
  book?: { md5?: unknown };
}
export interface DesktopProgressApi {
  clampProgress(value: unknown): number;
  progressPosition(payload: ProgressInput | null | undefined): { progression: number; furthestProgression: number };
  isProgressAhead(candidate: ProgressInput | null | undefined, baseline: ProgressInput | null | undefined): boolean;
  normalizeProgressPayload(payload: ProgressInput | null | undefined, profile?: string): ProgressPayload | null;
}
