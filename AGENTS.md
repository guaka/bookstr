# Bookstr agent instructions

## Web UI restraint

- Do not add explanatory labels, helper sentences, badges, columns, or status copy unless the user explicitly requests them or they are required for accessibility.
- Prefer concise icons with accessible names over redundant action text when the surrounding context is clear.
- Before adding visible UI copy, reuse placeholders, titles, native controls, or existing status feedback where possible.
- Keep the served web app static and dependency-free at runtime: plain HTML, CSS, and JavaScript without React or npm-built application bundles.
- Add or update dependency-free web regression tests for changes to metadata normalization, routing, caching, Nostr persistence, and library interactions.
- Run `node --test web/tests/*.test.mjs` after those changes when test execution is requested.
