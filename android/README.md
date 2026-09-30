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

## Check, rebuild, and install on a connected device

Run these commands from `bookstr/android`. On this Mac, Homebrew's default
`java` can select Java 8 even when a newer JDK is installed, and
`ANDROID_HOME` points to the parent of the SDK. Set the paths explicitly:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export BOOST_ROOT=/opt/homebrew/opt/boost
printf 'sdk.dir=%s\n' "$ANDROID_SDK_ROOT" > local.properties
"$JAVA_HOME/bin/java" -version
"$ANDROID_SDK_ROOT/platform-tools/adb" devices -l
```

Choose the serial shown as `device` (not `offline` or `unauthorized`) and
replace `DEVICE_SERIAL` below. Check the installed and built versions before
installing; Gradle writes the built version to `output-metadata.json`.

```sh
export DEVICE=DEVICE_SERIAL
"$ANDROID_SDK_ROOT/platform-tools/adb" -s "$DEVICE" shell dumpsys package app.bookstr \
  | grep -E 'versionCode=|versionName=|lastUpdateTime='
./gradlew --max-workers=2 assembleDebug
cat app/build/outputs/apk/debug/output-metadata.json
```

If Bookstr is already installed, compare its signing certificate with the APK.
Use a temporary location outside the checkout for the pulled APK and remove
that temporary copy after checking. The SHA-256 digests must match. This also
works when the installed version came from a different build directory.

```sh
APK=app/build/outputs/apk/debug/app-debug.apk
INSTALLED_APK=$("$ANDROID_SDK_ROOT/platform-tools/adb" -s "$DEVICE" shell pm path app.bookstr \
  | sed -n 's/^package://p' | head -1 | tr -d '\r')
"$ANDROID_SDK_ROOT/platform-tools/adb" -s "$DEVICE" pull "$INSTALLED_APK" /tmp/bookstr-installed.apk
"$ANDROID_SDK_ROOT/build-tools/36.0.0/apksigner" verify --print-certs /tmp/bookstr-installed.apk \
  | grep 'SHA-256 digest'
"$ANDROID_SDK_ROOT/build-tools/36.0.0/apksigner" verify --print-certs "$APK" \
  | grep 'SHA-256 digest'
rm /tmp/bookstr-installed.apk
```

Skip the installed-certificate check if `pm path` reports no installed package.
If the digests differ, stop and locate the keystore used for the installed app;
do not uninstall it to make installation succeed. When they match, update in
place and verify the installed version and launch:

```sh
"$ANDROID_SDK_ROOT/platform-tools/adb" -s "$DEVICE" install -r "$APK"
"$ANDROID_SDK_ROOT/platform-tools/adb" -s "$DEVICE" shell dumpsys package app.bookstr \
  | grep -E 'versionCode=|versionName=|lastUpdateTime='
"$ANDROID_SDK_ROOT/platform-tools/adb" -s "$DEVICE" shell monkey -p app.bookstr 1
```
