# libstr desktop

This directory contains the Electron shell for the libstr desktop app. It loads
the existing web reader UI from `../web` through a custom `app://bookstr` protocol,
keeps reading inside the main library window, opens one reader window per opened
book, and synchronizes reading progress through an isolated preload bridge. The
desktop uses the bundled WebTorrent client for public and private transfers; it
does not bundle Transmission or Iroh.

## Run locally

Requires Node.js 22.12 or newer and pnpm 10.34.8 (pinned in `package.json`).
The Electron package has its own lockfile and configuration in this directory.

```bash
cd bookstr/desktop
pnpm install
pnpm start
```

## Test

```bash
cd bookstr/desktop
pnpm install
pnpm run test
pnpm run test:e2e:smoke
pnpm run test:e2e:reader
```

TypeScript modules in `src/*.ts` compile to JavaScript in the matching paths
under `desktop/`. Run `pnpm run build:typescript` to emit those files and
`pnpm run typecheck` to check types without emitting. Both commands cap the
Node.js heap at 512 MB; the TypeScript compiler also uses `GOMEMLIMIT=512MiB`
and `GOMAXPROCS=2`. The compiler runs once per command and does not leave a
watch process running.

The test suite uses Playwright Electron mode to validate bootstrap, preload bridge,
and reader read-aloud behavior.

To run the complete Electron end-to-end suite in the pinned Linux test container:

```bash
cd desktop
pnpm run test:e2e:docker
```

The Docker command builds from the repository root, runs as Playwright's
unprivileged user under Xvfb, and removes the test container when it finishes.

## Package (CI/release)

- `pnpm run dist` produces macOS `.dmg`, Windows `.exe`, and Linux `.AppImage/.deb`
  artifacts through `electron-builder`.
- `pnpm run dist:linux`, `pnpm run dist:win`, and `pnpm run dist:mac` build a single
  platform target.
- `pnpm run dist:all` produces all three desktop targets in sequence.

## Update behavior

- Updates are intentionally manual for the beta stage. Use **Check for Updates**
  from the desktop libstr menu to open the GitHub Releases page:
  <https://github.com/guaka/bookstr/releases>

## Notes

- pnpm installs the prebuilt `node-datachannel` binary using a committed patch.
  If no prebuilt binary is available, installation fails instead of starting an
  unbounded C++ WebRTC build. Native package scripts run one at a time.

- Completed CBZ/CBR downloads with JPEG or PNG pages are converted to cached
  PDFs for Kindle transfer. Archives are limited to 256 MiB, 300 pages, 24 MiB
  per page, and 512 MiB of expanded page data; unsupported or encrypted comics
  appear in the Kindle preview's skipped count. The bundled [7-Zip](https://www.7-zip.org/)
  extractor is distributed under the LGPL with the unRAR restriction; its
  source is available from the linked project.
- Main and reader windows use a shared persisted session so library state and
  reading progress remain in sync across windows.
- Reader windows receive signed payloads from the main process via a constrained
  bridge (`window.bookstrDesktop`).
- `window.bookstrDesktop.transfers` exposes status, rights-gated public seeding,
  and public/private torrent admission without exposing library paths.
- `window.bookstrDesktop.library.acquire(record)` selects an eligible HTTPS or
  torrent source, retries safely, and imports only after checksum verification.
- Clicking a LibVault catalog record checks the local library first. If the
  file is absent and the library entry contains only an MD5, Bookstr resolves
  its numeric LibGen ID through the read-only `libvault.resolve` NIP-17 request.
  Electron then opens the record's 1,000-book repository torrent in deselected
  mode, downloads only the MD5-named file, and imports it locally.
- Desktop library rows present these records as **Torrent** rather than showing
  Blossom availability. Blossom remains a legacy compatibility fallback during
  migration.
- External links are opened in the system browser.
