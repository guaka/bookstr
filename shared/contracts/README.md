# Shared contracts

Versioned schemas, wire constants, and serializer inputs belong here. Generated
DTOs may describe wire data only; Room entities, Swift persistence models,
browser storage records, and UI models remain platform-owned.

Contract changes must accept documented legacy inputs, emit the canonical form,
and add a conformance fixture for every corrected mismatch.
