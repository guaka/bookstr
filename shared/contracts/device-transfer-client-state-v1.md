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

`DeviceTransferRequest` normalizes the selected book and recipient IDs. Empty
or whitespace-only identifiers are rejected. Native transports consume this
request later; the shared core does not decide how bytes move between devices.
