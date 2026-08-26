<p align="center">
  <img src="./brand/bookstr-logo.svg" width="490" alt="Bookstr" />
</p>

**A calm, open-source EPUB and PDF reader for the web, Android, and iOS.**

[Read on the web](https://books.guaka.org) · [Download the Android APK](https://github.com/guaka/bookstr/releases/latest) · [View the source](https://github.com/guaka/bookstr)

> [!IMPORTANT]
> 1. Bookstr is early-stage software and is approaching its first broadly usable release. Expect rough edges, incomplete platform parity, and occasional data-format changes. Keep copies of books you care about.

> 2. Bookstr SHOULD use established, demonstrably adopted Nostr representations for interoperable data.  Bookstr-specific events MAY provide enrichment, moderation or missing capabilities, but should not obscure canonical user-authored data or duplicate registered ecosystem formats without a documented need.


## Reading without the noise

Bookstr is built around the book rather than the storefront. Open an EPUB or PDF, pick a comfortable theme, and keep reading without accounts, recommendations, or attention-grabbing chrome.

Your library and reading state work locally. If you want the same favorites, progress, and saved words on several devices, you can opt into Nostr sync without making Bookstr the owner of your identity or data.

## Highlights

- **EPUB and PDF reading** with focused, responsive reader interfaces.
- **A personal library** for books in progress, favorites, and search.
- **Reading tools** including themes, progress tracking, text-to-speech, dictionary lookup, and saved vocabulary.
- **Local-first behavior** so a relay, signer, or service outage does not prevent you from reading cached books.
- **Optional Nostr sync** for progress, private favorites shared with LibVault, and encrypted vocabulary.
- **Content-addressed delivery** with SHA-256 verification and optional Blossom mirrors.
- **Android lock-screen reading** for continuing above the active keyguard without dismissing it.
- **AGPL-licensed source** with native Android and iOS apps plus a dependency-free web client.

Feature details vary by platform while Bookstr moves toward parity.

## Try Bookstr

| Platform | Status | Start here |
| --- | --- | --- |
| Web | Live early preview; no installation required | [Open books.guaka.org](https://books.guaka.org) |
| Android | Early-access APK for Android 8.1 and newer | [Download the latest APK](https://github.com/guaka/bookstr/releases/latest) |
| iPhone and iPad | Native SwiftUI app available from source; no App Store or TestFlight release yet | [Build the iOS app](./ios/README.md) |

### Install on Android

1. Download the APK on your Android device.
2. If prompted, allow your browser or file manager to install apps from this source.
3. Open the downloaded file and choose **Install**.

The early-access APK is distributed through GitHub Releases and does not update automatically. Android's “unknown app” warning is expected for an app installed outside an app store.

## How the pieces fit together

Bookstr can work on its own or with content delivery and sync services:

- **Blossom** distributes EPUB and PDF blobs from one or more servers.
- **Bookstr** downloads, verifies, caches, and reads those files.
- **Nostr** optionally carries portable reading progress, favorites, and vocabulary.

Nostr is never required for reading. Bookstr prefers external signers—NIP-07 in the browser, Amber or another NIP-55 signer on Android, and NIP-46 on iOS—so private keys can remain outside the app. A locally stored `nsec` is available only as an advanced fallback. See [NOSTR.md](./NOSTR.md) for the implemented event formats and privacy model.

## Visual identity

Bookstr uses one identity across the web, Android, iOS, social profiles, and
print: a book-shaped lightning mark paired with a calm editorial wordmark. The
interface is built on deep sage (`#2F5D50`), paper (`#F7F3EA`), warm white
(`#FFFAF2`), ink (`#1C1916`), and muted stone (`#6B635A`). Terracotta
(`#C74B32`) supplies restrained accents, while warm gold (`#E7C766`) is
reserved for highlighted words and bookmark cues.

Use **Bookstr** in prose and store listings; the lowercase **bookstr** treatment
belongs to the logo. Reusable vector assets live in [`brand/`](./brand/).

Blossom access controls are not DRM. An authorized reader receives the original bytes and can redistribute them. Anyone hosting books remains responsible for retention, file-size, acceptable-use, and copyright policies.

## Develop Bookstr

The repository contains three clients that share formats and reader behavior:

- `web/` — a static HTML, CSS, and JavaScript app with no build step or runtime backend.
- `android/` — a native Kotlin and Jetpack Compose app using a bundled epub.js reader and Android's PDF renderer.
- `ios/` — a native SwiftUI app using the shared epub.js assets and PDFKit.
- `worker/` — the optional Books API and dictionary proxy for the hosted web client.
- `openspec/` — specifications and change tracking.

### Web

```bash
./webdev.sh
```

The development server opens Bookstr at `http://localhost:11111`. Run the dependency-free regression tests with:

```bash
node --test web/tests/*.test.mjs scripts/*.test.mjs
```

For coverage reports, run the same tests with coverage collection:

```bash
npx -y c8 --report-dir web/coverage/web-tests --reporter=html --reporter=lcov --reporter=text -- node --test web/tests/*.test.mjs
```

GitHub Actions uploads `web/coverage/web-tests/` as an artifact on every CI run, including:

- `coverage-final.json` and LCOV payload
- browsable HTML report
- plain summary output

The latest Web, Android, Android UI, and iOS results are combined automatically
into the public [test overview](https://books.guaka.org/tests/). Each suite links
back to the GitHub Actions run that produced its test and coverage figures.

### Android

The Android project targets SDK 35, supports API 27 and newer, and requires a JDK plus the Android SDK. On a fresh Linux build host, `scripts/bootstrap-android-toolchain.sh` can install the expected toolchain.

```bash
cd android
./gradlew testDebugUnitTest
./gradlew assembleDebug
./gradlew connectedDebugAndroidTest  # requires a device or emulator
```

### iOS

The native iOS app targets iOS 17. Open `ios/BookstrIOS.xcodeproj` in Xcode, select the `BookstrIOS` scheme, and run it on a simulator or device. See the [iOS README](./ios/README.md) for its structure and shared assets.

## Project status

Bookstr is being actively shaped into a reliable everyday reader. The web client is available now, the Android app is distributed as an early APK, and the iOS app can be built from source. Bug reports and focused contributions are welcome through [GitHub Issues](https://github.com/guaka/bookstr/issues).

## License

Bookstr is free software licensed under the [GNU Affero General Public License v3.0](./LICENSE).
