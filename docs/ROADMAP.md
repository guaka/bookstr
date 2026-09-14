# Bookstr Electron roadmap

The current mobile acquisition plan is [Libcat and direct torrent reading](libcat-reading.md).

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
- [x] Electron WebTorrent bridge with public rights gating, private discovery
      disabled, and validated peer-address handoff.
- [x] Browser WebTorrent adapter with matching public/private boundaries and
      simple-peer signal-to-`addPeer()` handoff.
- [x] Registry of legal/open sources and per-item rights policy hooks.
- [x] Source-record normalization plus an Electron acquisition manager with
      HTTPS/torrent fallback, bounded retries, progress, and verified import.
- [x] Persistent source health, cooldowns, latency tracking, and deterministic
      failover ordering.
- [x] Device registry mutation, presence/request builders, and authorization
      checks for the private pairing control plane.
- [x] Electron pairing adapter with encrypted device-key persistence when the
      OS keyring is available, and session-only behavior otherwise.
- [x] Shared web/WebView pairing adapter with injected NIP-07/native signer,
      relay publisher, and OS-secure storage capabilities.

## Remaining implementation slices

1. **Native mobile host bridges.** Connect the shared adapter to the existing
   iOS Keychain and Android encrypted-preferences/Keystore wrappers, plus each
   platform's Nostr relay client and NIP-44 signer.
2. **Optional public metadata host opt-in.** The shared NIP-94 event contract
   now enforces rights, completed verification, explicit operator intent, and
   HTTPS-only locators. Wire a visible per-host publish action only after the
   local verification path has release coverage.
3. **Local WebTorrent end-to-end coverage.** The hermetic tiny-EPUB fixture
   now covers Electron-to-Electron private transfer through a direct peer
   handoff, and runs in Electron CI. Remaining browser coverage depends on
   shipping and instantiating a browser WebTorrent runtime in the static web
   client:

   - [x] Electron-to-Electron private transfer: direct `127.0.0.1:port` peer
     handoff; no tracker, DHT, LSD, NAT mapping, relay, or real book file.
   - [ ] Browser-to-browser private WebRTC offer/answer with no tracker or DHT.
   - [ ] Browser-to-Electron public interoperability through a disposable local
     WebSocket tracker.

## Release gates

- A file is readable only after size and complete SHA-256 verification.
- No IPC, Nostr, or browser message exposes a local filesystem path.
- Private transfers cannot discover peers through public trackers or DHT.
- Public seeding is impossible without explicit allowed redistribution rights.
- OAPEN's 92 GB collection torrent remains out of scope; per-book retrieval is
  the supported path.
