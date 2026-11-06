import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron, expect, test } from '@playwright/test';

test('quitting with pending download progress preserves resumable jobs without a database error', async () => {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, 'shutdown-user-data-'));
  const app = await electron.launch({ args: [path.join(__dirname, '../..'), `--user-data-dir=${profile}`] });
  let closed = false;
  let stderr = '';
  app.process().stderr!.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await app.evaluate(({ app }) => {
      const requireRuntime = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/main.js`);
      const { AcquisitionManager } = requireRuntime('./acquisition-manager');
      const original = AcquisitionManager.prototype.runLibgenAcquisition;
      AcquisitionManager.prototype.runLibgenAcquisition = function(
        book: Record<string, unknown>,
        options: { signal?: AbortSignal; onProgress?: (progress: unknown) => void; autoSeed?: boolean },
      ) {
        this.fetch = async () => ({ ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from('d4:test4:datae') });
        this.torrentBridge = {
          downloadSelected: async (_metadata: unknown, { signal, onProgress }: {
            signal: AbortSignal;
            onProgress: (progress: { bytes: number; totalBytes: number }) => void;
          }) => {
            const testGlobals = globalThis as typeof globalThis & {
              emitShutdownProgress: () => void;
              shutdownTransferStarted: boolean;
            };
            testGlobals.emitShutdownProgress = () => {
              onProgress({ bytes: 1, totalBytes: 10 });
              onProgress({ bytes: 2, totalBytes: 10 });
            };
            testGlobals.shutdownTransferStarted = true;
            await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('shutdown abort')), { once: true }));
          },
        };
        return original.call(this, book, options);
      };
    });
    const mainWindow = await app.firstWindow();
    await mainWindow.evaluate(() => (window as unknown as Window & {
      bookstrDesktop: { library: { enqueue(input: unknown): Promise<unknown> } };
    }).bookstrDesktop.library.enqueue({ kind: 'libgen', record: {
      md5: 'f'.repeat(32), libgenId: 2412930, title: 'Shutdown fixture', extension: 'pdf',
    } }));
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & {
      shutdownTransferStarted: boolean;
    }).shutdownTransferStarted)).toBe(true);
    await app.evaluate(() => (globalThis as typeof globalThis & {
      emitShutdownProgress: () => void;
    }).emitShutdownProgress());
    await app.close();
    closed = true;
    expect(stderr).not.toContain('database is not open');
    const db = new DatabaseSync(path.join(profile, 'library', 'library.sqlite'), { readOnly: true });
    try {
      const row = db.prepare('SELECT status, request_json FROM downloads WHERE book_id=?').get('f'.repeat(32)) as {
        status: string;
        request_json: string;
      } | undefined;
      const savedRow = row!;
      expect(['queued', 'finding-peers', 'downloading', 'retrying']).toContain(savedRow.status);
      expect(JSON.parse(savedRow.request_json).record.md5).toBe('f'.repeat(32));
    } finally { db.close(); }
  } finally {
    if (!closed) await app.close();
  }
});
