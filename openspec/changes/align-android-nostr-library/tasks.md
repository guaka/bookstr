## 1. Shared contract

- [x] 1.1 Audit the implemented web catalog, shelves, favorite matching, relay query, and signer behavior
- [x] 1.2 Specify the shared Nostr library and partial-failure behavior
- [x] 1.3 Update web and Android capability deltas to reference the shared contract

## 2. Android data and signer integration

- [x] 2.1 Replace the placeholder/editable catalog URL with the canonical app-owned catalog
- [x] 2.2 Resolve relative catalog EPUB and cover URLs against the canonical catalog URL
- [x] 2.3 Add kind `30003`, `d=libvault-favorites` relay querying and newest-event selection
- [x] 2.4 Add NIP-55 `nip44_decrypt` permission and content-resolver/foreground decryption paths
- [x] 2.5 Parse and match the shared favorite tag format used by web and LibVault
- [x] 2.6 Carry author, year, format, SHA-256, and Blossom URL inside the encrypted favorite event
- [x] 2.7 Remove Android runtime calls to the LibVault web origin and require verified Blossom downloads

## 3. Android UI behavior

- [x] 3.1 Remove catalog URL state and controls from Settings
- [x] 3.2 Load catalog, favorites, and local progress independently
- [x] 3.3 Render Reading, Favorites, and unmatched LibVault favorites without an Android Examples shelf
- [x] 3.4 Refresh the library after Amber connects and when Sync now is selected
- [x] 3.5 Render compact favorites with author/year metadata, in-app opening, and local search
- [x] 3.6 Apply White, Paper, and Night themes across library, favorites, settings, EPUB, and PDF chrome
- [x] 3.7 Use edge-to-edge favorite rows and provide home-screen pinning

## 4. Verification

- [x] 4.1 Add JVM tests for favorite parsing, matching, relative catalog URLs, and canonical event IDs
- [x] 4.2 Run Android unit tests and assemble the debug APK
- [x] 4.3 Install and launch on the emulator and connected phone
- [x] 4.4 Confirm the connected Amber identity can display the user's LibVault favorites
