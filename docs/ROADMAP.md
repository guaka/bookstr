# Bookstr Electron roadmap

This roadmap is intentionally small. It describes the work needed to make the
Electron shell a useful local library while keeping the web, iOS, and Android
clients on the same contracts.

## Decision record

- **One peer stack:** WebTorrent is used by Electron and browser-capable
  clients. Nostr is the encrypted control plane, not a byte transport.
- **Source-neutral library:** legal source adapters provide metadata, rights
  evidence, HTTPS, or torrent locators; the local library stores verified
  editions by SHA-256.
- **Private by default:** device presence, manifests, and transfer negotiation
  are account-authorized NIP-17 messages. Public seeding requires explicit
  redistribution rights and operator opt-in.
- **Deferred infrastructure:** no Transmission wrapper, Iroh dependency, Tor
  daemon, or monolithic collection torrent is required for the first release.

## Status in this PR

- [x] Shared rights, source, device-transfer, and torrent-metadata contracts.
- [x] Electron SQLite library index with FTS5 search and CJK fallback.
- [x] Path-safe reader tokens, linked folders, and download state.
- [x] Atomic SHA-256 file import with checksum and traversal checks.
- [x] Electron WebTorrent bridge with public rights gating and private discovery
      disabled.
- [x] Browser WebTorrent adapter with matching public/private boundaries.
- [x] Registry of legal/open sources and per-item rights policy hooks.

## Next implementation slices

1. **Source adapters and acquisition.** Normalize source metadata and rights
   evidence, choose HTTPS or native torrents, and persist the source trail.
2. **Transfer manager.** Connect source selection, progress, retries,
   completion checks, and the importer so no unverified file is opened.
3. **Account pairing.** Wire device registry, presence, paginated manifests,
   and offer/answer messages to each platform's Nostr signer and secure store.
4. **Health and failover.** Track source availability, rank verified sources,
   and fall back without changing the edition's SHA-256 identity.
5. **Optional public metadata.** Add rights-gated, operator-opt-in NIP-94
   publication only after the local verification path is stable.

## Release gates

- A file is readable only after size and complete SHA-256 verification.
- No IPC, Nostr, or browser message exposes a local filesystem path.
- Private transfers cannot discover peers through public trackers or DHT.
- Public seeding is impossible without explicit allowed redistribution rights.
- OAPEN's 92 GB collection torrent remains out of scope; per-book retrieval is
  the supported path.
