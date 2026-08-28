## 1. Desktop shell

- [ ] 1.1 Add an Electron entrypoint with secure `app://bookstr` protocol handlers.
- [ ] 1.2 Add window lifecycle and session restoration for main and reader windows.
- [ ] 1.3 Add external link interception and explicit open-external fallback.

## 2. Reader bridge

- [ ] 2.1 Add constrained preload bridge and desktop payload events.
- [ ] 2.2 Open dedicated reader windows for EPUB and PDF with focus/reuse by
  identity.
- [ ] 2.3 Wire cross-window reading-progress update and persistent local cache
  updates.

## 3. Reader page updates

- [ ] 3.1 Register `onOpenReader` handler in EPUB reader and launch book from
  desktop payload.
- [ ] 3.2 Register `onOpenReader` handler in PDF reader and launch book from
  desktop payload.
- [ ] 3.3 Emit progression updates from EPUB/PDF readers to desktop bridge.

## 4. Nostr bridge compatibility

- [ ] 4.1 Implement desktop `window.nostr` methods used by the web client.
- [ ] 4.2 Add local secure-storage fallback for desktop native signing credentials.
- [ ] 4.3 Add NIP-46/remote signing path in a follow-up milestone.

## 5. Packaging

- [ ] 5.1 Add `desktop/package.json` with electron and electron-builder scripts.
- [ ] 5.2 Add README notes for local run and local build.
- [ ] 5.3 Generate platform artifacts from CI for macOS, Windows, and Linux.

## 6. Test coverage

- [ ] 6.1 Extend web dependency-free tests for desktop bridge helper paths.
- [ ] 6.2 Add desktop bridge integration smoke tests (desktop reader payload,
  progress propagation, route protection).
- [ ] 6.3 Add Electron end-to-end tests for openReader focus/reuse and progress
  callbacks.

## 7. System read-aloud

- [x] 7.1 Share the dependency-free speech planner with desktop and native EPUB
  readers, including 180/240 character limits and one-word-tail rebalancing.
- [x] 7.2 Add Electron-only EPUB and PDF controls backed by operating-system
  voices, language metadata, and paragraph-aware pauses.
- [x] 7.3 Cancel speech and stale timers on stop, navigation, reader replacement,
  and teardown without extending the desktop bridge.
- [x] 7.4 Cover planning, playback state, EPUB/PDF desktop flows, mobile asset
  packaging, native fallbacks, and the non-Electron browser gate.
