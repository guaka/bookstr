# Libcat and encrypted device reading

Libcat keeps large metadata catalogs on a storage host. Electron and iPhone use
private NIP-17 requests; Libcat never transfers book contents. Electron handles
torrents and local acquisition, then encrypts each file before sending ciphertext
to Blossom. Nostr carries private transfer references and decryption keys.
iPhone downloads ciphertext over HTTPS, verifies and decrypts it into private
staging, then imports the book into its offline library. This is the selected
architecture; the complete upload/download integration is not yet implemented.

## Implemented components

- Electron/web private searches and torrent metadata resolution target Libcat at
  public key `83503e3e82744479362b04881a8f240bd6d838b78430035868f1c0826ec3876f`
  on `wss://relay.nomadwiki.org`. Public catalog search remains available without
  signing in. Libcat is allowlisted, so the connected account must be authorized.
- The search helper accepts an explicit service configuration. Pages contain at
  most 50 records; the More control appends and deduplicates results. Failed pages
  remain retryable. Private results are not written into the public search cache.
- Main-process file encryption/decryption is tested. The experimental custom
  streaming relay and client have been removed in favor of the existing Blossom
  proof of concept.
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

## Encrypted Blossom retention: 30 days

The user selected a fixed retention window of **30 days from successful upload**
(2,592,000 seconds, measured in UTC), not 30 days from last access. Downloading,
reading, or syncing progress does not extend the window.

- Keep the encrypted server copy for the full window, even after iPhone downloads
  it. Record its ciphertext hash, owner, upload completion time, and expiry.
- At expiry, remove the encrypted transfer blob from the managed Blossom server.
  Leave local Electron/iPhone books, saved metadata, and reading progress intact.
- Cleanup must run on the server or an always-on service; an Electron timer cannot
  enforce retention while the computer sleeps. Track failures and retry cleanup.
- If a device needs the file after expiry, Electron must be available to create a
  new encrypted upload with a fresh key and its own 30-day window.
- Apply this policy only to newly created encrypted Bookstr transfer blobs.
  Existing Blossom publications, catalogs, and unrelated files are outside it.
- The short `expiration` in a Blossom authorization event expires the request's
  authorization, not the stored file. It does not implement this retention policy.

Server-side retention enforcement is still required. Do not present a local
expiry field or an authorization expiration as proof of server deletion.

## Integration still required

This is not yet an end-to-end phone download feature. Complete these before
releasing or retiring LibVault:

1. Add native Libcat NIP-17 queries and pagination to iPhone Search.
2. Connect Electron acquisition and encryption to Blossom upload and persist
   upload jobs. Send file references and keys only inside private device messages;
   protect keys through Electron safeStorage and iOS Keychain.
3. Implement and verify the 30-day server-side retention policy above, including
   cleanup while Electron is offline. Verify deletion targets only owned transfer
   ciphertext and does not remove local books or existing publications.
4. Add iOS background URLSession downloads, resumption and verified library import,
   with phone UI and background lifecycle tests. An uploaded file stays available
   during its retention window even if Electron is asleep.
5. Validate search, edition selection, interrupted downloads, reopening, offline
   EPUB/PDF reading, and cross-device progress on real Electron and iPhone builds.
   Check typography, chapters, bookmarks, keyboard/touch navigation, rotation and
   accessibility; preserve location through layout changes and relaunch.
6. Verify progress against the same edition: desktop to iPhone, offline changes,
   then back to desktop, including duplicate and stale sync events. Do not map
   EPUB locations between different files using title similarity alone.
7. Retire LibVault only after those release gates pass and active downloads and
   indexing have been audited. Preserve the catalog database, WALs and dumps.

This document supersedes the proposed reading plan in Bookstr PR #87, preserving
its offline-reading and progress acceptance criteria under the selected transport.
Libcat is deployed separately on `b.bfr.ee`; its admin and migration instructions
are in the LibVault repository's `LIBCAT.md`. Legacy services remain available.
