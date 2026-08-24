# Align iOS with the Android 0.0.3 app

## Why

The native iOS foundation can compile and synchronize Bookstr data, but it does
not yet provide a working EPUB reader or the complete library, search, download,
and reading behavior available in the Android 0.0.3 APK.

## What changes

- Bundle and reuse the Android EPUB reader assets in the iOS app.
- Match the Android Library, Words, Search, Settings, EPUB, and PDF behavior.
- Use NIP-46 as the primary signer path, including direct same-device pairing
  with Signstr through its `nostrconnect://` URL handler.
- Authenticate private Blossom downloads and verify their SHA-256 identifiers.
- Keep the display awake during reading. Add a Current Book Live Activity as an
  iOS-appropriate Lock Screen companion; it is not full locked-device reading.
- Validate on the physical iPhone named `ip2`, with iOS 17 as the minimum.

## Baseline

Parity is measured approximately against the latest Android 0.0.3 APK and its
current source implementation. Android-only lock-screen overlay behavior and
volume-key paging are replaced with iOS-native equivalents where possible.
