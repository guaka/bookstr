import { WebTorrentBridge } from '../../src/webtorrent-bridge';
import type { Torrent, TorrentClient, ClientOptions } from '../../src/torrent-types';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type IsAny<T> = 0 extends (1 & T) ? true : false;
type Bridge = InstanceType<typeof WebTorrentBridge>;
export type StartedClient = Expect<Equal<Awaited<ReturnType<Bridge['start']>>, TorrentClient>>;
export type SelectedTorrent = Expect<Equal<Awaited<ReturnType<Bridge['downloadSelected']>>['torrent'], Torrent>>;
export type SelectedPath = Expect<Equal<Awaited<ReturnType<Bridge['downloadSelected']>>['filePath'], string>>;
export type ClientIsTyped = Expect<Equal<IsAny<TorrentClient>, false>>;
export type NativeClientOptions = Expect<Equal<ConstructorParameters<typeof import('webtorrent')['default']>[0], ClientOptions>>;
