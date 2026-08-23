## Context

The current favorite event carries repeated URLs, title/author metadata, ISBN,
LibVault metadata, and Blossom descriptors. A representative iOS favorite list
is about 28,000 characters and is rejected by the NIP-46 signer path before it
can be published. The web client has an initial chunk format and iOS can read
that format, but iOS and Android writers still serialize a monolithic list and
incomplete chunk reads can produce partial results.

Favorites, named lists, metadata hydration, and downloaded files are separate
concerns. A book may be favorited and belong to multiple named lists. Its
metadata can be refreshed without changing membership, and its file may be
downloaded on one device but absent on another.

## Goals / Non-Goals

**Goals:** compact private collection events; a built-in Favorites collection;
multiple ordered named collections; many-to-many membership; signer-safe
chunking; safe legacy migration; locally cached metadata; app-local whole-list
downloads with partial success and deduplication.

**Non-Goals:** synchronize download status or local paths; publish public/shared
curations; store book bytes on relays; require every favorite to be currently
resolvable; implement collaborative list editing or a CRDT; delete downloaded
files automatically when membership changes.

## Decisions

1. **Favorites is a special collection, not a separate data model.** It retains
   kind `30003`, `d=libvault-favorites` and heart-button behavior. Named
   collections use kind `30003`, `d=bookstr-collection-<random-id>`, where the
   suffix is a stable random 128-bit lowercase hexadecimal identifier. A book
   may occur once in each of any number of collections.
2. **An encrypted index discovers named collections.** Kind `30003`,
   `d=bookstr-collections` contains ordered private `collection` entries with
   each collection's root `d` tag, title, and updated time. Private `deleted`
   entries prevent stale cached clients from resurrecting removed collections.
   Favorites is fixed and need not appear in the index.
3. **Collection names are private by default.** Root events expose only the
   opaque `d` tag. Title, optional description, timestamps, and items are
   private tags inside NIP-44 ciphertext. The index repeats titles so a client
   can render its list picker after one decryption; each collection remains
   independently recoverable without the index cache.
4. **One compact tag represents one ordered item.** Version 2 uses
   `["book", "<namespace>", "<identifier>", "<added-at>", "<optional-locator>"]`.
   Namespaces initially include `libvault`, `bookstr`, `isbn`, `url`, and
   `blossom`. Array order is playlist order, `added-at` survives reordering, and
   duplicates within one collection are ignored. The optional locator is used
   only when the stable identifier cannot be resolved through a known service.
5. **Descriptive metadata is cache data.** Title, author, cover, year, format,
   size, ISBN aliases, availability, and download state are fetched by the app
   and cached locally. Resolution failure retains the compact reference and any
   previously cached metadata; it never removes collection membership.
6. **Large collections use immutable generations.** A root plaintext either
   contains its compact items directly or a `bookstr-chunks` manifest with a
   count and a random generation-specific prefix. Each chunk is another
   encrypted kind `30003` addressable event with `d=<prefix>-<index>`. Writers
   target no more than 6,000 plaintext JSON characters while keeping a complete
   item tag in one chunk.
7. **Publication commits the root last.** Writers encrypt, sign, and publish all
   generation chunks before the new root. They publish the root only after
   every chunk has been accepted by at least one configured or interoperability
   relay. A missing, invalid, oversized, or undecryptable chunk invalidates the
   generation; clients retain the last complete cached snapshot instead of
   caching a partial collection.
8. **Legacy migration is reader-first.** All clients first learn both the
   verbose legacy favorite tags and version 2 compact tags, including the
   historical `libvault-chunks` manifest. Only then do writers emit compact
   roots. The next successful edit migrates a legacy favorite snapshot. Old
   chunks remain harmless because no current root references them.
9. **Collection writes are isolated.** Editing one named collection rewrites
   only that collection. Creating, renaming, reordering, or deleting collections
   also updates the small collection index. Implementations pull the latest
   relevant root before mutation; version 1 conflict behavior is last complete
   write wins.
10. **Downloads are local projections.** Each app resolves a collection
    reference to a publication and maps it to a shared local download record.
    Download list queues unresolved or absent publications, reuses existing
    files and in-flight jobs, reports per-item and aggregate outcomes, and
    permits partial success. Keep downloaded is a device-local preference.
11. **Membership never owns files.** Removing a book from Favorites or a named
    collection, or deleting a collection, does not cancel an active job or
    delete a local file. Storage cleanup is explicit and can show every
    collection that still references the publication.

## Private Payloads

A small named collection root decrypts to:

```json
[
  ["bookstr-collection", "2"],
  ["title", "Summer reading"],
  ["description", "Books for the trip"],
  ["updated", "1787500000"],
  ["book", "libvault", "0123456789abcdef0123456789abcdef", "1787400000"],
  ["book", "isbn", "9780123456789", "1787450000"]
]
```

An oversized root replaces its item tags with:

```json
[
  ["bookstr-collection", "2"],
  ["title", "Summer reading"],
  ["updated", "1787500000"],
  ["bookstr-chunks", "5", "bookstr-chunk-7f4c2a9e9d8b43c39ea0d6921fb36f72"]
]
```

The collection index decrypts to:

```json
[
  ["bookstr-collection-index", "1"],
  ["collection", "bookstr-collection-8d96a7eb62154ae2bded78c9d12ad4c1", "Summer reading", "1787500000"],
  ["deleted", "bookstr-collection-16322d0b1e44413d89d7d07e1a388311", "1787400000"]
]
```

## Risks / Trade-offs

- A chunked write requires one encryption and signature per chunk plus the
  root, so remote signers may show several approvals. Compact entries reduce
  how often chunking is needed and remembered signer permissions reduce prompts.
- The collection index duplicates a small amount of private metadata, but
  avoids decrypting every collection merely to show a list picker.
- Metadata resolution depends on configured services. Cached metadata and
  unresolved placeholders preserve the user's organization when services are
  offline or an item disappears upstream.
- Last-write-wins can lose simultaneous manual reordering on different devices.
  Collaborative merge semantics are deferred rather than embedding a premature
  CRDT in the wire format.
- Relay observers can infer the account, event timing, number of root/chunk
  events, and approximate sizes even though names and contents are encrypted.

## Migration

1. Release readers that accept legacy verbose favorites, historical chunks,
   compact version 2 roots, the collection index, and named collections.
2. Persist the last complete plaintext snapshot and resolved metadata cache per
   collection root and pubkey.
3. Enable compact writers and chunks-first/root-last publication after reader
   compatibility is deployed across web, Android, and iOS.
4. On the next successful favorite edit, parse the legacy snapshot into compact
   references, preserving item order and `libvault-added` timestamps where
   present and using the event time only as a fallback.
5. Do not delete legacy roots or chunks as part of migration. Addressable-event
   replacement and generation-specific manifests make them inactive.
