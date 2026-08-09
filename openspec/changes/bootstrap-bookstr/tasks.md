## 1. OpenSpec + monorepo

- [ ] 1.1 Initialize OpenSpec and create `bootstrap-bookstr` artifacts
- [ ] 1.2 Scaffold `android/`, `web/`, `catalog/` with README stubs

## 2. Seed catalog

- [ ] 2.1 Add `catalog/scripts/hash-epubs.sh` and download seed EPUBs
- [ ] 2.2 Compute SHA-256 ids and write `catalog/catalog.json` with licenses

## 3. Android app

- [ ] 3.1 Gradle Compose app `app.bookstr` with Room, networking, settings
- [ ] 3.2 Catalog fetch, download, SHA-256 verify, cache
- [ ] 3.3 Immersive Readium reader (chrome hide, volume keys, themes)
- [ ] 3.4 Lock-screen reading toggle via `setShowWhenLocked`
- [ ] 3.5 Nostr nsec settings + NIP-78 progress publish/pull

## 4. Web app

- [ ] 4.1 Vite React TS app with catalog fetch + SHA-256 verify + IndexedDB cache
- [ ] 4.2 Immersive epub.js reader (chrome hide, paper/night)
- [ ] 4.3 Nostr nsec/NIP-07 + same progress schema

## 5. Docs + archive

- [ ] 5.1 Root README: hosting, CORS, SHA-256, OEM lock notes
- [ ] 5.2 Archive OpenSpec change into `openspec/specs/`
