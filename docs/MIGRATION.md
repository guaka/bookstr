# Bookstr Electron library migration

The Electron client owns the local library, catalog index, search cache,
reader files, acquisition jobs, linked folders, and transfer state. Web, iOS,
and Android clients consume the same shared contracts but never receive
filesystem paths.

## Export/import

Migration uses a checksummed ZIP64 archive. The archive contains a versioned
manifest, verified book bytes, reading progress, favorites, collections, and
source metadata. Export writes a temporary archive, records SHA-256 and byte
size for every entry, then atomically renames it. Import verifies the manifest,
rejects path traversal and duplicate content claims, writes into a temporary
library directory, and swaps only after every checksum passes. The source
library is never modified by export.

Legacy provider global catalogs, service configuration, and secrets are
deliberately excluded. A user may re-add a provider through its explicit client
adapter; the core library remains source-neutral.

Large OAPEN collection torrents are not part of migration. OAPEN is fetched
per book over its direct API, so a 92 GB monolithic archive is not a required
dependency.
