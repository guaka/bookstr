## Purpose

Define the optional hashed catalog format without bundling example books in the web build.

## ADDED Requirements

### Requirement: No bundled examples
The web catalog SHALL NOT contain example books or bundled publication files.

#### Scenario: Fresh web library
- **GIVEN** the user has no favorites or reading progress
- **WHEN** the web Library opens
- **THEN** it shows empty Reading and Favorites shelves without an Examples shelf

### Requirement: Files stored by hash
Seed EPUBs SHALL be stored as `catalog/books/{sha256}.epub` matching catalog `id`.

#### Scenario: Hash script
- **GIVEN** raw EPUB files in a staging area
- **WHEN** the hash script runs
- **THEN** files are renamed/copied to `{sha256}.epub` and catalog ids updated
