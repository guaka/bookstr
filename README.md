# bookstr

AGPL-3.0 EPUB reader: native Android (Kotlin/Compose) + web (React/Vite), HTTPS catalog keyed by **SHA-256 of EPUB bytes**, optional Nostr progress sync, optional Android lock-screen reading.

## Layout

- `android/` — `app.bookstr` (Gradle 8.11.1, AGP 8.7.3, Kotlin 2.0.21, SDK 35)
- `web/` — Vite + React + TypeScript + epub.js + nostr-tools
- `catalog/` — example `catalog.json` + scripts (EPUB binaries gitignored)
- `openspec/` — spec-driven change tracking

## Android reader note

Current Android reading uses a **WebView + bundled epub.js**. OpenSpec still mentions Readium; that migration is separate application work and is **not** implemented yet.

## Catalog / books

```bash
cd catalog
./scripts/fetch-seeds.sh   # optional public CC/PD seeds
# or drop your own EPUBs into staging/ then:
./scripts/hash-epubs.sh
# update catalog.json ids to match sha256 of each file
```

`catalog/books/*.epub` is gitignored — keep private libraries off the public remote.

## Web

```bash
cd web
npm ci
npm run dev
# default catalog URL: /catalog/catalog.json (symlink into public/ for local seeds)
```

## Android

```bash
cd android
./gradlew assembleDebug
```

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
