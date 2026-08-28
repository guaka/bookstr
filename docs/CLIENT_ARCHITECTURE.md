# Shared client core

Bookstr uses a shared platform-neutral core with thin platform adapters. The
web, Electron, Android, and iOS clients keep their native shells; sharing a UI
framework is explicitly out of scope.

## Ownership boundary

The shared core owns stable data and deterministic behavior:

- versioned wire contracts and protocol constants;
- conformance fixtures and compatibility aliases;
- EPUB vendor/runtime assets and provider-neutral speech planning;
- canonical brand vectors and semantic design tokens;
- generators for wire DTOs, constants, serializers, and token declarations.

Platform adapters own capabilities that depend on an operating system or app
runtime:

- UI, navigation, accessibility, and native controls;
- persistence entities and migrations;
- catalog/network transport and offline scheduling;
- Nostr signers and secure key storage;
- speech playback, media sessions, and background execution;
- PDF rendering and native reader bridges.

## Dependency direction

Platform shells may depend on generated wire types and shared runtime assets.
Shared sources must not import Compose, SwiftUI, Electron, browser storage,
Room, PDFKit, Android services, or platform networking.

Adapters translate at their boundary:

1. parse existing persisted or wire data, including supported legacy aliases;
2. map it to a canonical shared contract;
3. run deterministic shared behavior or fixtures;
4. map the result into platform persistence and UI models.

This direction keeps compatibility decisions testable without forcing the four
clients into the same lifecycle, storage model, or UI toolkit.

## Change rules

- Generated outputs are committed; native builds must not require Node.
- Every generator supports deterministic regeneration and `--check`.
- Shared changes trigger every affected client workflow.
- Existing database layouts, browser keys, public URLs, signing methods, and
  wire formats stay compatible unless a separately reviewed migration says
  otherwise.
- A shared behavior correction gets one fixture that every affected language
  executes.

The maintained capability matrix is generated from
`shared/architecture/clients.json` into `docs/CLIENT_CAPABILITIES.md`.
