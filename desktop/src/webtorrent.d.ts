declare module 'webtorrent' {
  const Client: new (options: import('./torrent-types').ClientOptions) => import('./torrent-types').TorrentClient;
  export default Client;
}
