## ADDED Requirements

### Requirement: Private LibVault favorites
When a Nostr identity is connected, Bookstr SHALL query kind `30003` events authored by that identity with `d=libvault-favorites`, select the newest event by `created_at`, and decrypt its `content` as a NIP-44 message to the user's own public key.

#### Scenario: Amber-backed Android identity
- **GIVEN** Android is connected to Amber through NIP-55
- **WHEN** the Library syncs private favorites
- **THEN** ciphertext is sent to Amber using `nip44_decrypt` and the private key never enters Bookstr

#### Scenario: No matching event
- **GIVEN** the connected identity has no matching favorite-set event on configured or interoperability relays
- **WHEN** the Library syncs
- **THEN** the client reports a successful empty shared favorite set

### Requirement: Shared favorite tag parsing
Clients SHALL parse the decrypted NIP-51 private tag array for `r`, `bookstr`, `libvault`, `libvault-book`, `blossom`, `i=isbn:…`, and `k=isbn` entries. ISBN values SHALL be normalized to 10 or 13 digits (allowing `X` for ISBN-10). The encrypted `libvault-book` metadata SHALL carry title, author, format, size, and year. A `blossom` entry SHALL associate the LibVault MD5 with a SHA-256, authenticated download URL, and format.

#### Scenario: LibVault display metadata
- **GIVEN** a `libvault` tag is followed by a `libvault-book` tag for the same MD5
- **WHEN** the favorite set is parsed
- **THEN** the entry retains the encrypted title, author, year, format, MD5, and associated Blossom descriptor

### Requirement: LibVault-independent favorite downloads
Android SHALL NOT call the LibVault web origin to hydrate or fetch a favorite. It SHALL open a favorite only from an HTTPS Blossom descriptor carried inside the encrypted Nostr event, authenticate the request through the connected signer, and verify the downloaded file against the descriptor SHA-256.

#### Scenario: LibVault origin unavailable
- **GIVEN** the LibVault web origin is unreachable and a favorite has a valid Blossom descriptor
- **WHEN** the user opens that favorite in Android
- **THEN** Android downloads and verifies the EPUB or PDF directly from Blossom

### Requirement: Favorite matching and external entries
Clients SHALL match favorite references to locally known books by Bookstr id, LibVault MD5, normalized ISBN, or source URL. A valid unmatched reference SHALL remain visible as a deduplicated external favorite using its encrypted metadata and URL.

#### Scenario: Favorite absent locally
- **GIVEN** a private LibVault favorite does not match any locally known book
- **WHEN** the Library renders
- **THEN** it appears under Favorites as a LibVault entry rather than being discarded

### Requirement: Shelf organization
Clients SHALL distinguish books with local progress and favorite books. Favorite membership takes precedence over Reading for shelf placement. Neither client SHALL show an Examples shelf.

#### Scenario: Favorite with progress
- **GIVEN** a book is both favorited and has saved reading progress
- **WHEN** the Library renders
- **THEN** it appears in Favorites with its progress and not again in Reading

### Requirement: Independent source failures
Nostr favorite and progress synchronization failures SHALL NOT discard downloaded books or other library data loaded successfully. The UI SHALL identify the failed source and provide retry behavior.

#### Scenario: Nostr unavailable
- **GIVEN** downloaded books and local progress load successfully
- **WHEN** relay access or favorite decryption fails
- **THEN** the local library remains usable and the Favorites shelf shows a retryable Nostr error
