# Bookstr web

The served app remains a dependency-free static site: plain HTML, CSS, and
JavaScript, with no application bundles or runtime package loader. TypeScript
is the authoring format for first-party browser code. Sources live in `src/`,
and TypeScript for inline page scripts lives in `templates/`. The build emits
ordinary browser JavaScript and injects inline scripts into their page
templates. It preserves existing script URLs, module paths, page URLs, and
inline-script placement; deploy the generated files, not `src/` or
`templates/`.

From the repository root, install the pinned build and test tools and validate
or regenerate the served files with:

```sh
pnpm --dir web install --frozen-lockfile --ignore-scripts
pnpm --dir web typecheck
pnpm --dir web build
pnpm --dir web check:generated
pnpm --dir web check:vendor
```

The install uses the committed `web/pnpm-lock.yaml`, exact direct dependency
versions, and lockfile integrity hashes. `build` type-checks the browser and
test sources, then writes generated JavaScript and HTML. `check:generated`
repeats the build in check mode and fails if generated files differ. Run
`pnpm --dir web sync:vendor` after intentionally updating a pinned upstream
asset; `check:vendor` verifies the checked-in copies match the pinned package
contents and locally produced Nostr bundle. `pnpm --dir web build:site` stages
a static deployable copy in `web/site-dist/`.

The web toolchain requires Node.js 26.13 or newer and pnpm 10.34.8.

To serve the app locally, run `../webdev.sh` from the repository root. It
serves the static web files on port `11111`.

The build and vendor scripts, including the exact upstream versions and
license locations, are documented in [vendor/README.md](vendor/README.md).
