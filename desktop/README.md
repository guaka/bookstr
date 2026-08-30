# libstr desktop

This directory contains the Electron shell for the libstr desktop app. It loads
the existing web reader UI from `../web` through a custom `app://bookstr` protocol,
keeps reading inside the main library window, opens one reader window per opened
book, and synchronizes reading progress through an isolated preload bridge. The
desktop uses the bundled WebTorrent client for public and private transfers; it
does not bundle Transmission or Iroh.

## Run locally

```bash
cd bookstr/desktop
npm install
npm start
```

## Test

```bash
cd bookstr/desktop
npm install
npm run test
npm run test:e2e:smoke
npm run test:e2e:reader
```

The test suite uses Playwright Electron mode to validate bootstrap, preload bridge,
and reader read-aloud behavior.

To run the complete Electron end-to-end suite in the pinned Linux test container:

```bash
cd desktop
npm run test:e2e:docker
```

The Docker command builds from the repository root, runs as Playwright's
unprivileged user under Xvfb, and removes the test container when it finishes.

## Package (CI/release)

- `npm run dist` produces macOS `.dmg`, Windows `.exe`, and Linux `.AppImage/.deb`
  artifacts through `electron-builder`.
- `npm run dist:linux`, `npm run dist:win`, and `npm run dist:mac` build a single
  platform target.
- `npm run dist:all` produces all three desktop targets in sequence.

## Update behavior

- Updates are intentionally manual for the beta stage. Use **Check for Updates**
  from the desktop libstr menu to open the GitHub Releases page:
  <https://github.com/guaka/bookstr/releases>

## Notes

- Main and reader windows use a shared persisted session so library state and
  reading progress remain in sync across windows.
- Reader windows receive signed payloads from the main process via a constrained
  bridge (`window.bookstrDesktop`).
- `window.bookstrDesktop.transfers` exposes status, rights-gated public seeding,
  and public/private torrent admission without exposing library paths.
- External links are opened in the system browser.
