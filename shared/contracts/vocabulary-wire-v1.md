# Vocabulary wire v1

Private vocabulary entries use NIP-78 kind `30078`, a `d` tag beginning with
`app.bookstr.vocabulary.`, and a NIP-44-encrypted JSON payload. This contract
covers only the decrypted payload. Encryption, signing, relay transport,
storage, merging, and UI remain platform-owned.

Canonical emitters include `word`, `language`, `syncId`, `bookId`, `bookTitle`,
`firstSeenAt`, `lastSeenAt`, `updatedAt`, and `deleted`. Readers retain the
legacy `updatedAt` fallback when the first/last timestamps are absent. Word and
language identity is lowercase, an absent or blank key derives as
`<language>:<word>`, and absent optional lookup metadata receives the documented
empty/default values.

Every client runs `shared/fixtures/vocabulary-wire-v1.json` through its thin
wire adapter before mapping the result into platform-owned persistence models.
