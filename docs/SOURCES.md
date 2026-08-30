# Bookstr source and torrent policy

Bookstr keeps source discovery separate from the local library and from the
WebTorrent data plane. A source may provide a `.torrent`, an HTTPS file, or
metadata only; the edition's SHA-256 and rights evidence are still required.

| Source | Language coverage | Delivery in Bookstr v1 | Rights rule | Status |
| --- | --- | --- | --- | --- |
| [Propagate](https://propagate.info) | Multilingual | Native torrent | Source-asserted public-domain policy; retain item evidence | Included |
| [Internet Archive](https://archive.org) | Multilingual | Item torrent or HTTPS | Item-level rights and borrowing terms required | Included |
| [Ebooks libres et gratuits](https://www.ebooksgratuits.com/torrent.php) | French | Native torrent | Source-asserted free/public-domain catalogue; preserve notice | Included |
| [Project Gutenberg](https://www.gutenberg.org/ebooks/offline_catalogs.html) | English plus Russian/Chinese catalogues | HTTPS/catalog metadata | Public-domain jurisdiction matters | Included |
| [Wikisource](https://wikisource.org/wiki/Wikisource:WS_Export/en) | Multilingual, including Russian/Chinese | HTTPS export | Per-work license template and jurisdiction required | Included |
| [OAPEN](https://www.oapen.org) | Multilingual academic | Direct per-book API | Item license evidence required | Included; 92 GB archive excluded |
| [LibriVox](https://librivox.org/pages/help/) | Multilingual | Audio files/torrents | Public-domain recording terms | Deferred until audio support |
| CBETA / ФЭБ | Chinese / Russian | — | Noncommercial or conflicting site terms | Excluded from public seeding |

The Electron client uses WebTorrent for both ordinary BitTorrent peers and
browser WebRTC peers. Public torrents use the two shared WSS trackers; private
same-account torrents have no trackers, DHT, PEX, or LSD and are negotiated by
NIP-17. Transmission is not required, and the OAPEN monolithic torrent is not
a dependency.
