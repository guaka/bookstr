import type { EventEmitter } from 'node:events';
import type { Torrent, TorrentClient } from '../../src/torrent-types';

export type LocalTorrent = Torrent & EventEmitter & {
  torrentFile: Buffer;
  addPeer(peer: string): unknown;
};

export type LocalClient = Omit<TorrentClient, 'add'> & EventEmitter & {
  listening: boolean;
  torrentPort: number;
  seed(input: string, options: { announce: string[]; private: boolean }, callback: (torrent: LocalTorrent) => void): LocalTorrent;
  add(id: string | Buffer, options: Record<string, unknown>): LocalTorrent;
};
