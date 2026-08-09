## Purpose

Opt-in cross-device reading progress sync via Nostr.

## ADDED Requirements

### Requirement: NIP-78 progress events
When an nsec is configured, clients SHALL publish reading progress as kind `30078` with `d` tag `app.bookstr.progress.<sha256>` and payload including `bookId`, locator/progression, and `updatedAt`. Conflict resolution SHALL be last-write-wins by `updatedAt`.

#### Scenario: Publish after page change
- **GIVEN** the user has an nsec configured
- **WHEN** reading progress changes
- **THEN** after a short debounce the client publishes a replaceable progress event

### Requirement: Secure key storage
Android SHALL store nsec in EncryptedSharedPreferences. Web SHALL prefer NIP-07 when available; pasted nsec SHALL be session-oriented and never logged.

#### Scenario: Logout
- **GIVEN** an nsec is stored
- **WHEN** the user clears Nostr identity
- **THEN** the secret is removed from local storage
