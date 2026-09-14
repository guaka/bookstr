# Libcat and direct torrent reading

Libcat keeps large metadata catalogs on a storage host. Electron, the web app,
and iPhone use private NIP-17 requests for search and torrent metadata. Libcat
does not transfer book contents.

## Implemented flow

- Signed-in clients search Libcat at the configured public key and relay. Public
  catalog search remains available without a signer.
- Catalog invitations let packaged Electron and iPhone builds save a Libcat
  identity and relay after explicit confirmation.
- Private search pages contain at most 50 records. Additional pages append and
  deduplicate results, failed pages remain retryable, and private results are not
  written to the public search cache.
- Electron resolves catalog editions and downloads them through its existing
  torrent support.
- iPhone resolves an edition's torrent metadata and downloads the selected file
  directly while Bookstr is in the foreground. Independent jobs are journaled,
  partial data is preserved, and unfinished downloads resume after relaunch.
- Completed files are checked against their catalog MD5 and optional expected
  size before they enter the offline library.

The iPhone engine supports DHT, PEX, and HTTP or UDP trackers. HTTPS trackers and
web seeds are not currently supported, so completion still depends on reachable
peers or compatible trackers. Downloads pause when the app leaves the foreground.

## Release validation

Before relying on this path as the only acquisition route:

1. Validate invitation, search, pagination, edition selection, interrupted
   downloads, relaunch recovery, and offline EPUB, PDF, FB2, and comic reading on
   real packaged Electron and iPhone builds.
2. Exercise unavailable peers, malformed torrent metadata, wrong file hashes,
   duplicate selections, low storage, cancellation, and retry without losing
   valid partial data.
3. Verify reading progress against the same edition across desktop and iPhone,
   including offline changes and duplicate or stale sync events.
4. Keep catalog databases, dumps, and any legacy service data until migration is
   verified independently of Bookstr client releases.
