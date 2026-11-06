import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import type { App } from 'electron';

export async function importAndOpenBook(file: string,
  importer: InstanceType<typeof import('./library-import').LibraryImporter>,
  store: InstanceType<typeof import('./library-store').LibraryStore>,
  openReader: (payload: unknown) => void) {
  const imported = await importer.importFile(file);
  const book = store.getBook(imported.sha256) || store.upsertBook({
    id: imported.sha256, sha256: imported.sha256,
    title: path.basename(file, path.extname(file)), extension: imported.extension,
    filesize_bytes: imported.size, source: 'local-import',
  });
  store.registerLibraryFile({ bookId: book.id, relativePath: imported.relativePath,
    sizeBytes: imported.size, sha256: imported.sha256 });
  store.setDownload({ bookId: book.id, status: 'ready', bytes: imported.size,
    totalBytes: imported.size, source: 'local-import', relativePath: imported.relativePath });
  const bytes = await readFile(importer.resolveRelativePath(imported.relativePath));
  openReader({ kind: imported.extension, base64: bytes.toString('base64'),
    book: { ...book, md5: book.id } });
}

/** Queue OS file requests until storage and the reader window are ready. */
export class OpenBooks {
  private pending: string[] = [];
  private ready = false;
  private draining = false;

  constructor(app: Pick<App, 'on'>, private open: (file: string) => Promise<void>,
    private reportError: (error: unknown) => void) {
    app.on('open-file', (event, file) => {
      event.preventDefault();
      void this.receive(file);
    });
    app.on('second-instance', (_event, argv, cwd) => {
      for (const file of argv.slice(1)) void this.receive(file, cwd);
    });
  }

  async receive(file: string, cwd = process.cwd()): Promise<void> {
    if (file.startsWith('file:')) {
      try { file = fileURLToPath(file); }
      catch { return; }
    } else if (/^[a-z]+:\/\//i.test(file)) return;
    if (file.startsWith('-') || !['.epub', '.pdf'].includes(path.extname(file).toLowerCase())) return;
    this.pending.push(path.resolve(cwd, file));
    if (this.ready) await this.drain();
  }

  async start(argv: string[]): Promise<void> {
    for (const file of argv.slice(1)) await this.receive(file);
    this.ready = true;
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let file: string | undefined;
      while ((file = this.pending.shift()) !== undefined) {
        try { await this.open(file); }
        catch (error) { this.reportError(error); }
      }
    } finally { this.draining = false; }
  }
}
