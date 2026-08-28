# Shared reader runtime

Canonical mobile EPUB libraries and native reader-bridge assets belong here.
Browser presentation remains separate, and playback remains owned by Chromium,
Android, and iOS adapters.

Vendor files are moved byte-for-byte, hash-checked, and exercised through
reader integration tests rather than instrumented or modified.

| File | SHA-256 |
| --- | --- |
| `epub.min.js` | `06eae15745107b4aa508c95538275251f69bfb9f1175621fc458d9f42ed082d4` |
| `jszip.min.js` | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |

Android copies these resources to its Gradle-generated asset directory. iOS
references them directly as Xcode resources. The static web and Electron
packages require same-directory URLs, so `generate-web-assets.mjs` copies the
canonical vendor bytes into committed `web/` outputs. Run it with `--check` to
reject altered canonical hashes, missing outputs, or stale copies.
