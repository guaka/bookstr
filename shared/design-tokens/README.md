# Shared design tokens

Canonical palette values, semantic color roles, and vector identity sources
belong here. Deterministic generators produce committed CSS variables, Compose
colors, and Swift declarations. Layout, typography, navigation, accessibility,
and native controls remain platform-owned.

`tokens.json` is the machine-readable source of truth. Regenerate platform
outputs with `node shared/design-tokens/generate.mjs`; CI uses
`node shared/design-tokens/generate.mjs --check` to reject stale output.
