# LibVault and Bookstr Nostr protocol

This is the canonical specification for every Nostr protocol surface in this
repository. It covers the LibVault web app and server, the Bookstr web,
Android, and iOS clients, and the private Blossom service used to distribute
book files.

Implementation changes that add an event kind, tag, payload field, signer
method, relay rule, or privacy boundary must update this file. Product-specific
documents may summarize this contract, but should link here rather than define
a competing wire format.

## Protocol index

| Kind | Standard | Status | Purpose | Relay event |
| --- | --- | --- | --- | --- |
| `5` | NIP-09 | Implemented on Bookstr web | Request deletion of saved-vocabulary events | Yes |
| `30003` | NIP-51 | Favorites implemented; compact collections planned | Private Favorites, named book collections, indexes, and chunks | Yes |
| `30078` | NIP-78 | Implemented | Reading progress, private saved vocabulary, and private book snippets | Yes |
| `24133` | NIP-46 | Implemented through signer libraries | Encrypted remote-signer requests and responses | Yes |
| `24242` | Blossom authorization | Implemented | Short-lived HTTP authorization for Blossom upload/download | No |
| `1059` | NIP-17/NIP-59 | Implemented on LibVault server | Gift-wrapped private book fetch requests and results | Yes |
| `1063` | NIP-94 | Planned | Public file metadata for a fetched edition | Yes |
| `17` | NIP-25 | Planned | Public reaction to a book ISBN | Yes |
| `1111` | NIP-22/NIP-73 | Implemented on Bookstr iOS | Public book snippets anchored to an ISBN | Yes |

Kinds described as planned are not part of the current wire contract. NIP-35
torrent metadata and NIP-65 relay discovery are also planned, not implemented.

The repository uses these supporting NIPs:

- **NIP-01** for ordinary event serialization, IDs, signatures, relay queries,
  and publication.
- **NIP-07** for the browser `window.nostr` signer interface.
- **NIP-09** for deletion requests.
- **NIP-19** for `npub`, `nsec`, and related display/input encodings.
- **NIP-44** for encrypted favorites, vocabulary, and NIP-46 messages.
- **NIP-17/NIP-59** for private requests to the LibVault service identity.
- **NIP-46** for remote signing, primarily with Amber on web and iOS.
- **NIP-51** for the addressable private favorite set and planned named book
  collections.
- **NIP-55** for Android communication with an external signer such as Amber.
- **NIP-73** for ISBN identity tags.
- **NIP-78** for Bookstr application data.

## Identity and signer boundaries

### LibVault web

LibVault uses NIP-07. It asks the browser signer for the public key, NIP-44
encryption/decryption to that same key, and signatures. LibVault does not
receive or persist the user's private key. NIP-19 is used to show the hex public
key as an `npub`.

### Bookstr web

The current static web client uses NIP-07 for favorites, decrypting private
vocabulary, vocabulary deletion, and Blossom download authorization. Bookstr's
broader signer contract also allows NIP-46 and an explicitly advanced
pasted-`nsec` fallback in clients that expose those modes.

### Bookstr Android

Android prefers NIP-55 with Amber or another compatible external signer. It
requests signing for kinds `30003`, `30078`, and `24242`, plus
`nip44_encrypt`/`nip44_decrypt` where private data is needed. Remembered signer
permissions may use the Android content provider; otherwise the foreground
intent flow is used. Pasted `nsec` is an advanced fallback and is stored using
encrypted application preferences.

### Bookstr iOS

iOS supports NIP-46 and a local `nsec` signer. NIP-46 carries signer RPC over
kind `24133`; the Nostr Connect dependency owns that transport format. The app
stores NIP-46 client session material locally and does not receive the user's
account private key.

Disconnecting a signer disables Nostr synchronization until the user connects
again. Local reading, cached books, local progress, and locally saved words
must continue to work without a signer or relay.

### Current client capabilities

This matrix describes the source currently in this repository, rather than
everything permitted by the wire format:

| Component | Favorites `30003` | Named collections `30003` | Progress `30078` | Vocabulary `30078`/`5` | Blossom `24242` |
| --- | --- | --- | --- | --- | --- |
| LibVault web | Read/write | Planned | — | — | — |
| LibVault server | — | — | — | — | Upload authorization; NIP-17 request listener |
| Bookstr static web | Read/write | Planned | Read | Read and request deletion | Download authorization |
| Bookstr Android | Read/write with NIP-55 | Planned | Read/write | Read/write with NIP-55 | Download authorization |
| Bookstr iOS | Read/write | Planned | Read/write | Read | Signer permission exists; HTTP authorization is not wired yet |

Bookstr distributions built from a different frontend revision may expose more
signer choices, but they must use the same event contracts defined here.

## Relay behavior

`wss://relay.nomadwiki.org` is the interoperability relay and the only relay
configured in the LibVault and current Bookstr web frontends. Android and iOS
allow user-configured relays and include the interoperability relay when
looking up shared favorites. Planned named collections use the same relay
selection. NIP-65 relay-list discovery is not implemented.

Clients query events by the connected author's hex public key. For addressable
events they also query by kind and `d` tag, and select the newest matching
event by `created_at`. A client may fall back to a broader author-and-kind query
for relay interoperability, but must still validate the event kind, author,
and `d` tag before treating it as the requested record.

The same signed application event may be sent to multiple configured relays.
Relay failure must not discard successfully loaded local or remote data from
another source.

## Private LibVault fetch requests

When configured with its dedicated service nsec, the LibVault server subscribes
to NIP-17 gift wraps (kind `1059`) addressed to its public key on
`wss://relay.nomadwiki.org`. The nsec is a mounted secret and is never returned
by the HTTP API, included in the container image, or committed. Clients discover
the relay and safe service npub through `GET /api/nostr`.

The gift wrap contains a NIP-44-encrypted seal and unsigned kind `14` rumor as
specified by NIP-17/NIP-59. LibVault verifies the outer signature, decrypts and
verifies the seal, validates that the rumor is addressed to its service pubkey,
and accepts only the built-in allowed identity
`npub1qpa3kf5hahpjwx3xj7t83kp60ry7hp2qffdjf3z3030nssd6lv80qq059xu`.

The same identity protects the HTTP API. Browser/API clients must include a
fresh NIP-98 kind `27235` event in `Authorization: Nostr <base64-event>`. Its
`u` and `method` tags must match the requested URL and HTTP method. Replayed
authorization event IDs are rejected for five minutes. A successful browser
authorization establishes a one-hour secure, HttpOnly, same-site session, so
the browser only needs to sign its first API request and can then load protected
files normally. The static HTML shell is intentionally public so a
NIP-07-capable browser can create that signature; catalog search, metadata,
fetch, download, and Nostr discovery endpoints are not public.

The kind `14` request content is JSON:

```json
{
  "type": "libvault.fetch",
  "request_id": "<client-generated-opaque-id>",
  "book": {
    "md5": "<optional-libvault-md5>",
    "isbn": "<preferred-portable-identifier>",
    "title": "<title>",
    "author": "<author>",
    "source": "openlibrary",
    "source_id": "<source-record-id>",
    "url": "<source-record-url>"
  }
}
```

Resolution order is MD5, ISBN, then exact normalized title with a compatible
author. When several files represent the same work, readable ebook formats and
English editions are preferred, followed by the smaller file. The server sends
an immediate private response after resolving the catalog record, starts or
joins the existing fetch job, waits for Blossom publication, and sends a final
private response:

```json
{
  "type": "libvault.fetch.result",
  "request_id": "<same-id>",
  "status": "ready",
  "book": { "md5": "<catalog-md5>", "title": "...", "authors": "..." },
  "blossom": {
    "status": "ready",
    "sha256": "<file-sha256>",
    "url": "https://blossom.bfr.ee/<sha256>.<format>",
    "format": "epub"
  }
}
```

Other statuses are `resolved`, `not_found`, `ambiguous`, and `failed`. Replies
are NIP-17 messages addressed to the requesting pubkey and include an encrypted
`e` reference to the request rumor. LibVault retains only the opaque outer
gift-wrap event ID for durable replay protection; it does not persist decrypted
request contents or sender pubkeys in the replay table.

## Private catalog and downloaded-content search

Search uses the same NIP-17/NIP-59 envelope, service discovery, recipient
validation, replay protection, and encrypted reply path as private fetches.
The kind `14` rumor content is:

```json
{
  "type": "libvault.search",
  "request_id": "<client-generated-opaque-id>",
  "query": "reciprocal responsibility",
  "search_type": "content",
  "limit": 20
}
```

Existing `search_type` values (`all`, `title`, `author`, `publisher`, and
`isbn`) remain catalog searches and retain their existing full-text matching
and response fields. `content` is a distinct optional mode over indexed EPUB/PDF
files that are both downloaded and currently present in at least one privately
synced favorites set. A client
must not substitute catalog matches when this mode is unavailable.

A successful content reply has this shape:

```json
{
  "type": "libvault.search.result",
  "request_id": "<same-id>",
  "status": "ready",
  "total": 2,
  "hits": [
    {
      "citation": {
        "resource_id": "<content-addressed-id>",
        "chunk_id": "<content-addressed-id>",
        "uri": "file:///private/cache/<md5>.epub",
        "title": "Example",
        "block": { "seq": 3, "kind": "text", "page": 12 },
        "chunk_position": { "seq_in_block": 0 },
        "location": { "span": { "start": 120, "end": 512 } },
        "heading_path": ["Chapter 2", "Reciprocity"],
        "snippet": "The cited passage is returned here.",
        "score": { "fused": 0.91, "dense": 0.89, "bm25": 0.42 },
        "provenance": { "fetched_at": "...", "content_hash": "..." },
        "metadata": { "kind": "document", "dublin_core": {} }
      },
      "book": { "md5": "<md5>", "title": "Example", "authors": "A. Writer" }
    }
  ]
}
```

`citation` is the semantic index's canonical citation object and is forwarded
without dropping or rewriting fields. `book` is best-effort catalog enrichment
resolved from an MD5 filename in `citation.uri`; it is `null` when no matching
metadata is available, and that must not cause the citation to be discarded.

The server fixes the semantic search scope to its operator-configured private
store. The requester supplies no store name and cannot broaden the query to
other stores. The add-on is optional: `unavailable` means it is not configured,
while `failed` means it was configured but the server-side search could not be
completed. Neither status permits an unrelated catalog fallback.

The semantic index HTTP API is an unauthenticated, server-side-only boundary.
It must not be exposed to browsers or the public network. Content queries,
citations, local source URIs, and enriched book metadata leave that boundary
only inside the NIP-17 encrypted response to the requesting pubkey; normal
NIP-17 relay metadata leakage (gift-wrap event timing, size, and recipient tag)
still applies.

### Private favorites projection sync

Because a user's NIP-51 favorites event is encrypted to that user, LibVault
cannot read it from the relay. Bookstr therefore sends the current MD5 set over
the same private NIP-17 flow whenever favorites are synchronized:

```json
{
  "type": "libvault.favorites.sync",
  "request_id": "<client-generated-opaque-id>",
  "favorites": ["0123456789abcdef0123456789abcdef"]
}
```

An empty array clears that requester's set. The server validates and deduplicates
at most 5,000 MD5s, persists only a one-way hash of the requester pubkey, and
reconciles a hard-link projection containing matching downloaded EPUB/PDF files.
Additions request a retained index pass; removals request localdb's `delete`
policy so stale passages are pruned. The full LibVault cache is never exposed to
localdb. A successful encrypted reply uses type `libvault.favorites.result`,
status `ready`, and `total` equal to the accepted set size.

## Private favorites

Favorites are a dedicated addressable NIP-51 list. They do not overwrite the
user's global kind `10003` bookmark list.

### Event envelope

```json
{
  "kind": 30003,
  "created_at": 1700000000,
  "tags": [
    ["d", "libvault-favorites"],
    ["title", "LibVault favorites"],
    ["description", "Private saved-book list from lib.b.bfr.ee"]
  ],
  "content": "<NIP-44 ciphertext>"
}
```

Only the `d` tag is required. `title` and `description` are optional public
metadata currently added by LibVault. `content` is a NIP-44 message encrypted
to the event author's own public key. Its plaintext is a JSON array of private
tags.

Although the content is encrypted, the author's public key, kind, `d` tag,
event time, event size, and publication relays remain observable.

### Private tag vocabulary

The canonical field positions are:

```json
[
  ["r", "https://lib.b.bfr.ee/#book?md5=<md5>"],
  ["libvault", "<md5>"],
  ["libvault-added", "<md5>", "<unix-seconds>"],
  ["libvault-book", "<md5>", "<title>", "<author>", "<format>", "<size-bytes>", "<year>", "<language>", "<source>", "<cover-url>", "<cover-sha256>", "<rights-status>", "<license>", "<license-url>", "<rights-source>"],
  ["blossom", "<md5>", "<sha256>", "<https-url>", "<format>"],
  ["i", "isbn:9780123456789", "https://lib.b.bfr.ee/#book?md5=<md5>"],
  ["k", "isbn"],
  ["bookstr", "<book-id>", "<title>", "<author>", "<url>", "<format>", "<year>", "<language>", "<source>", "<cover-url>", "<cover-sha256>", "<rights-status>", "<license>", "<license-url>", "<rights-source>"]
]
```

- `r` is the usable or source URL for the following reference.
- `libvault` is an application compatibility key. Its value is the MD5 of the
  imported LibGen/LibVault catalog record, not a content hash.
- `libvault-added` preserves the time the individual favorite was added. Its
  third value is integer Unix seconds. For legacy entries without it, readers
  may use the containing event's `created_at` as a fallback.
- `libvault-book` carries encrypted display metadata. Size is decimal bytes.
  Empty fields are allowed and trailing fields may be added compatibly.
- `blossom` associates the catalog MD5 with a content SHA-256, an authenticated
  HTTPS download URL, and a format. Some current writers append an author; a
  reader must ignore unknown trailing values.
- `i` and `k` use NIP-73. ISBNs are normalized by removing separators; ISBN-10
  permits a final `X`, and ISBN-13 contains 13 digits. The optional third `i`
  value is a URL hint.
- `bookstr` identifies a Bookstr-native book that has no LibVault MD5.
- Rights fields use `public_domain`, `open_license`, `copyrighted`, or
  `unknown`. Empty rights fields in older records decode as `unknown` and must
  not erase explicit metadata already stored locally.

Current Bookstr web builds also emit `bookstr-book` with fields
`book-id, title, author, format, size-bytes, year, url`. Readers should accept
that spelling as a compatibility alias. New writers should emit `bookstr`.

A reader should match a private reference to a local book by Bookstr ID,
LibVault MD5, normalized ISBN, source URL, or Blossom SHA-256. A valid unmatched
reference remains an external favorite rather than being discarded.

Compact list writers that can provide publication descriptors add
`["bookstr-publications", "2"]` to the encrypted private tags. Version 2 adds
the canonical rights fields to publication descriptors. Readers continue to
accept version 1 and records with no marker. For each compact
`book` membership tag they may also include the existing `libvault-book` tag
and, when a verified copy exists, the existing `blossom` tag. These descriptor
tags are encrypted auxiliary data, not additional collection memberships.
Readers merge them by LibVault MD5 regardless of whether they appear before or
after the corresponding membership or in another chunk of the same complete
generation. Writers must not invent a Blossom URL or SHA-256: `blossom` is
emitted only after the actual EPUB/PDF bytes have been published and verified.

This uses the existing private NIP-51 list with NIP-44 self-encryption. A
separate NIP-78 event per publication is intentionally not used: it would add
one relay lookup and often one remote-signer decrypt approval per book, and a
deterministic public `d` tag would leak the catalog MD5. The marker lets an
older compact list be upgraded once without repeatedly rewriting lists whose
books genuinely have no retrievable file descriptor yet.

MD5 must never be put in a NIP-94 `x` tag: NIP-94 requires a SHA-256 content
hash. Book bytes are never placed in relay events.

### Chunking

Large private lists are split to keep individual NIP-44 payloads small enough
for relays and remote signers. The root event retains
`d=libvault-favorites`; its decrypted plaintext becomes:

```json
[["libvault-chunks", "<count>", "libvault-favorites-chunk"]]
```

Each zero-based chunk is another encrypted kind `30003` addressable event with
`d=libvault-favorites-chunk-<index>` and a plaintext JSON array containing that
chunk's private tags. A manifest may provide another prefix, which readers must
honor. LibVault currently targets roughly 6,000 plaintext JSON characters per
chunk.

Readers select the newest event for every chunk address and concatenate chunks
in numeric order. Publication is not transactional: a missing or undecryptable
chunk must be reported as incomplete and must not erase a usable local cache.

### Merge and publication

LibVault merges the remote set with browser-local favorites on connection and
publishes only when the merged list changed or an oversized legacy event needs
chunking. Bookstr clients merge shared favorites with local catalog and cache
state. The latest addressable event is authoritative for remote membership;
offline local changes remain local until a publish succeeds.

## Planned compact private book collections

The next collection revision generalizes Favorites into a built-in book
collection and adds user-created, manually ordered collections. This section
defines the target wire contract. Clients must continue writing the current
favorite format above until the reader-first migration described below is
complete.

Collection membership is many-to-many. A book may belong to Favorites and any
number of named collections. Removing it from one collection does not affect
Favorites or another collection. Favorites retains its existing kind `30003`,
`d=libvault-favorites` address and heart-button meaning.

### Addresses and collection discovery

Named collections use kind `30003` and an opaque stable address:

```text
d=bookstr-collection-<random-id>
```

`<random-id>` is 128 random bits encoded as 32 lowercase hexadecimal
characters. It must not be derived from the collection name or contents. The
only required public tag is `d`; a private collection's title, description, and
book identifiers must not be copied into public event tags.

The ordered collection directory is another encrypted kind `30003` event:

```text
d=bookstr-collections
```

Its decrypted version-1 private tags are:

```json
[
  ["bookstr-collection-index", "1"],
  ["collection", "bookstr-collection-8d96a7eb62154ae2bded78c9d12ad4c1", "Summer reading", "1787500000"],
  ["deleted", "bookstr-collection-16322d0b1e44413d89d7d07e1a388311", "1787400000"]
]
```

The position of each `collection` tag is its display order. Its fields are the
collection root `d` value, private title, and updated Unix seconds. A `deleted`
tag is a private tombstone containing the root `d` value and deletion Unix
seconds; it prevents a stale cached client or retained relay event from
resurrecting a removed collection. Favorites has a fixed address and need not
appear in this directory.

The directory duplicates only enough private metadata to render a collection
picker after one signer decryption. Each collection root also carries its own
title and optional description so it remains recoverable independently.

### Compact collection payload

A direct version-2 collection decrypts to a private tag array:

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

The compact `book` fields are:

1. literal `book`;
2. identifier namespace;
3. stable identifier;
4. the time it was added to this collection as integer Unix seconds; and
5. an optional locator, present only when the identifier cannot be resolved
   through a known service.

The initial namespaces are:

| Namespace | Identifier | Optional locator |
| --- | --- | --- |
| `libvault` | Lowercase LibVault catalog MD5 | Normally omitted; the LibVault API resolves it |
| `bookstr` | Stable Bookstr publication or catalog ID | Normally omitted when a configured catalog resolves it |
| `isbn` | Normalized ISBN-10 or ISBN-13 | Optional source URL |
| `url` | Canonical external URL | Omitted because the identifier is already the locator |
| `blossom` | Lowercase file SHA-256 | HTTPS Blossom URL when it cannot otherwise be discovered |

Tag-array order after collection metadata is manual playlist order. Reordering
does not change the per-collection added time. The same identifier occurs at
most once in one collection but may occur independently in any number of other
collections.

Title, author, cover, year, format, file size, ISBN aliases, Blossom
availability, download progress, and local paths are not essential membership
data. Apps resolve and locally cache them. Resolution failure must retain the
compact reference and show cached metadata or an unresolved placeholder; it
must not be interpreted as removal.

### Version-2 chunking

If a compact root would exceed the direct payload target, it retains its
private metadata and replaces its book entries with:

```json
["bookstr-chunks", "<count>", "bookstr-chunk-<random-generation>"]
```

Each chunk is an encrypted kind `30003` addressable event with
`d=<prefix>-<zero-based-index>`. The prefix is unique to that publication
attempt so an interrupted write cannot combine chunks from different
generations. Writers target at most 6,000 plaintext JSON characters per chunk
and never split one `book` tag between chunks.

Writers publish every chunk before the root manifest. The root must not be
published unless every chunk was accepted by at least one configured or
interoperability relay. Readers concatenate chunks in numeric order only when
all referenced events are present, within signer limits, decryptable, and valid
private tag arrays. An incomplete generation must not replace the last complete
local snapshot or remove entries that happen to be missing.

Readers for the new format also accept the historical `libvault-chunks`
manifest defined under Private favorites. Compact writers are enabled only
after web, Android, and iOS readers accept the verbose favorite vocabulary,
both manifest spellings, and compact `book` tags. On the next successful edit,
a legacy favorite list may be rewritten compactly while preserving membership,
order, and every known `libvault-added` time. The containing event time is the
fallback for legacy entries without an item timestamp.

### Collection writes and conflict behavior

Editing membership or order rewrites only that collection root. Creating,
renaming, reordering, or deleting a collection also updates the small encrypted
directory. Clients fetch the newest relevant event before mutation. The first
revision uses last-complete-write-wins for concurrent edits; collaborative
editing and CRDT semantics are outside this contract.

Old roots and generation chunks need not be deleted during ordinary updates.
They are inactive when the newest complete root or directory no longer
references them.

### App-local collection downloads

Download state is deliberately outside Nostr. Each Bookstr or LibVault app may
offer Download list, retry failed, cancel pending work, and a per-device Keep
downloaded preference. The app maps compact references through its metadata
cache to local publication/download records and deduplicates by verified file
SHA-256 when available. One local file can therefore satisfy Favorites and
multiple named collections.

Queue state, bytes received, failures, retry timing, local file paths, storage
policy, and Keep downloaded preferences must not be serialized into collection
or directory events. Different devices may have different offline
availability. Partial download success is valid: an unavailable item does not
block other items in the collection.

Unfavoriting, removing a book from one collection, or deleting a collection
does not cancel an active download or delete a local file. File removal is an
explicit local storage operation and should account for other collections that
still reference the publication.

## Reading progress

Reading progress is NIP-78 parameterized replaceable application data:

- kind: `30078`
- `d`: `app.bookstr.progress.<book-id>`
- content: plaintext JSON
- conflict resolution: greatest payload `updatedAt`

The canonical payload is:

```json
{
  "v": 1,
  "bookId": "<SHA-256 or stable book id>",
  "title": "<optional title>",
  "author": "<optional author>",
  "locator": {
    "progression": 0.42,
    "cfi": "<optional EPUB CFI or PDF page locator>",
    "href": "<optional resource href>",
    "furthestProgression": 0.61
  },
  "updatedAt": 1700000000123
}
```

`updatedAt` is Unix milliseconds. `locator.progression` is clamped conceptually
to `0..1`; EPUB CFI is the precise position and progression is the display and
fallback position. `furthestProgression` is optional and must not move backward
when two records are merged. Readers accept legacy payloads with top-level
`progression` and `cfi`.

Progress content is intentionally **not encrypted**. The public event can
reveal the user's book identifier, title/author when present, reading position,
update time, and activity pattern. A future privacy change requires a versioned
payload and migration plan; clients must not silently start encrypting version
1 because existing readers expect JSON.

Local progress is always available independently of Nostr. Nostr synchronization
uses last-write-wins by payload `updatedAt`, not merely event `created_at`.

## Saved vocabulary

Saved words also use NIP-78, separated from progress by their `d` namespace:

- kind: `30078`
- `d`: `app.bookstr.vocabulary.<stable-random-sync-id>`
- content: NIP-44 ciphertext encrypted to the author's own key

The `d` suffix must be random/stable and must not contain the word or a hash
derived from the word. Decrypted version-1 data may include:

```json
{
  "key": "<normalized-language>:<normalized-word>",
  "word": "<word>",
  "language": "<language code>",
  "syncId": "<stable random id>",
  "bookId": "<source book id>",
  "bookTitle": "<source title>",
  "cfi": "<locator>",
  "contextSentence": "<surrounding text>",
  "partOfSpeech": "<optional value>",
  "definitions": ["<definition>"],
  "sourceUrl": "<optional source>",
  "lookupCount": 1,
  "firstSeenAt": 1700000000123,
  "lastSeenAt": 1700000000123,
  "updatedAt": 1700000000123,
  "deleted": false
}
```

Clients deduplicate by normalized `language:word` and keep the record with the
greatest `updatedAt`. Separate clients may initially assign different sync IDs
to the same word, so deduplication cannot rely only on the `d` tag.

### Word deletion

Deletion is an offline-first, last-write-wins update, not just removal from the
visible list:

1. The client changes the local record to `deleted: true`, gives it a newer
   `lastSeenAt`/`updatedAt`, and keeps that tombstone in persistent storage and
   sync caches. Tombstones are excluded from the Words UI but are not discarded.
2. The client NIP-44 encrypts and publishes that tombstone as kind `30078` at
   the same `app.bookstr.vocabulary.<sync-id>` address. If duplicate records for
   the normalized `language:word` are known under multiple sync IDs, each known
   address receives a tombstone.
3. Bookstr web also publishes a best-effort kind `5` request with `e` tags for
   the superseded event IDs. Its content is empty because kind `5` is public.
4. A later pull merges active records and tombstones by normalized
   `language:word` and keeps the greatest `updatedAt`. Consequently an older
   relay response or application cache cannot restore the deleted word.

Relays decide how long they retain kind `5`, and clients cannot make it "stick
around" for a requested duration. NIP-09 cleanup is therefore only a storage
cleanup hint; successful deletion depends on the encrypted replaceable
tombstone remaining the newest record. A relay or signer failure does not undo
the local tombstone. Re-selecting the word is an intentional new update: the
client writes `deleted: false` with a newer timestamp and the word becomes
visible again.

As with favorites, encryption does not hide the author, kind, `d` tag, event
time, event size, or relay activity.

## Book snippets

Bookstr iOS lets a reader publish selected EPUB or PDF text as either public or
private. Public snippets are interoperable NIP-22 comments on a NIP-73 ISBN:

- kind: `1111`
- content: the selected text
- root tags: `["I", "isbn:<normalized-isbn>"]`, `["K", "isbn"]`
- parent tags for a top-level comment: the matching lowercase `i` and `k` tags

ISBNs omit separators as required by NIP-73. A public snippet is unavailable
when the publication has no valid ISBN-10 or ISBN-13; clients must not expose a
private download URL or catalog hash as a substitute public identity.

Private snippets use NIP-78 application data with NIP-44 self-encryption:

- kind: `30078`
- `d`: `app.bookstr.snippet.<random-uuid>`
- content: NIP-44 ciphertext encrypted to the author's own key

The decrypted version-1 JSON contains `version`, random `id`, selected `text`,
`bookId`, `title`, `author`, optional normalized `isbn`, `format`, `locator`,
and `createdAt` in Unix milliseconds. The random address prevents the public
`d` tag from leaking the book, passage, or locator. Relay observers can still
see the author, kind, event time, approximate payload size, and relay activity.

## Blossom authorization

Books live on HTTP/Blossom storage, not on Nostr relays. Access to the private
Blossom service uses a signed kind `24242` event encoded in the HTTP header:

```text
Authorization: Nostr <unpadded-base64(JSON-event)>
```

Upload authorization is created by the LibVault server's configured Blossom
publisher key. Download authorization is created by the connected user's
signer. The event is sent only with the HTTP request; it is not published to a
relay.

```json
{
  "kind": 24242,
  "created_at": 1700000000,
  "tags": [
    ["t", "get"],
    ["expiration", "1700000120"],
    ["server", "blossom.bfr.ee"],
    ["x", "<blob SHA-256>"]
  ],
  "content": "Download a LibVault book"
}
```

`t` is `get` for downloads and `upload` for publication. `expiration` is Unix
seconds, `server` binds the authorization to one Blossom host, and `x` binds it
to one SHA-256 blob. The server verifies event serialization, ID, Schnorr
signature, allowed public key, time window, expiration, verb, host, and hash.
Authorizations are deliberately short-lived; current writers use two minutes.

After download, Bookstr verifies the bytes against the descriptor SHA-256
before opening or caching the publication. The `blossom` private favorite tag
is the bridge between relay metadata and this authenticated HTTP transfer.

## Data and identity layers

The identifiers serve different purposes and must not be substituted:

1. NIP-73 ISBN identifies the book or work when known.
2. SHA-256 identifies and verifies a particular file/edition.
3. A Blossom or HTTPS URL locates file bytes.
4. LibVault MD5 identifies an imported catalog record for compatibility.
5. EPUB CFI, PDF page locator, and normalized progression identify a reading
   position within a file.

## Planned, not implemented

- NIP-94 kind `1063` may publish compact public metadata for an available
  file/edition: SHA-256, URL, MIME type, byte size, fallback URLs, and optional
  magnet/infohash metadata.
- NIP-35 may describe torrent sources without putting torrent files or book
  bytes on relays.
- NIP-25 kind `17` reactions and NIP-22 kind `1111` comments may target a
  NIP-73 ISBN for public social features.
- NIP-65 may replace or augment manually configured relay lists.

None of these planned features should be treated as readable or writable by a
current client until its event contract and migration behavior are added here.
