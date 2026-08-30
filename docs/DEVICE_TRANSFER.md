# Bookstr device transfer

Bookstr uses the account's Nostr identity for private device discovery and
WebTorrent for file bytes. The same boundary applies to Electron, browser,
iOS, and Android clients: Nostr carries encrypted control messages, while the
receiver verifies the downloaded file locally before it becomes readable.

## Device registry

Each installation has a device key, separate from the user's account key. The
account's encrypted NIP-78 registry uses:

- kind `30078`
- `d`: `app.bookstr.devices.v1`
- content: NIP-44 ciphertext containing `{version: 1, devices: [...]}`
- device fields: opaque `device_id`, public key, platform, display name,
  capabilities, `created_at`, `last_seen`, and optional `revoked_at`

Device private keys stay in platform secure storage. A revoked device is
ignored even when it still has an open relay connection.

## Private control messages

Authorized devices exchange NIP-17 gift wraps. The decrypted message is small,
short-lived JSON and never contains filesystem paths:

| Type | Required fields | Purpose |
| --- | --- | --- |
| `bookstr.device.announce` | `version`, `device_id`, `expires_at` | Presence without inventory disclosure |
| `bookstr.library.manifest.request` | `request_id`, `cursor`, `limit` | Request a paginated remote-library view |
| `bookstr.library.manifest.page` | `request_id`, `entries`, `next_cursor` | Return metadata and SHA-256 identifiers |
| `bookstr.transfer.request` | `request_id`, `sha256`, `size`, `private` | Request one verified edition |
| `bookstr.transfer.offer` | `request_id`, `sha256`, `infohash`, `expires_at`, `ice` | Offer torrent metadata and ICE candidates |
| `bookstr.transfer.answer` | `request_id`, `infohash`, `ice` | Complete WebRTC negotiation |

All IDs, cursors, and SDP/ICE values are opaque and expire quickly. QR codes
may be offered as a convenience for opening a Nostr connection; they do not
create a second identity or transport.

## WebTorrent data plane

Public torrents use the shared WSS trackers and may connect browser WebRTC
peers to ordinary desktop BitTorrent peers. Private same-account torrents set
the private flag and disable trackers, DHT, PEX, and LSD; the authorized peer
is supplied by the encrypted control plane. STUN is attempted first and a
configured TURN relay is the fallback for restrictive networks.

Every receiver checks the advertised byte count and complete SHA-256 before
importing or opening a file. Public seeding is limited to records whose rights
permit redistribution and whose operator explicitly opted in. Uploads are
rate-limited by default.

## Explicit boundaries

- WebTorrent is the only peer-transfer implementation in the first release.
- Transmission, Iroh, Tor, and custom public torrent event kinds are deferred.
- Public Nostr events never contain book bytes or a private-library inventory.
- HTTPS and Blossom remain source adapters for records that do not have a
  torrent, not a second peer protocol.
