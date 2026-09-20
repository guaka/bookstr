# Bookstr agent instructions

## Development workflow

- Make repository changes on a dedicated branch and deliver them through a pull
  request. Do not push commits directly to the default branch.
- GitHub Actions CI is currently unavailable due to an account billing /
  spending-limit issue: jobs fail before running tests. Until Actions is
  restored, use local tests, coverage reports, and relevant device checks for
  validation, and report what was actually verified. These infrastructure
  failures are not evidence of test failures or passing checks.

## Web UI restraint

- Do not add explanatory labels, helper sentences, badges, columns, or status copy unless the user explicitly requests them or they are required for accessibility.
- Prefer concise icons with accessible names over redundant action text when the surrounding context is clear.
- Before adding visible UI copy, reuse placeholders, titles, native controls, or existing status feedback where possible.
- Keep the served web app static and dependency-free at runtime: plain HTML, CSS, and JavaScript without React or npm-built application bundles.
- Add or update dependency-free web regression tests for changes to metadata normalization, routing, caching, Nostr persistence, and library interactions.
- Run `node --test web/tests/*.test.mjs` after those changes when test execution is requested.

## Testing and coverage

- All new and changed executable lines must be covered by automated tests.
- Every added or changed source file must ship with unit, integration, or contract
  tests in the same change (or an explicit update to an existing suite that
  exercises the new behavior). Do not land production code without matching tests.
- When adding an iOS `BookstrLogic` source or test file, update `ios/Package.swift`
  sources lists and `.github/workflows/ios.yml` `KNOWN_TESTS` globs so CI counts
  and coverage include them.
- Every changed behavior and branch must have unit or integration coverage.
- User-visible workflows must also receive end-to-end coverage (UI tests or
  Playwright) when the change alters navigation, settings controls, or reader
  flows; give interactive controls stable accessibility identifiers and assert
  those identifiers from e2e tests instead of brittle `firstMatch` queries.
- Generate the relevant web, iOS, or Android coverage report and verify changed-line coverage before declaring work complete. Passing tests without coverage is insufficient.
- Do not use exclusions, ignore annotations, unreachable test-only paths, or reduced thresholds to satisfy this requirement.
- Documentation and other non-executable changes must receive an appropriate validation or contract test when applicable.
