# Android acquisition and parity audit

Audit baseline: Bookstr `05f38a1` (iOS reader/download-order merge).

## Acquisition in this change

Android uses the existing Libcat identity and relay for signed-in NIP-17 search
and edition resolution. Signed-out search remains public HTTP search. A failed
private search stays an explicit, retryable failure. Search pages are not cached.
Only selected editions enter the persistent download journal.

Huddle’s installed emulator manifest was inspected: `huddle.family.app/.signer.NostrSignerActivity` handles `nostrsigner:`, and its provider registers `SIGN_EVENT`, `NIP44_ENCRYPT` and `NIP44_DECRYPT`. This confirms discovery/routing, not real-phone approval behavior.

NIP-55 discovers installed providers, uses Android's chooser when needed, and
addresses subsequent requests to the returned package. Huddle is an external
provider; Bookstr never imports its private key. The persisted `amber` auth-mode
key remains compatible with existing installations, while visible labels use the
selected provider. Connection, signing and NIP-44 rejection require no key reset.

Downloads run in a data-sync foreground service, with notification pause and
in-app pause, resume, cancellation and read controls. Cancellation retains partial
data. Android's foreground-service time limit pauses jobs for user resumption.
Interrupted jobs recover on the next foreground launch. Network reconnection
retries waiting jobs; unavailable peers and low storage require an explicit retry.

The native engine is pinned to the same libtorrent 2.0.11 commit as iOS. Only the
selected file has download priority; boundary pieces may occupy the partfile.
Metadata is limited to 16 MiB, selected files to 8 GiB, and metadata filenames
are never used as local paths. Files become library entries only after MD5,
expected-size and supported-format checks. Staging plus import can require about
twice the selected book's size. HTTPS trackers are unavailable in this TLS-free
native build; metadata itself is fetched over HTTPS with OkHttp.

## Remaining priorities

| Priority | Area | Verified difference / next action |
| --- | --- | --- |
| P1 | Physical-device acceptance | Verify Huddle's actual intent/content-provider behavior and remembered signing/encryption permissions on each deployed phone; test certificate-compatible APK replacement preserving books and progress. Emulator fixtures cannot establish this. |
| P1 | Cross-device progress | Both clients publish/read progress and private vocabulary. Exercise matching MD5 editions, stale events, offline changes and reader relocation across real Android/iOS installs before claiming parity. |
| P2 | Cover artwork | The local iOS branch also contains `da7ec3b` (covers in library, search and now playing). Android search/library still use text-focused rows. Port the cover loading/cache behavior and verify missing-cover fallbacks separately. |
| P2 | Neural speech | iOS has `NeuralSpeechSession`, `NeuralSpeechPlayback` and downloadable speech models. Android uses system TextToSpeech and NarrationService. Add local model playback and per-language model/voice controls if this is the next desired capability. |
| P2 | Reader selections | iOS has a dedicated snippet repository and native selection actions. Android has dictionary/vocabulary actions but no matching snippet repository. Specify snippet persistence/sync before porting. |
| P2 | Library organization | Android decodes shared collections, but its library surface needs comparison with iOS's collection workflows. Reader formats already include EPUB, PDF, FB2 and CBZ/CBR; format support alone is not proof of interaction parity. |
| P2 | Acquisition polish | Detect the actual format when catalog extension metadata is wrong, and add HTTPS tracker support with a pinned TLS dependency. Existing verified files and partials must survive either change. |
| P2 | HTTPS OTA updates | Planned in [ANDROID_OTA.md](ANDROID_OTA.md): release signing, in-app PackageInstaller path, empty `UpdateConfig.baseUrl` until a host exists. |
| P3 | Device pairing | Shared pairing contracts exist, but the roadmap still identifies native host bridge work. Treat device-to-device transfer as separate work from Libcat metadata search and torrent acquisition. |

No production service changes are needed for this Android update.
