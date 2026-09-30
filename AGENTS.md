# Bookstr agent instructions

## Development workflow

- Make repository changes on a dedicated branch and deliver them through a pull
  request. Do not push commits directly to the default branch.
- GitHub Actions is disabled in this private repository's settings because the
  owner does not want to use an Actions budget. Do not re-enable Actions or
  trigger billed workflows without an explicit request. Old red checks failed
  before their jobs started because of billing; they say nothing about the code.

## Local CI for pull requests

- Treat `.github/workflows/` as the checklist for local validation. Before
  opening or updating a pull request, run the relevant workflow commands on
  the latest branch head, including generated-file checks, tests, builds,
  coverage gates, and end-to-end checks for the affected platforms. Run Android
  connected tests only on emulators; never clear app data on a personal device.
- Keep pull requests in a tested state: fix failing local checks before marking
  a pull request ready for review, and rerun affected checks after changes or
  merges from its base branch. For stacked pull requests, validate against the
  actual base branch rather than assuming `main`.
- Record the exact commands, results, coverage, and tested environment in the
  pull request description or a follow-up comment. If a relevant check cannot
  run locally, say why and mark the pull request as draft until the gap is
  resolved or the user explicitly accepts it. Never present a skipped check or
  an old GitHub billing failure as a passing test.

## Device data safety

- Run Android connected tests only on emulators. Gradle's
  connected-test cleanup can uninstall Bookstr and erase app-local downloads,
  settings, and reading progress.
- On a personal device, inspect the installed package and APK certificates,
  then update with `adb install -r`. Never use `adb uninstall`, `pm clear`, or a
  Gradle connected-test task on that device to make an install or test pass.

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
