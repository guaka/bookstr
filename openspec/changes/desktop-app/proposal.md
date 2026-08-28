## Why

Bookstr currently ships web, Android, and iOS clients with different UX constraints.
Users need an equivalent desktop app for long-form reading, dedicated reader windows,
library workflows, and local Nostr/NIP-44 progress sync without rewriting the
existing EPUB/PDF readers.

## What Changes

- Add an Electron desktop shell using the current `web/` assets.
- Expose a constrained `window.bookstrDesktop` API for reader launch, library focus,
  external-link policy, and cross-window reading-progress updates.
- Add Nostr facade methods required by the web bridge (`getPublicKey`, `signEvent`,
  `nip44.encrypt`, `nip44.decrypt`) with a local fallback plan.
- Keep localStorage and IndexedDB shared across library and reader windows.
- Reuse the same progress and cache contract as the browser readers.
- Add system-voice read-aloud to dedicated Electron EPUB and PDF windows through
  the shared mobile speech planner; keep ordinary browser controls hidden.

## Capabilities

### New capabilities

- `desktop-app`: Dedicated Electron application using Bookstr web readers.
- `desktop-reader-windows`: Per-book Reader windows with focus-on-open semantics.
- `desktop-protocol`: `app://bookstr` protocol with strict navigation handling.

### Modified capabilities

- `desktop-nostr-bridge`: Constrained signer interface for web-compatible signing
  and NIP-44 operations.

## Impact

- Desktop users get the existing web reading contract with shared cache and sync.
- Existing browser web behavior remains unchanged.
- Desktop narration uses no new IPC, cloud service, downloaded model, or voice
  preference surface.
- Shared OpenSpec contracts for reader payload and progress are now available for
  desktop routing.
