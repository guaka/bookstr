# Design: shared core with thin adapters

The dependency direction is one-way: platform clients consume shared contracts,
fixtures, runtime assets, and generated declarations. Shared code never imports
platform UI, storage, networking, signing, speech playback, or PDF frameworks.

The first increment records the boundary and client capability inventory. Later
pull requests may move one canonical source at a time, with committed generated
outputs and conformance tests in every affected language.

Compatibility is preserved by accepting the union of supported legacy inputs
at adapter boundaries and emitting only the documented canonical form. No
database, storage-key, signing, or Nostr migration is implied.
