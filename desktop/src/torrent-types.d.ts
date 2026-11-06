export type Listener = (error?: unknown) => void;
export interface TorrentFile {
  path?: string; name?: string; length?: number; downloaded?: number; done?: boolean;
  select?(priority: number): void;
  once?(event: string, listener: Listener): unknown;
}
export interface Torrent {
  length?: number; files: TorrentFile[]; infoHash?: string; infohash?: string; name?: string; path?: string;
  magnetURI?: string; torrentFile?: Buffer; progress?: number; downloaded?: number; uploaded?: number;
  wires?: unknown[]; numPeers?: number; downloadSpeed?: number; uploadSpeed?: number;
  done?: boolean; ready?: boolean; destroyed?: boolean; private?: boolean;
  bookstrBookId?: string; bookstrBookIds?: Set<string>; bookstrSeedingBookIds?: Set<string>;
  on(event: string, listener: Listener): unknown;
  once(event: string, listener: Listener): unknown;
  removeListener?(event: string, listener: Listener): unknown;
  addPeer?(peer: string): unknown;
  destroy?(): void;
}
export interface IceServer { urls: string | string[]; username?: string; credential?: string }
export interface WebRTC { RTCPeerConnection?: unknown; [key: string]: unknown }
export interface ClientOptions {
  downloadLimit: number; uploadLimit: number; maxConns: number; path?: string;
  tracker?: { wrtc: WebRTC | null | undefined; rtcConfig: { iceServers: readonly IceServer[] } };
}
export interface TorrentClient {
  torrents: Torrent[];
  seed(input: string, options: SeedOptions, callback: (torrent?: Torrent) => void): Torrent | undefined;
  add(id: string | Buffer, options: Record<string, unknown>): Torrent;
  get?(id: string | Buffer): Promise<Torrent | null>;
  remove?(torrent: Torrent): Promise<void>;
  destroy(callback: () => void): void;
  throttleDownload?(limit: number): void;
  throttleUpload?(limit: number): void;
}
export interface SeedOptions { name: string; announceList: string[][]; pieceLength: number; info: { source: string }; path?: string }
