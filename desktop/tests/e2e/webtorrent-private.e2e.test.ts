import type { LocalClient, LocalTorrent } from '../types/local-torrent';
import type { ClientOptions } from '../../src/torrent-types';
'use strict';

const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { once } = require('node:events') as typeof import('node:events');
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
const test: typeof import('node:test') = require('node:test');
const { WebTorrentBridge } = require('../../webtorrent-bridge') as typeof import('../../src/webtorrent-bridge');

function fixtureDirectory() {
  const root = path.join(process.cwd(), 'test-results');
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, 'webtorrent-private-'));
}

function waitForDone(torrent: LocalTorrent) {
  if (torrent.done) return Promise.resolve();
  return once(torrent, 'done').then(() => undefined);
}

async function realClient(options: ClientOptions): Promise<LocalClient> {
  const { default: WebTorrent } = await import('webtorrent');
  // The fixture is deliberately isolated from DHT, LSD, NAT mapping, and
  // trackers. Its only valid route is the explicit localhost peer handoff.
  const Constructor = WebTorrent as unknown as new(options: Record<string, unknown>)=>LocalClient;
  return new Constructor({
    ...options,
    dht: false,
    tracker: false,
    lsd: false,
    utPex: false,
    natUpnp: false,
    natPmp: false,
  });
}

test('Electron private transfer downloads a tiny EPUB through only a direct peer handoff', { timeout: 30_000 }, async () => {
  const root = fixtureDirectory();
  const senderData = path.join(root, 'sender');
  const receiverData = path.join(root, 'receiver');
  const source = path.join(root, 'fixture.epub');
  const bytes = Buffer.from('Bookstr local WebTorrent fixture — no tracker, DHT, or relay.');
  fs.writeFileSync(source, bytes);

  const receiverAdds: Array<Record<string, unknown>> = [];
  const sender = new WebTorrentBridge({ clientFactory: realClient, dataDir: senderData, trackers: ['ws://127.0.0.1:1'] });
  const receiver = new WebTorrentBridge({
    dataDir: receiverData,
    trackers: ['ws://127.0.0.1:1'],
    clientFactory: async options => {
      const client = await realClient(options);
      const add = client.add.bind(client);
      client.add = (id, torrentOptions) => {
        receiverAdds.push(torrentOptions);
        return add(id, torrentOptions);
      };
      return client;
    },
  });

  try {
    const senderClient = await sender.start() as LocalClient;
    await once(senderClient, 'listening');
    const seeded = await new Promise<LocalTorrent>((resolve, reject) => {
      try {
        senderClient.seed(source, { announce: [], private: true }, resolve);
      } catch (error) {
        reject(error);
      }
    });
    const torrent = await receiver.addPrivate(seeded.torrentFile, {
      peer: `127.0.0.1:${senderClient.torrentPort}`,
    });
    await waitForDone(torrent as LocalTorrent);

    assert.deepEqual(receiverAdds[0], {
      path: receiverData,
      private: true,
      announce: [],
      dht: false,
      tracker: false,
      utPex: false,
      lsd: false,
    });
    assert.equal(torrent.private, true);
    assert.deepEqual(fs.readFileSync(path.join(receiverData, 'fixture.epub')), bytes);
  } finally {
    await receiver.stop();
    await sender.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
