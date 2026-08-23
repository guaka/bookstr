## ADDED Requirements

### Requirement: Device-local download state
Applications SHALL keep download availability, queue state, byte progress,
errors, retry state, local paths, and Keep downloaded preferences local to the
device or server performing the download. They SHALL NOT serialize these values
into Nostr collection or collection-index events.

#### Scenario: Same collection on two devices
- **GIVEN** a collection is synchronized to a phone and a tablet
- **WHEN** its books are downloaded only on the phone
- **THEN** both devices show the same membership while only the phone reports local offline availability

### Requirement: Download an entire collection
Each app SHALL provide an action that attempts to resolve and download every
item in Favorites or a named collection that is not already locally available.
The operation SHALL allow partial success and SHALL expose queued, resolving,
downloading, downloaded, unavailable, failed, paused, or cancelled outcomes as
applicable.

#### Scenario: Some collection items are unavailable
- **GIVEN** a collection contains downloaded, downloadable, and currently unavailable books
- **WHEN** the user invokes Download list
- **THEN** existing files are reused, downloadable books are queued, unavailable books are reported, and one failure does not block the remaining downloads

### Requirement: Shared and deduplicated publication downloads
A resolved publication SHALL have one local file and one in-flight download job
regardless of how many collections reference it. Resolution SHALL prefer a
verified publication SHA-256 when available and SHALL retain the originating
compact references as aliases.

#### Scenario: One book appears in multiple lists
- **GIVEN** the same publication appears in Favorites and two named collections
- **WHEN** all three collections request downloading
- **THEN** the app performs at most one download and all three collections report it as downloaded

### Requirement: Collection download progress and recovery
The app SHALL report aggregate downloaded-versus-total progress and failed or
unavailable counts for a collection. It SHALL support retrying failed items and
cancelling pending collection jobs without deleting files that completed.
Relevant queue state SHALL survive an ordinary app restart where the platform
supports resumable background work.

#### Scenario: Retry a partially failed collection
- **GIVEN** eighteen of twenty-four items are downloaded, four failed, and two are unavailable
- **WHEN** the user retries failed items
- **THEN** only the four failed items are requeued and the eighteen existing files are reused

### Requirement: Optional per-device Keep downloaded
An app MAY offer Keep downloaded for a collection. When enabled, newly added or
newly resolvable items SHALL be queued according to local network, battery, and
storage policy. The preference SHALL be local to that installation.

#### Scenario: Add a book to a kept collection
- **GIVEN** Keep downloaded is enabled for Summer reading on one device
- **WHEN** a new book is synchronized into that collection
- **THEN** that device attempts the download without changing download preferences on other devices

### Requirement: Membership does not own downloaded files
Unfavoriting a book, removing it from one collection, or deleting a collection
SHALL NOT implicitly delete its local file or remove its other memberships. An
active download SHALL continue unless the user explicitly cancels it. Storage
cleanup SHALL be an explicit app operation and SHOULD identify remaining
collection references before deletion.

#### Scenario: Delete a downloaded collection
- **GIVEN** a named collection contains locally downloaded books that also occur in Favorites
- **WHEN** the named collection is deleted
- **THEN** its membership disappears but its files and Favorites memberships remain available
