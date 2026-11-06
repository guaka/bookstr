interface ProgressEvent {tags?:unknown[];content?:unknown;created_at?:unknown}
const __bookstrNostrProgressApi = (function initBookstrNostrProgress(root: typeof globalThis) {
  const DEFAULT_D_TAG_PREFIX = 'app.bookstr.progress.';

  function numeric(value: unknown, fallback: number) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function text(value: unknown) {
    return typeof value === 'string' ? value : '';
  }

  function dTagBookId(event: ProgressEvent | null | undefined, prefix: string) {
    const tag = Array.isArray(event?.tags)
      ? event.tags.find(item => Array.isArray(item) && item[0] === 'd' && text(item[1]).startsWith(prefix))
      : null;
    return tag ? text((tag as unknown[])[1]).slice(prefix.length).trim() : '';
  }

  function parseProgressEvent(event: ProgressEvent | null | undefined, fallbackBookId = '', dTagPrefix = DEFAULT_D_TAG_PREFIX) {
    try {
      const candidate: unknown = typeof event?.content === 'string' ? JSON.parse(event.content) : event?.content;
      const payload = candidate as Record<string,unknown> | null;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
      const hasLocator = Object.prototype.hasOwnProperty.call(payload, 'locator');
      const locator = payload.locator && typeof payload.locator === 'object' && !Array.isArray(payload.locator)
        ? payload.locator as Record<string,unknown>
        : null;
      if (hasLocator && !locator) return null;
      const hasLegacyLocation = Object.prototype.hasOwnProperty.call(payload, 'progression')
        || Object.prototype.hasOwnProperty.call(payload, 'cfi');
      if (payload.deleted !== true && !locator && !hasLegacyLocation) return null;

      const bookId = text(payload.bookId).trim()
        || text(fallbackBookId).trim()
        || dTagBookId(event, dTagPrefix);
      if (!bookId) return null;
      const createdAt = numeric(event?.created_at, 0) * 1000;
      const payloadUpdatedAt = numeric(payload.updatedAt, 0);
      const updatedAt = payloadUpdatedAt > 0 ? Math.trunc(payloadUpdatedAt) : Math.trunc(createdAt);
      if (payload.deleted === true) return { payload, bookId, updatedAt, deleted: true };

      const progression = numeric(locator ? locator.progression : payload.progression, 0);
      const furthest = numeric(locator?.furthestProgression ?? payload.furthestProgression, progression);
      const locations = locator?.locations && typeof locator.locations === 'object' ? locator.locations as Record<string,unknown> : null;
      const cfi = text(locator?.cfi) || text(locations?.cfi) || text(locator?.href) || text(payload.cfi);
      return {
        payload,
        bookId,
        updatedAt,
        deleted: false,
        progression,
        furthestProgression: Math.max(progression, furthest),
        cfi,
      };
    } catch {
      return null;
    }
  }

  const __bookstrNostrProgressApi = { DEFAULT_D_TAG_PREFIX, parseProgressEvent };
  (root as typeof globalThis & {BookstrNostrProgress: unknown}).BookstrNostrProgress = __bookstrNostrProgressApi;
  return __bookstrNostrProgressApi;
})(globalThis);
export type NostrProgressApi = typeof __bookstrNostrProgressApi;
