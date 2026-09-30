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

## Rebuild and update a personal Android device

Run from `android/` on macOS (adjust the JDK, SDK and Boost paths elsewhere):

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export BOOST_ROOT=/opt/homebrew/opt/boost
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew --max-workers=2 testDebugUnitTest assembleDebug
APK=app/build/outputs/apk/debug/app-debug.apk
BUILD_TOOLS="$(dirname "$(find "$ANDROID_HOME/build-tools" -mindepth 2 -maxdepth 2 -name apksigner | sort | tail -n 1)")"
"$BUILD_TOOLS/aapt" dump badging "$APK" | head -n 2
"$BUILD_TOOLS/apksigner" verify --print-certs "$APK"
adb devices -l
```

Use the serial from `adb devices -l`, especially when an emulator is attached.
Before installing, compare the APK signer with the installed app. If the app is
already installed, find its base APK with `adb -s SERIAL shell pm path app.bookstr`,
pull that path to a temporary file, and run `apksigner verify --print-certs` on it.
The SHA-256 signer digests must match. A mismatch needs the original signing key;
do not uninstall the app. Then update in place and verify the install date:

```sh
adb -s SERIAL shell dumpsys package app.bookstr | grep firstInstallTime
adb -s SERIAL install -r "$APK"
adb -s SERIAL shell dumpsys package app.bookstr | grep -E 'versionName|firstInstallTime|lastUpdateTime'
```

The first install time should remain unchanged. Keep UI tests on a disposable
emulator. Search automatically requests the next page near the list end; newly
queued downloads appear first, and completed rows open when tapped. In a reader,
tap the bottom edge to reveal the four app destinations.
Tap an author's name in the EPUB, PDF, or FB2 header to search for that author.

### Update over Wi-Fi

On the tablet, enable **Developer options → Wireless debugging**, then choose
**Pair device with pairing code**. Keep that dialog open while running:

```sh
adb pair TABLET_IP:PAIRING_PORT
# Enter the code shown on the tablet when prompted.
adb mdns services
adb connect TABLET_IP:CONNECT_PORT
adb -s TABLET_IP:CONNECT_PORT shell getprop ro.serialno
adb -s TABLET_IP:CONNECT_PORT install -r "$APK"
```

Use the `_adb-tls-connect._tcp` port from `adb mdns services` or the tablet's
Wireless debugging screen for `CONNECT_PORT`; it differs from `PAIRING_PORT`.
Compare the returned serial with the USB serial before installing. If pairing
times out, reopen the pairing dialog for a fresh code and port. The same signer
and first-install-time checks above apply over Wi-Fi. Avoid plain `adb tcpip`
debugging on a shared network.

NIP-44 test vectors are from <https://github.com/paulmillr/nip44> (`nip44.vectors.json`).
Native instrumentation uses a tiny local HTTP seed fixture, not a public book or
external peer. Signer tests use a fixture provider; test actual Huddle separately.

See [the Android parity audit](../docs/ANDROID_PARITY.md) for remaining work and
current download constraints.
