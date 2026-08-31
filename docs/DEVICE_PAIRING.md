# Bookstr device pairing

Bookstr uses Nostr only for private control messages. Book files still move
over the WebTorrent adapters and are verified locally before import.

The shared `DevicePairingClient` accepts four platform capabilities:

| Capability | Web | Electron | Android | iOS |
| --- | --- | --- | --- | --- |
| Account signer | NIP-07 | existing desktop signer/NIP-46 | `NostrSigner`/Amber | `NostrSigner`/NIP-46 |
| Relay publisher | injected WSS pool | Electron relay callback | `NostrClient` | `NostrClient` |
| Device-key storage | session-only by default | Electron `safeStorage` | encrypted preferences/Keystore | Keychain |
| Byte transport | WebTorrent | WebTorrent | WebView/native adapter | WebView/native adapter |

Each installation has a random 32-byte device key. The device public key is
the identity recorded in the authorized device registry. The account signer
decrypts NIP-17 envelopes, so an envelope targets the recipient account
public key; the sender is still authenticated by its registered device key.

`secureStorage` is an explicit capability with `isAvailable()`, `get()`, and
`set(secret)` methods. It must return/store a 32-byte `Uint8Array`. The shared
adapter never writes device secrets to `localStorage`, IndexedDB, IPC payloads,
Nostr events, or status responses. If secure storage is unavailable or fails,
the adapter keeps the identity in memory for the current session only.

Only `wss://` relays are accepted by the publisher. Private envelopes are
short-lived NIP-17 gift wraps and carry no local filesystem paths. The receiving
client must still pass the decoded message through the shared registry and
expiry checks before acting on it.

