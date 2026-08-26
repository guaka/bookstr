# Bookstr agent instructions

## Web UI restraint

- Do not add explanatory labels, helper sentences, badges, columns, or status copy unless the user explicitly requests them or they are required for accessibility.
- Prefer concise icons with accessible names over redundant action text when the surrounding context is clear.
- Before adding visible UI copy, reuse placeholders, titles, native controls, or existing status feedback where possible.
- Keep the served web app static and dependency-free at runtime: plain HTML, CSS, and JavaScript without React or npm-built application bundles.
- Add or update dependency-free web regression tests for changes to metadata normalization, routing, caching, Nostr persistence, and library interactions.
- Run `node --test web/tests/*.test.mjs` after those changes when test execution is requested.

## Testing and coverage

- All new and changed executable lines must be covered by automated tests.
- Every changed behavior and branch must have unit or integration coverage.
- User-visible workflows must also receive end-to-end coverage.
- Generate the relevant web, iOS, or Android coverage report and verify changed-line coverage before declaring work complete. Passing tests without coverage is insufficient.
- Do not use exclusions, ignore annotations, unreachable test-only paths, or reduced thresholds to satisfy this requirement.
- Documentation and other non-executable changes must receive an appropriate validation or contract test when applicable.
