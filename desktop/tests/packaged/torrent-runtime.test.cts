import type { LocalClient, LocalTorrent } from '../types/local-torrent';
const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs: typeof import('node:fs') = require('node:fs');
const os: typeof import('node:os') = require('node:os');
const path: typeof import('node:path') = require('node:path');
const { _electron } = require('@playwright/test') as typeof import('@playwright/test');

test('the packaged app loads its real torrent dependencies and transfers a local book', { timeout: 60000 }, async () => {
  const executablePath = process.env.BOOKSTR_PACKAGED_EXECUTABLE;
  assert.ok(executablePath, 'Set BOOKSTR_PACKAGED_EXECUTABLE to the built Electron executable.');
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-packaged-torrent-')));
  let app: import('@playwright/test').ElectronApplication | undefined;
  try {
    app = await _electron.launch({ executablePath, args: [`--user-data-dir=${profile}`, '--js-flags=--max-old-space-size=512'] });
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    assert.equal(await page.title(), 'libstr');
    assert.deepEqual(await page.evaluate(() => window.bookstrDesktop!.library.downloads()), []);
    const result = await app.evaluate(async ({ app }, directory) => {
      const fs = process.getBuiltinModule('fs');
      const path = process.getBuiltinModule('path');
      const { createRequire } = process.getBuiltinModule('module');
      const { once } = process.getBuiltinModule('events');
      const packagedRequire = createRequire(path.join(app.getAppPath(), 'package.json'));
      const entry = packagedRequire.resolve('webtorrent');
      const { WebTorrentBridge } = packagedRequire('./desktop/webtorrent-bridge.js') as typeof import('../../src/webtorrent-bridge');
      const bridge = new WebTorrentBridge({ dataDir: directory });
      const options = { dht: false, tracker: false, lsd: false, utp: false, utPex: false, natUpnp: false, natPmp: false };
      const createClient = (bridge as unknown as {clientFactory(options:Record<string,unknown>):Promise<LocalClient>}).clientFactory.bind(bridge);
      const sender = await createClient(options);
      const receiver = await createClient(options);
      const source = path.join(directory, 'source', 'fixture.epub');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      const payload = Buffer.from('Bookstr packaged torrent regression: localhost only.');
      fs.writeFileSync(source, payload);
      try {
        if (!sender.listening) await once(sender, 'listening');
        const seeded = await new Promise<LocalTorrent>(resolve => sender.seed(source, { announce: [], private: true }, resolve));
        const download = receiver.add(seeded.torrentFile, { path: path.join(directory, 'received'), announce: [], private: true });
        if (!download.ready) await once(download, 'ready');
        download.addPeer(`127.0.0.1:${sender.torrentPort}`);
        if (!download.done) await once(download, 'done');
        const bytes = fs.readFileSync(path.join(directory, 'received', 'fixture.epub'));
        return { packaged: entry.startsWith(app.getAppPath() + path.sep), matches: bytes.equals(payload), bytes: bytes.length, private: download.private };
      } finally {
        await Promise.all([sender, receiver].map(client => new Promise<void>(resolve => client.destroy(resolve))));
      }
    }, profile);
    assert.deepEqual(result, { packaged: true, matches: true, bytes: 52, private: true });
  } finally {
    await app?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
