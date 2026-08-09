## Why

Readers need a calm, distraction-free way to read EPUBs from a self-hosted HTTPS library, continue on the Android lock screen, and optionally sync progress across devices with Nostr — without a centralized account server.

## What Changes

- Introduce **bookstr** monorepo: Android app (`app.bookstr`), web app, and example HTTPS `catalog/` tree.
- Books are identified by **SHA-256 of EPUB bytes**; clients verify downloads.
- Seed catalog with CC/PD works (Doctorow, Pessoa, Portuguese Verne/sci-fi adjacent).
- Distraction-free immersive reading (FBReader-like, more minimal).
- Optional Android lock-screen reading via `setShowWhenLocked`.
- Optional Nostr NIP-78 progress sync keyed by SHA-256.

## Capabilities

### New Capabilities

- `https-catalog`: Catalog fetch, SHA-256 ids, download + verify + cache
- `seed-catalog`: Seed EPUB set with license metadata
- `distraction-free-reader`: Immersive reader UX (Android + web)
- `lock-screen-reading`: Optional read-over-keyguard on Android
- `nostr-progress-sync`: nsec + NIP-78 progress sync
- `android-app`: Compose shell, library, settings, Readium reader
- `web-app`: Vite React library, epub.js reader, settings, sync

### Modified Capabilities

None (greenfield).

## Impact

- New Android and web clients; static catalog hosting docs
- No backend service required beyond static HTTPS + public Nostr relays
- Users may paste nsec (sensitive); encrypted local storage required on Android
