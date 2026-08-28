# Proposal: establish a shared client core

## Why

Bookstr has four client shells with repeated contracts, fixtures, reader assets,
and visual constants. Repetition makes compatibility fixes drift while the UI
and operating-system integrations are intentionally different.

## What changes

- Establish canonical shared areas for architecture data, contracts, fixtures,
  reader runtime assets, and design tokens.
- Define a shared-core versus platform-adapter ownership boundary.
- Generate a committed capability matrix from deterministic source data.
- Require stale generated output to fail validation.

This change does not move production assets yet and does not introduce a shared
UI framework, storage migration, wire-format change, or deployment.
