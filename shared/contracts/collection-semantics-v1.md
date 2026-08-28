# Collection semantics v1

Android and iOS store private named collections as NIP-44-encrypted tag arrays.
The collection directory contains `collection` and `deleted` tags; each
collection document contains metadata tags followed by the compact publication
references defined by `favorite-reference-v1`.

This contract covers the pure, decrypted parsing boundary shared by the native
clients. Collection identifiers have the form
`bookstr-collection-` followed by 32 lowercase hexadecimal characters. Empty
titles become `Untitled list`, invalid timestamps become zero, and tombstones
remove matching directory entries. Collection metadata falls back to the
directory values when title or timestamp tags are absent or invalid.

Encryption, relay transport, chunking, cache models, collection mutation, and
UI remain platform-owned. The web and Electron clients do not currently expose
private named-collection management and therefore do not consume this contract.
