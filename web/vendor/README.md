# Vendored browser assets

These checked-in upstream browser files let Bookstr serve the web app as
ordinary static HTML, CSS, JavaScript, and WebAssembly. They are copied or
built from exact-version packages declared in `web/package.json` and pinned by
`web/pnpm-lock.yaml`. The static app does not load npm packages at runtime.

| Asset | Pinned source | Notes |
| --- | --- | --- |
| `jszip.min.js` and `../shared/reader/jszip.min.js` | `jszip` 3.10.1 | Same upstream minified browser build. |
| `epub.min.js` and `../shared/reader/epub.min.js` | `epubjs` 0.3.93 | Same upstream minified browser build. |
| `vendor/sql-wasm.js`, `vendor/sql-wasm.wasm` | `sql.js` 1.13.0 | JavaScript glue and WebAssembly runtime. |
| `vendor/libarchive.js`, `vendor/libarchive.wasm` | `libarchive-wasm` 1.2.0 | JavaScript glue and WebAssembly runtime. |
| `vendor/pdfjs/pdf.mjs`, `vendor/pdfjs/pdf.worker.mjs` | `pdfjs-dist` 6.2.108 | ES modules for the PDF renderer and worker. |
| `vendor/nostr-tools.js` and its source map | `nostr-tools` 2.24.1 | Locally bundled for browsers with pinned `esbuild` 0.28.2; this replaces the former remote `esm.sh` bundle. |

The generated Nostr bundle retains esbuild's upstream license comments at the
end of the file. Its source map records the original locked npm source files
and includes their source text for debugging. The package license is also copied to
`vendor/nostr-tools.LICENSE`. The PDF.js, EPUB.js, JSZip, and SQL.js license
files are copied alongside their assets or into `vendor/licenses/`.
Trailing whitespace is normalized in the plain-text license copies.

`pnpm --dir web sync:vendor` copies these files from the installed locked
packages and builds the Nostr bundle. `pnpm --dir web check:vendor` compares
the results byte-for-byte with the checked-in assets. Use the corresponding
upstream license files in `vendor/pdfjs/LICENSE` and `vendor/licenses/` when
redistributing the static app.

The libarchive browser distribution is from
[`libarchive-wasm`](https://github.com/ofk/libarchive-wasm) 1.2.0 and is
licensed under MIT. Its WebAssembly build is based on
[`libarchive`](https://github.com/libarchive/libarchive), licensed under the
BSD 2-Clause License. The upstream repositories provide the complete license
texts.
