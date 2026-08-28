# Favorite reference v1

Private favorites and named collections represent publications with compact
Nostr tags shaped as `["book", type, identifier, addedAt, locator?]`. This
contract covers only the five compact reference types already emitted by every
client: `libvault`, `bookstr`, `isbn`, `url`, and `blossom`.

MD5 and SHA-256 identifiers are lowercase in the canonical form, ISBNs contain
only their normalized 10 or 13 characters, timestamps are positive Unix
seconds, and optional locators are absolute HTTP(S) URLs. Repeated references
retain first-encounter order, the first valid locator, and the earliest positive
timestamp.

Legacy publication tags, metadata enrichment, NIP-44 encryption, signing,
relay transport, chunking, persistence, and UI models remain platform-owned.
Readers continue accepting those legacy forms outside this compact contract.
