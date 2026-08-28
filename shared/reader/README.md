# Shared reader runtime

Canonical EPUB libraries, speech planning, and native reader-bridge assets
belong here. Browser presentation remains separate, and playback remains owned
by Chromium, Android, and iOS adapters.

Vendor files are moved byte-for-byte, hash-checked, and exercised through
reader integration tests rather than instrumented or modified.
