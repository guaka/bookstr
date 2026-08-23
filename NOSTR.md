# Bookstr Nostr data

The canonical Nostr wire specification for Bookstr and LibVault is
[LibVault's NOSTR.md](https://github.com/guaka/libvault/blob/main/NOSTR.md). It
defines all implemented event kinds, `d` namespaces, payload schemas, private
favorite tags, chunking, signer boundaries, relay behavior, Blossom
authorization, privacy properties, and planned kinds.

Bookstr is offline-first: Nostr is optional, and relay or signer failure must
not prevent reading or discard local progress, cached books, favorites, or
saved vocabulary.

At a glance, Bookstr uses:

- kind `30078` with `d=app.bookstr.progress.<book-id>` for public reading
  progress;
- kind `30078` with `d=app.bookstr.vocabulary.<stable-random-sync-id>` for
  NIP-44-encrypted saved words;
- kind `30003` with `d=libvault-favorites` and optional chunk events for
  NIP-44-encrypted favorites shared with LibVault;
- kind `5` on the web for vocabulary deletion requests;
- kind `24242` as short-lived HTTP authorization for private Blossom downloads;
- NIP-07 in browsers, NIP-55 on Android, and NIP-46 or local signing on iOS.

Do not add or change a Bookstr Nostr wire format only in this file. Update the
canonical repository-level specification and its implementation together.
