# Bookstr Nostr data

Bookstr is offline-first. Nostr is optional and augments data stored in the browser; a relay or
signer failure must not prevent reading.

## Reading progress

Progress uses a parameterized replaceable NIP-78 event:

- kind: `30078`
- `d`: `app.bookstr.progress.<book SHA-256>`
- content: JSON containing `v`, `bookId`, `title`, `author`, `locator`, and `updatedAt`
- merge: highest `updatedAt` wins

The EPUB CFI in `locator.cfi` preserves the exact reading position. `locator.progression` is a
normalized `0..1` value used for display and as a fallback.

## Saved words

Dictionary lookups are stored as private NIP-78 application data:

- kind: `30078`
- `d`: `app.bookstr.vocabulary.<random stable id>`
- content: the vocabulary JSON encrypted to the user's own key with NIP-44
- merge: entries are matched by normalized `language:word`; highest `updatedAt` wins

The public tags do not contain the word or a word-derived hash. The encrypted payload includes the
definitions, optional translation, source book, EPUB CFI, lookup count, and timestamps. Separate
clients may initially create different replaceable events for the same word; Bookstr decrypts and
deduplicates them locally.

## LibVault favorites

Bookstr reads LibVault's private NIP-51 bookmark list:

- kind: `30003`
- `d`: `libvault-favorites`
- encrypted private tags may contain `bookstr`, `libvault`, `libvault-book`, `i` (ISBN), and `r`
  references

Bookstr merges matching entries into its local Favorites shelf and links unmatched LibVault
entries back to LibVault.

## Signers

The web app prefers NIP-07, then supports NIP-46 remote signers, with pasted `nsec` as an explicit
advanced fallback. NIP-44 encrypt/decrypt support is required to sync private saved words and
LibVault favorites.
