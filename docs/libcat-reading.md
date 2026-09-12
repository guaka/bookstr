# Libcat and encrypted device reading

Libcat keeps large metadata catalogs on a storage host. Electron and iPhone use
private NIP-17 requests; Libcat never transfers book contents. Electron handles
torrents and local acquisition, then encrypts each file before sending ciphertext
to an HTTPS relay. The relay streams from Electron's outbound WebSocket without
persisting files. iPhone authenticates and decrypts the download into private
staging before importing it into its offline library.

## Implemented in this branch

- Electron/web private searches and torrent metadata resolution target Libcat at
  public key `83503e3e82744479362b04881a8f240bd6d838b78430035868f1c0826ec3876f`
  on `wss://relay.nomadwiki.org`. Public catalog search remains available without
  signing in. Libcat is allowlisted, so the connected account must be authorized.
- The search helper accepts an explicit service configuration. Pages contain at
  most 50 records; the More control appends and deduplicates results. Failed pages
  remain retryable. Private results are not written into the public search cache.
- Main-process file encryption/decryption, a streaming relay server module, and
  an outbound relay client have integration tests using real signed WebSockets,
  HTTP Range requests, disconnection/reconnection, expiry, and revocation.
- Swift decrypts the same format. A shared deterministic fixture checks Node to
  CryptoKit interoperability. Failed authentication and checksum verification
  remove the partial plaintext file rather than importing it.

## Transfer format v1

`desktop/encrypted-transfer.js` and
`ios/BookstrIOS/Sources/Data/EncryptedBookTransfer.swift` use independent AES-256-GCM
records with 4 MiB plaintext chunks. Each offer uses a fresh 32-byte key, a fresh
16-byte transfer ID, and an 8-byte nonce prefix. The nonce adds a big-endian
32-bit record index; authenticated data binds protocol version, transfer ID,
plaintext size, and record index. Each ciphertext record includes its 16-byte
tag. Final SHA-256 verifies the complete plaintext. The maximum file is 8 GiB.

The relay sees a transfer ID, ciphertext size, expiry, and a hash of an opaque
bearer capability. It never receives the decryption key or plaintext metadata.
A signed challenge authenticates the Electron connection against an allowlist.
GET/HEAD `/v1/files/<transfer-id>` requires the bearer capability. Explicit byte
ranges support resuming; streams return unavailable when Electron is disconnected.

## Integration still required

This is not yet an end-to-end phone download feature. Complete these before
releasing or retiring LibVault:

1. Wire the relay client into Electron acquisition, persistent transfer jobs, and
   paired-device authorization. Send offers/keys only inside private device
   messages; retain secrets through Electron safeStorage and iOS Keychain.
2. Add native Libcat NIP-17 queries and pagination to iPhone Search.
3. Add iOS background URLSession downloads, resumption and verified library
   import, with phone UI and background lifecycle tests.
4. Choose and deploy a configurable public HTTPS relay endpoint. The server module
   currently has no production deployment or standalone service packaging.
5. Exercise a real paired desktop/iPhone flow, restart recovery, revocation,
   offline reading and reading-position synchronization. Complete remaining
   branch coverage before moving the implementation out of draft.

Libcat is deployed separately on `b.bfr.ee`; its admin and migration instructions
are in the LibVault repository's `LIBCAT.md`. Legacy services remain available.
