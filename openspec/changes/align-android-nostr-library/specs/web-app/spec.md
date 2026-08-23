## MODIFIED Requirements

### Requirement: Library and reader
The web app SHALL ship without bundled example publications, organize books according to the shared `nostr-library` contract, authenticate and SHA-256 verify Blossom downloads, cache publications in IndexedDB, and open EPUB and PDF readers. It SHALL also accept trusted same-origin LibVault book launch parameters without treating an MD5 as a SHA-256 hash.

### Requirement: Settings
The web app SHALL provide settings for Nostr identity/relays, reader theme defaults, and translation language.
