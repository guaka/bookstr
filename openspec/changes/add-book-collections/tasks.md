## 1. Shared protocol and models

- [ ] 1.1 Add shared test vectors for compact book references, collection roots,
      the collection index, legacy favorites, and both manifest spellings
- [ ] 1.2 Implement stable collection IDs, ordered many-to-many membership, and
      legacy-to-compact conversion in web, Android, and iOS models
- [ ] 1.3 Implement metadata resolvers and per-identity local metadata caches
      without treating resolution failure as removal
- [ ] 1.4 Keep `NOSTR.md` synchronized with the implemented rollout status and
      wire compatibility behavior

## 2. Safe Nostr collection synchronization

- [ ] 2.1 Read and cache `d=bookstr-collections`, named collection roots, compact
      direct roots, and generation-specific chunks on every client
- [ ] 2.2 Reject incomplete chunk generations atomically and retain the last
      complete cached collection
- [ ] 2.3 Split complete item tags at the 6,000-character target, publish chunks
      before the root, and cache only after the root succeeds
- [ ] 2.4 Add compact Favorites writing while continuing to read verbose legacy
      tags and the historical `libvault-chunks` marker
- [ ] 2.5 Add create, rename, reorder, and tombstone-backed delete operations for
      the encrypted collection index
- [ ] 2.6 Test signer rejection, relay partial failure, stale chunks, legacy
      migration, shrinking to a direct root, and cross-client fixtures

## 3. Collection product behavior

- [ ] 3.1 Keep the heart action scoped to the built-in Favorites collection
- [ ] 3.2 Add a multi-select Add to list action with inline collection creation
- [ ] 3.3 Add collection browsing, rename, description, delete, item removal,
      and manual item reordering
- [ ] 3.4 Show every collection containing a book without coupling memberships
- [ ] 3.5 Verify that unfavoriting, removing from one list, and deleting a list
      leave all other memberships unchanged

## 4. App-local collection downloads

- [ ] 4.1 Define a device-local download record keyed by resolved publication
      identity and shared across Favorites and named collections
- [ ] 4.2 Add Download list with resolution, queue deduplication, bounded
      concurrency, cancellation, and partial-success handling
- [ ] 4.3 Add per-item states and aggregate downloaded/total, failed, and
      unavailable counts with retry-failed behavior
- [ ] 4.4 Add an optional per-device Keep downloaded preference that queues newly
      added items without writing the preference or status to Nostr
- [ ] 4.5 Ensure membership removal and collection deletion do not cancel jobs or
      delete files; keep storage cleanup explicit
- [ ] 4.6 Test one file satisfying multiple collections, offline cached display,
      unavailable items, retries, cancellation, and restart recovery

## 5. Verification and rollout

- [ ] 5.1 Run dependency-free web regression tests
- [ ] 5.2 Run Android unit tests and assemble the debug APK
- [ ] 5.3 Run iOS parser, sync, cache, and download-manager tests
- [ ] 5.4 Exercise a 28,000-character legacy favorite list through Amber and
      verify every encryption request remains below the configured limit
- [ ] 5.5 Verify web, Android, and iOS can read and preserve the same Favorites
      and overlapping named-list memberships
