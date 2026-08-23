## Why

Favorites are currently one large encrypted Nostr payload that duplicates book
metadata. Large payloads exceed practical remote-signer limits, and the
favorites-only model cannot represent user-created reading lists. Bookstr also
needs Spotify-like list downloads without confusing portable collection
membership with device-local file state.

## What Changes

- Generalize Favorites into a built-in private book collection while allowing a
  book to belong to any number of independently named collections.
- Store only compact, resolvable book references, item order, and added times in
  collection events; fetch descriptive and publication metadata into local app
  caches.
- Add an encrypted collection index so clients can discover and name collections
  with one signer decryption rather than decrypting every collection.
- Split oversized collection contents into generation-specific encrypted chunks
  small enough for NIP-46/Amber and ordinary relay limits.
- Publish all chunks before publishing the root manifest, and retain the last
  complete local snapshot when a generation is incomplete.
- Add app-local Download list, retry, cancellation, aggregate progress, and
  optional Keep downloaded behavior. Download state and local file paths never
  enter Nostr collection events.
- Migrate readers before writers: accept the existing verbose favorite format
  and the compact collection format, then rewrite on the next successful edit.

## Capabilities

### New Capabilities

- `book-collections`: Private Favorites and user-created, ordered, many-to-many
  book collections synchronized through compact NIP-51 events.
- `collection-downloads`: Device-local bulk download and offline-availability
  behavior for Favorites and named collections.

## Impact

- LibVault web and Bookstr web, Android, and iOS share collection identifiers,
  compact book references, chunking, migration, and cache-safety rules.
- Existing kind `30003`, `d=libvault-favorites` events remain readable.
- User collection names and contents stay encrypted; public `d` tags use opaque
  identifiers and reveal only event activity and approximate collection size.
- A single local publication can satisfy Favorites and multiple named
  collections without duplicate downloads.
- This change depends on the favorite loading and signer foundations described
  by `align-android-nostr-library`.
