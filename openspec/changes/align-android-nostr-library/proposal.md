## Why

Bookstr should present the user's library rather than a fixed collection of example books. Both clients need the user's encrypted LibVault favorites and readable Blossom publications.

## What Changes

- Define the web client's library behavior as a shared Bookstr contract.
- Ship the web client without bundled example publications or an Examples shelf.
- Read the user's private LibVault favorite set from Nostr kind `30003`, `d=libvault-favorites`.
- Decrypt favorites through the active platform signer: NIP-07/NIP-46 on web and NIP-55/Amber on Android.
- Turn trusted Blossom descriptors into readable EPUB/PDF favorites and retain unpublished entries with their encrypted metadata and link.
- Keep favorites and progress failures independent so one source does not hide data loaded from another.
- Bring Android's Library and Amber permission request into conformance with the shared behavior.

## Capabilities

### New Capabilities

- `nostr-library`: Cross-client loading and rendering of encrypted LibVault favorites.

### Modified Capabilities

- `web-app`: Record the existing shelf-based library as the reference behavior.
- `android-app`: Adopt the shared Nostr library flow.

## Impact

- Android settings and startup library loading change.
- Android requests remembered `nip44_decrypt` permission from Amber in addition to progress signing.
- Blossom publications remain HTTPS/SHA-256 verified. LibVault favorites retain their MD5 interoperability identity and are not misrepresented as SHA-256 entries.
