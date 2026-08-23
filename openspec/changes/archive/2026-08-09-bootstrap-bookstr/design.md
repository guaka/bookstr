## Context

Greenfield project for bookstr. Clients are Android (Kotlin/Compose + Readium) and web (Vite/React + epub.js). Progress sync uses Nostr when the user opts in with an nsec.

## Goals / Non-Goals

**Goals:** SHA-256 book identity; immersive reading; lock-screen reading on Android; Nostr progress sync.

**Non-Goals (v1):** Local SAF import; EPUB transfer over Nostr; DRM/LCP; TTS; MD5/LibGen ids.

## Decisions

1. **Book id = SHA-256 (lowercase hex) of entire EPUB file** — content-addressed, portable across tools.
2. **Android package** `app.bookstr`, minSdk 27, Compose chrome; EPUB via **WebView + bundled epub.js** (Readium remains optional future work, not a current dependency).
3. **Web** Vite + React + TypeScript + epub.js + nostr-tools.
4. **Nostr** kind `30078`, `d` = `app.bookstr.progress.<sha256>`, LWW by `updatedAt`.
5. **Lock screen** uses Activity `setShowWhenLocked(true)` without dismissing keyguard.
6. **Reader chrome** hidden by default; tap center to reveal brief overlay.

## Risks / Trade-offs

- Readium is **not** wired yet; Android currently embeds epub.js in a WebView. Migrating to Readium is separate follow-up work.
- OEM lock-screen quirks (e.g. Xiaomi) may require user settings.
- Doctorow free editions are often CC BY-NC-SA (must label honestly).
- Pasting nsec is risky; encrypt at rest; prefer NIP-07 on web when available.

## Migration

N/A (new project).
