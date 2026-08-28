## Purpose

Opt-in cross-device reading progress sync via Nostr.

## ADDED Requirements

### Requirement: NIP-78 progress events
When a Nostr identity is configured, clients SHALL publish reading progress as
kind `30078` with `d` tag `app.bookstr.progress.<sha256>` and the shared version
2 JSON payload. The payload includes `v: 2`, `bookId`, `locator` (with
`progression`, monotonic `furthestProgression`, and optional `cfi`/`href`), and
`updatedAt`. Web, Android, and iOS SHALL use this wire contract while retaining
read compatibility with version 1 and the documented legacy flat payloads.
Conflict resolution SHALL be last-write-wins by `updatedAt`.

#### Scenario: Publish after page change
- **GIVEN** the user has a Nostr identity configured
- **WHEN** reading progress changes
- **THEN** after a short debounce the client publishes a replaceable progress event

### Requirement: Secure key storage
Android SHALL prefer an external NIP-55 signer (Amber or compatible) so the app never holds the user's nsec; pasted nsec SHALL be an explicit advanced fallback stored in EncryptedSharedPreferences. Web SHALL prefer NIP-07 when available, else NIP-46 remote signing via a `nostrconnect://` QR (or pasted bunker URI); pasted nsec SHALL be an explicit advanced fallback and never logged. Disconnecting SHALL leave Nostr sync disabled until the user reconnects.

#### Scenario: Logout
- **GIVEN** a Nostr identity is configured
- **WHEN** the user clears or disconnects that identity
- **THEN** the secret (and Amber session metadata) is removed from local storage and sync stays off until reconnect

#### Scenario: NIP-07 preferred on web
- **GIVEN** a NIP-07 extension is installed
- **WHEN** the user connects via the extension
- **THEN** progress publish/pull uses extension signing without storing an nsec

#### Scenario: NIP-46 QR on web
- **GIVEN** the user opens remote-signer connect in Settings
- **WHEN** the client shows a `nostrconnect://` QR code
- **THEN** scanning with Amber (or another NIP-46 signer) establishes a bunker session and progress publish/pull uses remote signing without storing the user's nsec

#### Scenario: Amber preferred on Android
- **GIVEN** Amber (or another NIP-55 signer) is installed
- **WHEN** the user connects via Amber
- **THEN** progress publish/pull uses external signing without storing an nsec

#### Scenario: Amber remembered permission
- **GIVEN** the user connected Amber and allowed remembering `sign_event` for kind `30078`
- **WHEN** reading progress changes
- **THEN** the client signs via the signer content provider without opening Amber for each page turn
