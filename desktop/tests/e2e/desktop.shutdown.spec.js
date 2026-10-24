const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { _electron: electron, test, expect } = require('@playwright/test');

test('quitting with pending download progress preserves resumable jobs without a database error', async () => {
  const output = path.join(__dirname, '../../test-results');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(output, 'shutdown-user-data-'));
  const app = await electron.launch({ args: [path.join(__dirname, '../..'), `--user-data-dir=${profile}`] });
  let closed = false;
  let stderr = '';
  app.process().stderr.on('data', chunk => { stderr += chunk.toString(); });
  try {
    await app.evaluate(({ app }) => {
      const requireRuntime = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/main.js`);
      const { AcquisitionManager } = requireRuntime('./acquisition-manager');
      const original = AcquisitionManager.prototype.runLibgenAcquisition;
      AcquisitionManager.prototype.runLibgenAcquisition = function(book, options) {
        this.fetch = async () => ({ ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from('d4:test4:datae') });
        this.torrentBridge = {
          downloadSelected: async (_metadata, { signal, onProgress }) => {
            globalThis.emitShutdownProgress = () => {
              onProgress({ bytes: 1, totalBytes: 10 });
              onProgress({ bytes: 2, totalBytes: 10 });
            };
            globalThis.shutdownTransferStarted = true;
            await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('shutdown abort')), { once: true }));
          },
        };
        return original.call(this, book, options);
      };
    });
    const window = await app.firstWindow();
    await window.evaluate(() => window.bookstrDesktop.library.enqueue({ kind: 'libgen', record: {
      md5: 'f'.repeat(32), libgenId: 2412930, title: 'Shutdown fixture', extension: 'pdf',
    } }));
    await expect.poll(() => app.evaluate(() => globalThis.shutdownTransferStarted)).toBe(true);
    await app.evaluate(() => globalThis.emitShutdownProgress());
    await app.close();
    closed = true;
    expect(stderr).not.toContain('database is not open');
    const db = new DatabaseSync(path.join(profile, 'library', 'library.sqlite'), { readOnly: true });
    try {
      const row = db.prepare('SELECT status, request_json FROM downloads WHERE book_id=?').get('f'.repeat(32));
      expect(['queued', 'finding-peers', 'downloading', 'retrying']).toContain(row.status);
      expect(JSON.parse(row.request_json).record.md5).toBe('f'.repeat(32));
    } finally { db.close(); }
  } finally {
    if (!closed) await app.close();
  }
});
