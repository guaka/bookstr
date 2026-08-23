## ADDED Requirements

### Requirement: Independent many-to-many book collections
The system SHALL represent Favorites as a built-in collection and SHALL allow a
connected user to create multiple independently named collections. A book SHALL
be able to belong to Favorites and any number of named collections at the same
time, at most once per collection. Each collection SHALL preserve explicit item
order and the original added timestamp independently of other collections.

#### Scenario: Book belongs to several collections
- **GIVEN** a book is in Favorites, Summer reading, and Sci-Fi classics
- **WHEN** the user removes it from Summer reading
- **THEN** it remains in Favorites and Sci-Fi classics with those memberships unchanged

#### Scenario: Unfavorite a listed book
- **GIVEN** a book is favorited and belongs to a named collection
- **WHEN** the user toggles its heart off
- **THEN** only its Favorites membership is removed

### Requirement: Private collection addressing and discovery
Favorites SHALL use NIP-51 kind `30003` with `d=libvault-favorites`. Named
collections SHALL use kind `30003` with an opaque stable
`d=bookstr-collection-<random-id>`. The ordered set of active named collections
and deletion tombstones SHALL be stored in encrypted kind `30003`,
`d=bookstr-collections`. Named-collection and index public event tags SHALL NOT
expose collection names, descriptions, or book references. Favorites MAY retain
its existing generic public product label without exposing book data.

#### Scenario: Render the collection picker
- **GIVEN** the user has several named collections
- **WHEN** a client decrypts the current collection index
- **THEN** it can render their titles and order without decrypting every collection root

#### Scenario: Deleted collection remains on a relay
- **GIVEN** an old collection root is still retained by a relay
- **WHEN** the current index omits it and carries its deletion tombstone
- **THEN** the client does not rediscover or display the deleted collection

### Requirement: Compact resolvable collection entries
Version 2 collection content SHALL represent each item as one private tag with
the field order `book`, namespace, stable identifier, added Unix seconds, and an
optional locator. Supported namespaces SHALL initially include `libvault`,
`bookstr`, `isbn`, `url`, and `blossom`. Collection events SHALL NOT require
title, author, cover, year, format, size, availability, or download status for a
book whose identifier can be resolved.

#### Scenario: Resolve a compact LibVault item
- **GIVEN** a collection contains `["book","libvault","<md5>","<added-at>"]`
- **WHEN** an app loads the collection
- **THEN** it preserves membership and ordering immediately and resolves descriptive metadata into its local cache

#### Scenario: Metadata service is unavailable
- **GIVEN** a valid compact reference and cached metadata exist
- **WHEN** refreshing its metadata fails
- **THEN** the app retains the reference and displays cached metadata rather than removing the item

### Requirement: Ordered collection semantics
The order of compact item tags after collection metadata SHALL be the manual
playlist order. Reordering SHALL NOT change an item's added timestamp. A writer
SHALL ignore or collapse duplicate identifiers within the same collection but
SHALL NOT deduplicate the item across different collections.

#### Scenario: Reorder one collection
- **GIVEN** the same book belongs to two collections
- **WHEN** it is moved to the top of one collection
- **THEN** the other collection's order and both added timestamps remain unchanged

### Requirement: Signer-safe atomic chunk generations
A collection whose serialized private content exceeds the configured direct
payload target SHALL use a root manifest and ordered generation-specific chunk
events. Writers SHALL keep each complete item tag in one chunk, target at most
6,000 plaintext JSON characters per chunk, publish all chunks before the root,
and update the complete local cache only after root publication succeeds.

#### Scenario: Publish a large favorite collection
- **GIVEN** compact Favorites still exceed the direct payload target
- **WHEN** the client publishes an update
- **THEN** it publishes signer-safe generation chunks followed by a root manifest that references only that generation

#### Scenario: Chunk publication fails
- **GIVEN** at least one new chunk is rejected by every target relay
- **WHEN** publication is evaluated
- **THEN** the new root is not published and the previous complete collection remains authoritative

### Requirement: Complete-generation reads
Readers SHALL concatenate valid chunks in numeric order only when every chunk
referenced by the current root is present, decryptable, within signer limits,
and a valid private tag array. An incomplete generation SHALL NOT replace a
complete cached snapshot or be interpreted as removal of absent items.

#### Scenario: Referenced chunk is missing
- **GIVEN** the latest root references five chunks and chunk three is unavailable
- **WHEN** the collection is synchronized
- **THEN** the app reports an incomplete update and continues using its last complete cached snapshot

### Requirement: Reader-first legacy migration
Clients SHALL read the existing verbose favorite tags, the historical
`libvault-chunks` manifest, compact version 2 entries, and the new
`bookstr-chunks` manifest before compact writing is enabled. A successful edit
of a legacy favorite collection SHALL preserve membership, order, stable
identity, and known added timestamps while migrating it to compact content.

#### Scenario: Edit a legacy favorite list
- **GIVEN** the latest favorite event contains verbose `r`, `libvault`,
  `libvault-added`, `libvault-book`, `blossom`, and ISBN tags
- **WHEN** a compatible client successfully adds or removes a favorite
- **THEN** the replacement uses compact references without losing any existing favorite

### Requirement: Local metadata projection
Each app SHALL resolve and locally cache descriptive and publication metadata
separately from collection membership. Metadata refreshes SHALL NOT require a
collection write. An unresolved reference SHALL remain visible using cached
metadata or an unresolved placeholder.

#### Scenario: Book availability changes
- **GIVEN** a collection reference has not changed
- **WHEN** a publication becomes available from a configured source
- **THEN** the app updates its metadata/download projection without publishing a new collection event
