# Reading progress v2

Kind `30078` events use the d-tag `app.bookstr.progress.<bookId>`. Canonical
emitters write version `2`, a non-empty `bookId`, millisecond `updatedAt`, and
the locator fields `progression`, `furthestProgression`, and `cfi`.

Readers continue to accept version 1 locator payloads and legacy flat
`progression`/`cfi` payloads. Numeric strings are accepted for compatibility,
invalid numbers become zero, missing timestamps fall back to the event's
seconds timestamp, and furthest progress never falls behind current progress.

UI, persistence, relay transport, signing, and merge policy remain
platform-owned. Every client runs `shared/fixtures/reading-progress-v2.json`
through its existing wire adapter.
