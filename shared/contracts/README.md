# Shared contracts

Versioned schemas, wire constants, and serializer inputs belong here. Generated
DTOs may describe wire data only; Room entities, Swift persistence models,
browser storage records, and UI models remain platform-owned.

Contract changes must accept documented legacy inputs, emit the canonical form,
and add a conformance fixture for every corrected mismatch.

`device-pairing-client.mjs` is the platform-neutral pairing boundary. Native
and browser shells inject their signer, WSS relay publisher, and OS-secure
device-key storage; the shared module intentionally has no filesystem or
platform-storage dependency.

`publication-nip94-v1.mjs` creates or reads compact public file metadata. A
writer must pass an explicit operator opt-in, completed SHA-256 verification,
allowed redistribution rights, and a public HTTPS locator. It deliberately
cannot publish a local path or turn a source URL into republication permission.
