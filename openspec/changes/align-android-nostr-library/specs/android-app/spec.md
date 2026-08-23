## MODIFIED Requirements

### Requirement: Library from local and portable sources
The Android app SHALL combine downloaded books with Blossom-backed books described by the connected identity's private favorites according to the shared `nostr-library` contract. Its Library SHALL show only Reading and Favorites, not an Examples shelf. It SHALL open favorite EPUBs and PDFs directly from Blossom after authenticated download and SHA-256 verification, without depending on the LibVault web origin or treating MD5 identifiers as SHA-256 hashes.

### Requirement: Local progress persistence
The app SHALL persist last reading position per stable book id in Room, independent of Nostr, and use that progress when organizing the shared library shelves.
