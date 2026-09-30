# Android build and validation

Requires JDK 17+, Android SDK 35, NDK 27.2.12479018, CMake 3.22.1 and Boost
headers. On macOS, install Boost with Homebrew and export
`BOOST_ROOT=/opt/homebrew/opt/boost`. On Linux, install `libboost-dev`.
The first native build fetches the immutable libtorrent revision used by iOS.

```sh
sdkmanager 'platforms;android-35' 'build-tools;35.0.0' 'ndk;27.2.12479018' 'cmake;3.22.1'
./gradlew --max-workers=2 testDebugUnitTest jacocoDebugUnitTestReport assembleDebug
./gradlew --max-workers=2 connectedDebugAndroidTest createDebugAndroidTestCoverageReport
```

Run connected tests only on an emulator. Gradle's
connected-test cleanup can uninstall the app and erase its local data, including
downloaded books and reading progress. For a personal tablet, build the APK and
use `adb install -r` instead. The connected-test task refuses to start when a
physical device is attached, even if an emulator is also connected.

The APK includes arm64-v8a, armeabi-v7a and x86_64 libraries and retains API 27
support. Native linking uses 16 KiB page alignment. Debug APKs use the local
Android debug key; release APKs require the existing `BOOKSTR_KEYSTORE_*` and
`BOOKSTR_KEY_*` environment variables. Never uninstall a deployed app to bypass
a certificate mismatch. Inspect the installed certificate and use the same key
for `adb -s DEVICE install -r app/build/outputs/apk/...apk`.

NIP-44 test vectors are from <https://github.com/paulmillr/nip44> (`nip44.vectors.json`).
Native instrumentation uses a tiny local HTTP seed fixture, not a public book or
external peer. Signer tests use a fixture provider; test actual Huddle separately.

See [the Android parity audit](../docs/ANDROID_PARITY.md) for remaining work and
current download constraints.
