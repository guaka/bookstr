## Context

Greenfield monorepo for bookstr. Books live on the user's HTTPS server as static files. Clients are Android (Kotlin/Compose + Readium) and web (Vite/React + epub.js). Progress sync uses Nostr when the user opts in with an nsec.

## Goals / Non-Goals

**Goals:** HTTPS catalog with SHA-256 ids; immersive reading; lock-screen reading on Android; Nostr progress sync; seed CC/PD books.

**Non-Goals (v1):** Local SAF import; EPUB transfer over Nostr; DRM/LCP; TTS; auth-gated catalog; MD5/LibGen ids.

## Decisions

1. **Book id = SHA-256 (lowercase hex) of entire EPUB file** — content-addressed, portable across tools.
2. **Catalog JSON** lists metadata + `epubUrl`; clients verify hash after download and store as `{sha256}.epub`.
3. **Android package** `app.bookstr`, minSdk 27, Compose chrome; EPUB via **WebView + bundled epub.js** (Readium remains optional future work, not a current dependency).
4. **Web** Vite + React + TypeScript + epub.js + nostr-tools.
5. **Nostr** kind `30078`, `d` = `app.bookstr.progress.<sha256>`, LWW by `updatedAt`.
6. **Lock screen** uses Activity `setShowWhenLocked(true)` without dismissing keyguard.
7. **Reader chrome** hidden by default; tap center to reveal brief overlay.

## Risks / Trade-offs

- Readium is **not** wired yet; Android currently embeds epub.js in a WebView. Migrating to Readium is separate follow-up work.
- OEM lock-screen quirks (e.g. Xiaomi) may require user settings.
- Doctorow free editions are often CC BY-NC-SA (must label honestly).
- Pasting nsec is risky; encrypt at rest; prefer NIP-07 on web when available.

## Migration

N/A (new project).
