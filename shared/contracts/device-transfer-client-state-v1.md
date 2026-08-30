# Device transfer client state v1

This small, platform-neutral state model is the shared-core boundary for the
native pairing UI. It intentionally contains no transport metadata, network
addresses, or local file paths.

Clients derive a `DeviceTransferReadiness` value from their local account and
the verified device registry:

| State | Meaning | UI action |
| --- | --- | --- |
| `connectAccount` | No signed Bookstr account is connected. | Connect account |
| `pairDevice` | An account is connected but no other verified device exists. | Pair a device |
| `ready` | At least one other verified device is available. | Choose a book and device |

`DeviceTransferRequest` normalizes the selected book and recipient IDs. Empty,
control-character-bearing, or oversized identifiers are rejected (256
characters for books and 128 for devices). Native transports consume this
request later; the shared core does not decide how bytes move between devices.

## Native transport seam

Native UI observes only `idle`, `preparing`, `transferring`, `completed`,
`failed`, and `cancelled`, together with a request ID and byte counts. A
foreground WebTorrent/WebRTC adapter may consume opaque Nostr control data,
but torrent locators, peer addresses, ICE payloads, and local paths remain
outside this state and out of UI-facing errors. Control wrappers redact their
string representation, request IDs follow the same bounded identifier rules,
and completed bytes never exceed a known positive total.
