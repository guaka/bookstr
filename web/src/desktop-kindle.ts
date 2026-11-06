(function <T extends object>(root: typeof globalThis & { BookstrDesktopKindle?: unknown }, factory: () => T) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BookstrDesktopKindle = api;
})(globalThis as typeof globalThis & { BookstrDesktopKindle?: unknown }, function() {
  'use strict';
  interface DownloadJob { bookId: string; title?: string; extension?: string; status: string }
  interface TransferProgress {
    bookId?: string; title?: string; phase: string; percent?: number; page?: number; pages?: number;
    done?: boolean; completed?: number; error?: unknown;
  }
  interface TransferResult {
    transferred: string[]; alreadyPresent?: number;
    errors?: Array<{ bookId: string; error: string }>;
    skipped?: Array<{ bookId?: string; title?: string; reason: string }>;
  }
  interface OverviewItem { bookId: string; title: string; status: string }
  interface OverviewState {
    running: boolean; message: string; completed: number; total: number; value: number; max: number;
    determinate: boolean; items: OverviewItem[];
  }
  interface PresenceEntry { books: Set<string>; failures: Set<string>; revision: number }
  interface PresenceToken { id: string; value: PresenceEntry; revision: number }

  function transferableDownloads<Job extends DownloadJob>(jobs: readonly Job[]): Job[] {
    return jobs.filter(job => ['ready', 'seeding'].includes(job.status)
      && (/^(pdf|txt|cbz|cbr)$/i.test(job.extension || '')
        || (String(job.extension).toLowerCase() === 'epub' && /\.(cbz|cbr)$/i.test(job.title || ''))));
  }
  function progressText(progress: TransferProgress): string {
    const phase = ({ converting: 'Converting', checking: 'Checking existing books', copying: 'Copying', verifying: 'Verifying', copied: 'Copied', failed: 'Failed' } as Record<string, string>)[progress.phase] || 'Copying';
    const title = progress.title ? ` ${progress.title}` : '';
    const percent = Number.isFinite(progress.percent) ? ` · ${Math.max(0, Math.min(100, Math.round(progress.percent!)))}%` : '';
    const pages = Number.isInteger(progress.page) && Number.isInteger(progress.pages) ? ` · ${progress.page}/${progress.pages} pages` : '';
    return phase + title + percent + pages;
  }
  function createTransferOverview() {
    let state: OverviewState | undefined;
    function start(books: readonly Pick<DownloadJob, 'bookId' | 'title'>[]): void {
      state = { running: true, message: 'Preparing Kindle transfer…', completed: 0,
        total: books.length, value: 0, max: 1, determinate: false,
        items: books.map(book => ({ bookId: book.bookId, title: book.title || book.bookId, status: 'Waiting' })) };
    }
    function update(progress: TransferProgress): void {
      if (!state?.running || progress.done) return;
      const current = state!;
      current.message = progressText(progress);
      const item = current.items.find(book => book.bookId === progress.bookId);
      if (item) item.status = progress.phase === 'copied' ? 'Copied' : progress.phase === 'failed' ? `Failed: ${progress.error}` : current.message;
      if (Number.isInteger(progress.completed)) current.completed = Math.max(0, Math.min(current.total, progress.completed!));
      const percent = Number.isFinite(progress.percent) ? progress.percent
        : Number.isInteger(progress.page) && progress.pages! > 0 ? progress.page! / progress.pages! * 100 : null;
      current.determinate = percent !== null;
      current.value = percent === null ? 0 : Math.max(0, Math.min(100, percent!));
      current.max = 100;
    }
    function finish(result: TransferResult): void {
      const current = state!;
      current.running = false;
      const transferred = new Set(result.transferred);
      const errors = result.errors || [];
      const skipped = result.skipped || [];
      current.completed = transferred.size;
      current.message = `${transferred.size} copied · ${result.alreadyPresent || 0} already there · ${skipped.length} skipped · ${errors.length} failed`;
      let alreadyRemaining = Math.max(0, Number(result.alreadyPresent) || 0);
      for (const item of current.items) {
        const error = errors.find(error => error.bookId === item.bookId);
        const skip = skipped.find(skip => skip.bookId === item.bookId || skip.title === item.title);
        item.status = transferred.has(item.bookId) ? 'Copied' : error ? `Failed: ${error.error}`
          : skip ? `Skipped: ${skip.reason}` : alreadyRemaining-- > 0 ? 'Already on Kindle' : 'Not completed';
      }
      current.determinate = true;
      current.max = Math.max(1, current.total);
      current.value = current.max;
    }
    function fail(error: { message?: string } | string): void {
      const current = state!;
      current.running = false;
      current.message = typeof error === 'string' ? error : error?.message || String(error);
      current.determinate = false;
      for (const item of current.items) if (item.status !== 'Copied') item.status = 'Not completed';
    }
    return { start, update, finish, fail, snapshot: (): OverviewState | undefined => state };
  }
  function createLibraryPresence() {
    const devices = new Map<string, PresenceEntry>();
    function entry(id: string): PresenceEntry {
      if (!devices.has(id)) devices.set(id, { books: new Set(), failures: new Set(), revision: 0 });
      return devices.get(id)!;
    }
    return {
      has(id: string, bookId: string) { return Boolean(devices.get(id)?.books.has(bookId)); },
      failed(id: string, bookId: string) { return Boolean(devices.get(id)?.failures.has(bookId)); },
      fail(id: string, bookId: string) { const value = entry(id); value.revision++; value.books.delete(bookId); value.failures.add(bookId); },
      begin(id: string): PresenceToken { const value = entry(id); return { id, value, revision: value.revision }; },
      apply(token: PresenceToken, bookIds: readonly string[]): boolean {
        if (devices.get(token.id) !== token.value || token.value.revision !== token.revision) return false;
        token.value.books = new Set(bookIds);
        for (const id of bookIds) token.value.failures.delete(id);
        return true;
      },
      mark(id: string, bookIds: readonly string[]): void {
        const value = entry(id);
        value.revision++;
        for (const bookId of bookIds) { value.books.add(bookId); value.failures.delete(bookId); }
      },
      retain(ids: readonly string[]): void {
        for (const id of devices.keys()) if (!ids.includes(id)) devices.delete(id);
      },
    };
  }
  return { transferableDownloads, progressText, createLibraryPresence, createTransferOverview };
});

export interface KindleDownloadJob { bookId: string; title?: string; extension?: string; status: string }
export interface KindleTransferProgress {
  bookId?: string; title?: string; phase: string; percent?: number; page?: number; pages?: number;
  done?: boolean; completed?: number; error?: unknown;
}
export interface KindleOverviewItem { bookId: string; title: string; status: string }
export interface KindleOverviewState {
  running: boolean; message: string; completed: number; total: number; value: number; max: number;
  determinate: boolean; items: KindleOverviewItem[];
}
export interface DesktopKindleApi {
  transferableDownloads<Job extends KindleDownloadJob>(jobs: readonly Job[]): Job[];
  progressText(progress: KindleTransferProgress): string;
  createTransferOverview(): {
    start(books: readonly Pick<KindleDownloadJob, 'bookId' | 'title'>[]): void;
    update(progress: KindleTransferProgress): void;
    finish(result: { transferred: string[]; alreadyPresent?: number; errors?: Array<{ bookId: string; error: string }>; skipped?: Array<{ bookId?: string; title?: string; reason: string }> }): void;
    fail(error: { message?: string } | string): void;
    snapshot(): KindleOverviewState | undefined;
  };
  createLibraryPresence(): {
    has(id: string, bookId: string): boolean;
    failed(id: string, bookId: string): boolean;
    fail(id: string, bookId: string): void;
    begin(id: string): { id: string; value: { books: Set<string>; failures: Set<string>; revision: number }; revision: number };
    apply(token: { id: string; value: { books: Set<string>; failures: Set<string>; revision: number }; revision: number }, bookIds: readonly string[]): boolean;
    mark(id: string, bookIds: readonly string[]): void;
    retain(ids: readonly string[]): void;
  };
}
