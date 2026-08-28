# Book rights v1

This contract defines the compatibility boundary for book-rights evidence.
Clients accept their existing aliases and persisted fields, then normalize to
four canonical snake-case wire fields: `rights_status`, `license`,
`license_url`, and `rights_source`.

The contract does not replace platform persistence or UI models. Network,
storage, rights display, and provider-specific extraction remain owned by each
client adapter. Literal legacy placeholders such as `"null"` and
`"undefined"` are treated as absent, and only HTTP(S) license URLs are emitted.

Every client runs `shared/fixtures/book-rights-v1.json` through its existing
normalizer. `book-rights-v1.schema.json` documents the versioned fixture and
canonical output.
