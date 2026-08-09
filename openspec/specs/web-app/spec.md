## Purpose

Web bookstr client mirroring Android catalog + reading + sync behavior.

## ADDED Requirements

### Requirement: Catalog and reader
The web app SHALL load the user-configured catalog URL, list books, verify SHA-256 on download, cache in IndexedDB, and open an immersive epub.js reader.

### Requirement: Settings
The web app SHALL provide settings for catalog URL, Nostr identity/relays, and reader theme defaults.
