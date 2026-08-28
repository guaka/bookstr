# Bookstr shared client core

This directory contains platform-neutral sources consumed by two or more
Bookstr clients. It does not contain a cross-platform UI framework.

The manually maintained sources belong in these areas:

- `architecture/`: machine-readable client ownership and capability data.
- `contracts/`: versioned wire schemas and protocol constants.
- `fixtures/`: conformance examples run by JavaScript, Kotlin, and Swift tests.
- `reader/`: platform-neutral EPUB and speech-planning runtime assets.
- `design-tokens/`: canonical visual identity and semantic color sources.

Generated Kotlin, Swift, JavaScript, and CSS outputs remain committed beside
their platform consumers so native builds do not require Node. Generators must
be deterministic and provide a `--check` mode.

Platform code owns UI, storage models, networking, signers, playback engines,
PDF rendering, background services, and the thin adapters around this core.
