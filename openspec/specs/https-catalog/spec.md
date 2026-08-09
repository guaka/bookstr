## Purpose

Define HTTPS catalog format, SHA-256 book identity, download, verification, and local cache.

## ADDED Requirements

### Requirement: Catalog uses SHA-256 book ids
The system SHALL identify each book by the lowercase hex SHA-256 of its EPUB file bytes (64 characters). Display fields such as title and author SHALL NOT be used as identity.

#### Scenario: Catalog entry identity
- **GIVEN** an EPUB file on the server
- **WHEN** it is listed in `catalog.json`
- **THEN** its `id` equals the SHA-256 of that exact file

### Requirement: Clients verify downloads
Clients SHALL download the EPUB from `epubUrl`, compute SHA-256, and reject the file if it does not match `id`.

#### Scenario: Hash mismatch
- **GIVEN** a catalog entry with id `abc…`
- **WHEN** the downloaded bytes hash to a different value
- **THEN** the client discards the file and surfaces an error

### Requirement: Content-addressed cache
Clients SHALL cache verified EPUBs under a path or key derived from the SHA-256 id (e.g. `{sha256}.epub`).

#### Scenario: Reopen cached book
- **GIVEN** a book was previously downloaded and verified
- **WHEN** the user opens it again offline
- **THEN** the client reads from the local cache without re-downloading
