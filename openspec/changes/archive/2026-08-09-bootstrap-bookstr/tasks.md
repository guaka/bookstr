## 1. OpenSpec + monorepo

- [x] 1.1 Initialize OpenSpec and create `bootstrap-bookstr` artifacts
- [x] 1.2 Scaffold `android/`, `web/`, `catalog/` with README stubs

## 2. Seed catalog

- [x] 2.1 Add `catalog/scripts/hash-epubs.sh` and download seed EPUBs
- [x] 2.2 Compute SHA-256 ids and write `catalog/catalog.json` with licenses

## 3. Android app

- [x] 3.1 Gradle Compose app `app.bookstr` with Room, networking, settings
- [x] 3.2 Catalog fetch, download, SHA-256 verify, cache
- [x] 3.3 Immersive WebView/epub.js reader (chrome hide, volume keys, themes) — Readium deferred
- [x] 3.4 Lock-screen reading toggle via `setShowWhenLocked`
- [x] 3.5 Nostr nsec settings + NIP-78 progress publish/pull

## 4. Web app

- [x] 4.1 Vite React TS app with catalog fetch + SHA-256 verify + IndexedDB cache
- [x] 4.2 Immersive epub.js reader (chrome hide, paper/night)
- [x] 4.3 Nostr nsec/NIP-07 + same progress schema

## 5. Docs + archive

- [x] 5.1 Root README: hosting, CORS, SHA-256, OEM lock notes
- [x] 5.2 Archive OpenSpec change into `openspec/specs/`
