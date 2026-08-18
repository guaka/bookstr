import type { ReadingProgress } from '../types'

/** Accept v1 ReadingProgress and legacy Android {progression,cfi} payloads. */
export function normalizeProgress(
  raw: Record<string, unknown>,
  fallbackBookId: string,
  eventCreatedAtSec: number,
): ReadingProgress | null {
  const locatorRaw = raw.locator
  if (locatorRaw && typeof locatorRaw === 'object') {
    const loc = locatorRaw as Record<string, unknown>
    const progression = Number(loc.progression ?? 0)
    if (!Number.isFinite(progression)) return null
    const updatedAt =
      typeof raw.updatedAt === 'number' && raw.updatedAt > 0
        ? raw.updatedAt
        : eventCreatedAtSec * 1000
    return {
      v: 1,
      bookId: typeof raw.bookId === 'string' && raw.bookId ? raw.bookId : fallbackBookId,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      author: typeof raw.author === 'string' ? raw.author : undefined,
      locator: {
        href: typeof loc.href === 'string' ? loc.href : undefined,
        progression,
        cfi: typeof loc.cfi === 'string' ? loc.cfi : undefined,
      },
      updatedAt,
    }
  }

  if (typeof raw.progression === 'number') {
    return {
      v: 1,
      bookId: fallbackBookId,
      locator: {
        progression: raw.progression,
        cfi: typeof raw.cfi === 'string' ? raw.cfi : undefined,
      },
      updatedAt: eventCreatedAtSec * 1000,
    }
  }

  return null
}

export function progressDTag(bookId: string): string {
  return `app.bookstr.progress.${bookId}`
}

export function formatProgress(progression: number, suffix = '') {
  const percent = Math.max(0, Math.min(100, progression * 100))
  if (percent === 0) return `0%${suffix}`
  if (percent < 1) {
    const tenths = Math.max(0.1, Math.round(percent * 10) / 10)
    return `${tenths.toFixed(1)}%${suffix}`
  }
  return `${Math.round(percent)}%${suffix}`
}
