## Context

The web app restores a Nostr identity, queries the user's addressable NIP-51 list, decrypts the list through the signer, and merges trusted Blossom-backed favorites into the normal shelves. It ships without bundled example publications. LibVault favorites without a Blossom descriptor remain visible as external entries.

Android currently loads `SettingsRepository.DEFAULT_CATALOG_URL`, whose placeholder value is `https://example.org/catalog.json`. Its NIP-55 connection requests only `sign_event` permission for kind `30078`, and its Nostr repository only handles progress.

## Goals / Non-Goals

**Goals:** one library contract across web and Android; no editable catalog URL; private favorite decryption stays in the signer; preserve external LibVault favorites; maintain offline/local progress behavior; surface partial failures without discarding successful data.

**Non-Goals:** publish or edit the LibVault favorite set from Bookstr; make Nostr relays carry EPUB bytes; replace SHA-256 identity for seed EPUBs; trigger LibVault fetch jobs automatically; implement web vocabulary features on Android in this change.

## Decisions

1. **Both clients show the personal library.** Web and Android organize locally known books into Reading and Favorites without an Examples shelf. Unmatched LibVault favorites remain visible rather than being dropped.
2. **The catalog is app-owned.** The web build's catalog is empty by default; neither client exposes a catalog URL setting.
3. **Favorites remain private NIP-51 data.** Clients query kind `30003` authored by the connected pubkey with `d=libvault-favorites`, select the newest event, and NIP-44 decrypt its content to the same pubkey.
4. **Android delegates decryption to Amber.** The NIP-55 connection requests `nip44_decrypt` and progress `sign_event:30078`. Remembered permissions use the content resolver; otherwise the foreground Activity result flow asks the signer.
5. **Matching follows the web implementation.** Match in order by Bookstr id, LibVault MD5, normalized ISBN, or source URL. Deduplicate unmatched entries by the first stable identity available.
6. **Identity types remain explicit.** Seed catalog books use SHA-256 and verified EPUB downloads. External LibVault entries use MD5 only as a LibVault locator and open their trusted HTTPS LibVault URL; they are not passed through SHA-256 verification as if MD5 were a content hash.
7. **Sources fail independently.** A catalog failure may leave Nostr external favorites visible. A Nostr failure may leave local progress visible. Retry re-runs both relevant reads.

## Risks / Trade-offs

- Amber must support and authorize NIP-55 `nip44_decrypt`; older signers may require an interactive prompt or fail with a clear message.
- A LibVault favorite may reference a file that is not cached on LibVault yet. This change preserves the link but does not start a server-side fetch job.
- Android cannot open unmatched external entries inside the reader until a trusted EPUB URL is available; opening the LibVault link is the safe interoperable fallback.

## Migration

- Stop reading and writing the Android `catalog_url` preference. Do not delete other preferences or databases.
- Existing Amber connections may lack remembered decrypt permission. Reconnecting Amber requests the expanded permissions; a foreground sync may also prompt interactively.
