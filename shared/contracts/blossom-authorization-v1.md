# Blossom authorization v1

Bookstr authorizes a hash-addressed Blossom download with a signed Nostr event
of kind `24242`. The unsigned GET request contains `t=get`, a two-minute
`expiration`, the exact server hostname, and a lowercase SHA-256 `x` tag.

This contract covers the unsigned request fields shared by web, Android, and
iOS. The human-readable content remains caller supplied so existing Bookstr and
legacy LibVault labels remain wire-compatible. Signer selection, public keys,
event IDs, signatures, transport, and authorization-header Base64 padding are
platform-owned.

Every client runs `shared/fixtures/blossom-authorization-v1.json` through its
request builder. Hashes must be exactly 64 hexadecimal characters, and server
values must be non-empty hostnames without a slash.
