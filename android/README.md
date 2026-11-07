# Android build and validation

The same APK supports phones, tablets, and Android TV / Google TV, including
Chromecast with Google TV. TV installations have a home-screen banner and do
not require a touchscreen. On TV, use the remote D-pad and Select to navigate
the library, filters, and app destinations. Readers keep Previous page, Next
page, and Library controls visible; EPUB and FB2 also provide Speech. Back
returns from an app destination to Library before leaving the app. TV text is
scaled for viewing at a distance. Opening an EPUB on TV starts narration after
the reader is ready, using the selected voice and saved position. Pause/resume
receives initial remote focus. In Settings, speech controls scroll into view;
D-pad Down moves from Language to available voice downloads and then Voice.
On TV, connect a phone signer by scanning the NIP-46 QR code with Amber and
approving Bookstr on the phone. The connection is saved for subsequent launches;
disconnect it from Settings when finished. Android phones and tablets retain
their same-device signer options.

Bookstr also offers a system screensaver showing the saved page of the current
local EPUB. Select Bookstr in the TV's system screensaver settings. It follows
persisted page positions during narration with a short delay and does not change
reading progress or start speech. Books without an available local EPUB show
the app identity instead.

TV control regression tests are in `TvControlsTest`; run them only on a
disposable emulator, never a personal Chromecast:

```sh
cd android
./gradlew --max-workers=2 connectedDebugAndroidTest createDebugAndroidTestCoverageReport \
  -Pandroid.testInstrumentationRunnerArguments.class=app.bookstr.ui.TvControlsTest
```

Android CI separates JVM unit tests with JaCoCo and the shared coverage
baseline, APK packaging, four parallel emulator shards, combined coverage, and
signed release publishing. AndroidJUnitRunner discovers the complete suite without
executing tests. The planner assigns every discovered test to exactly one shard, longest measured
test first; new tests receive a three-second default estimate. The checked-in
`android/scripts/shard-timings.json` records the source CI run for the initial
measurements. Settings download fixtures no longer use their old live-download
timings. Each shard verifies that its executed test identities exactly match its
selection; a silently ignored or incomplete filter fails the run.
Shards do not cancel one another;
each has a 20-minute execution limit and separate logs and coverage artifacts.
The required **Emulator UI tests** check waits for all four shards and merges
JVM, instrumentation, and native coverage before allowing a release. Missing
shard data or any failed shard fails that check. **Rerun failed jobs** reuses
successful shards from the same workflow run. A failed emulator setup is retried
once only if instrumentation was never launched. Once an instrumentation attempt
is made, neither assertion failures nor runner crashes are retried.
The shard job allows 45 minutes for at most two 20-minute attempts and uploads.
Failed runs include bounded logcat, a screenshot, activity state, and the last test
identifier. Every test's elapsed time is recorded in the instrumentation log and
JUnit report. Refresh timing estimates from downloaded shard logs with:

```bash
node android/scripts/ci-instrumentation.mjs timings android/e2e-results/shard-*/instrumentation.log > /tmp/shard-timings.json
```

Review the resulting measurements before replacing the checked-in timing file;
only passing tests with positive durations are included.
Pull requests and pushes to `main` that change Android code or bundled reader
assets build a debug APK. Open the matching run under
[Actions → Android CI](https://github.com/guaka/bookstr/actions/workflows/android.yml)
and download `bookstr-android-apks-<commit>` from **Artifacts**. It contains the
debug app and instrumentation APK, retained for 14 days. Each emulator shard
installs these exact APKs and runs the instrumentation runner without invoking
Gradle or compiling native code. These use the runner's debug signing key, so
they cannot replace an installed APK signed with a different key. Unit coverage,
test overviews, and emulator screenshots are published as separate artifacts.

After all Android checks pass on `main`, CI publishes a signed APK to
[GitHub Releases](https://github.com/guaka/bookstr/releases/latest). In Obtainium,
add `https://github.com/guaka/bookstr` as the app source. Each release gets a new
`0.1-YYYYMMDD-HHMM` version name and matching `v<version name>` tag. The timestamp
uses the workflow run creation time in UTC, so retries keep the same
version. If a different run already owns that minute's tag, the later run gets a
deterministic `-r<run number>` suffix. CI serializes releases while it allocates
tags, preventing same-minute runs from overwriting one another. Each release
also has a monotonically increasing Android version code (1,000,000,000 plus
the workflow run number). A retry that is older than the latest published
Android run cannot mark its release latest. Releases are not prereleases, so
Obtainium's default GitHub settings can discover them. Rerunning an already
published workflow does not replace its release or APK.

Configure these encrypted repository secrets before enabling release publishing:

- `BOOKSTR_KEYSTORE_BASE64`: base64 encoding of the existing release keystore.
- `BOOKSTR_KEYSTORE_PASSWORD`: keystore password.
- `BOOKSTR_KEY_ALIAS`: alias of the existing signing key.
- `BOOKSTR_KEY_PASSWORD`: signing key password.

Keep the original keystore backed up outside the repository, for example at
`~/.config/bookstr/android-release.jks`, with passwords in macOS Keychain.
Use the same key as the existing release to preserve in-place updates. CI fails
if a signing secret is missing; it never substitutes a generated debug key.
CI also checks the signing certificate against the published APK's SHA-256
digest before publishing. The original published APK uses this machine's
existing Android debug key; preserve that specific key for compatible updates.
The release command disables Gradle configuration caching because the existing
release-signing validation hook cannot be serialized into that cache.
Local release builds intended to update a CI installation must also supply
`-Pbookstr.versionCode=<higher code>` and `-Pbookstr.versionName=<new version>`.

Requires JDK 17+, Android SDK 35, NDK 27.2.12479018, CMake 3.22.1 and Boost
headers. On macOS, install Boost with Homebrew and export
`BOOST_ROOT=/opt/homebrew/opt/boost`. On Linux, install `libboost-dev`.
The first native build fetches the immutable libtorrent revision used by iOS.

```sh
sdkmanager 'platforms;android-35' 'build-tools;35.0.0' 'ndk;27.2.12479018' 'cmake;3.22.1'
./gradlew --max-workers=2 testDebugUnitTest jacocoDebugUnitTestReport assembleDebug
./gradlew --max-workers=2 connectedDebugAndroidTest createDebugAndroidTestCoverageReport
```

For a combined JVM and emulator report, run the prebuilt instrumentation APKs
on an emulator from the repository root and opt into a fresh coverage file:

```sh
BOOKSTR_COVERAGE_FILE=android/app/build/coverage/full.ec \
  ./android/scripts/run-connected-e2e.sh --prebuilt \
  android/prebuilt-apks/app-debug.apk android/prebuilt-apks/app-debug-androidTest.apk
(cd android && ./gradlew jacocoCombinedDebugReport)
```

Coverage collection is opt-in and requires prebuilt mode. The script clears any
previous host result at the requested path, clears old device coverage only
after emulator validation and both APK installs, then atomically writes
non-empty coverage to `BOOKSTR_COVERAGE_FILE`.
The report is at
`app/build/reports/jacoco/jacocoCombinedDebugReport/jacocoCombinedDebugReport.xml`.

### Opt-in JNI source coverage

The NDK 27.2 LLVM source-coverage path is opt-in and instruments only the
maintained `torrent_jni.cpp` translation unit; fetched libtorrent remains
uninstrumented. Build and run the debug APK and tests for the emulator's ABI
(CI uses `x86_64`):

```sh
./gradlew --max-workers=2 -Pbookstr.abis=x86_64 -Pbookstr.nativeCoverage=true assembleDebug assembleDebugAndroidTest
./gradlew --max-workers=2 -Pbookstr.abis=x86_64 -Pbookstr.nativeCoverage=true connectedDebugAndroidTest
```

Before connected tests, clear profiles from earlier runs on the disposable
emulator. This removes only Bookstr coverage `.profraw` files from the two
app-private profile directories; it refuses physical devices and does not
clear app data. Then collect the fresh profiles and report them with the
matching unstripped library and NDK tools:

```sh
./scripts/prepare-native-coverage.sh "$ANDROID_HOME/platform-tools/adb" emulator-5554 app.bookstr
./scripts/collect-native-coverage.sh "$ANDROID_HOME/platform-tools/adb" emulator-5554 app.bookstr app/build/coverage/native
NATIVE_SO="$(find app/build/intermediates/cxx/Debug -type f -name libbookstr_torrent.so -print -quit)"
./scripts/native-coverage.mjs \
  --profile-dir app/build/coverage/native/raw \
  --object "$NATIVE_SO" \
  --ndk-bin "$ANDROID_HOME/ndk/27.2.12479018/toolchains/llvm/prebuilt/HOST_TAG/bin" \
  --compiled-source-dir "$(realpath app/src/main/cpp)" \
  --repo-root "$(cd .. && pwd)" \
  --output-dir app/build/reports/native-coverage
```

Replace `HOST_TAG` with the NDK host directory (`darwin-x86_64` or
`linux-x86_64`). The report command always writes HTML, a text summary, and
`native-coverage.json` with measured line and branch percentages. Add
`--require-complete true` to enforce 100% executable-line and branch coverage
after those reports are written. Continuous `%c` profile mode is not used;
Android runtime support for that mode has not been validated here. The
preparation and collector scripts have host-side contract tests, but profile
writing and collection still need a successful emulator run before this
workflow can be treated as validated.

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

While TTS is active, Android's media controls show the current book title and
author on the lock screen. The current spoken paragraph is secondary metadata.
Silent reading does not create a media session. On GrapheneOS, check
**Settings → Sound & vibration → Media → Show media on lock screen** if the
controls are absent even while TTS is playing.

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
