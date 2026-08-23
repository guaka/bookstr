## Purpose

Native Android bookstr client.

## ADDED Requirements

### Requirement: Application identity
The Android app SHALL use applicationId `app.bookstr` and minSdk 27.

### Requirement: Timestamped APK version
The Android APK version name SHALL use the format `0.0.3-yyyyMMdd-HHmm`, with a compact 24-hour timestamp. Packaged APKs SHALL use the filename `bookstr-<versionName>.apk`. The Android version code SHALL be monotonically derived from the same timestamp so that a newer APK can upgrade an older installation.

#### Scenario: Build a newer APK
- **GIVEN** an APK is built from newer packaged application sources
- **WHEN** its version metadata and release filename are generated
- **THEN** both expose the `0.0.3-yyyyMMdd-HHmm` version and its version code is greater than the prior build

### Requirement: Library from catalog URL
The app SHALL let the user set a catalog HTTPS URL, fetch `catalog.json`, list books, and open the immersive reader after download/verify.

### Requirement: Local progress persistence
The app SHALL persist last reading position per SHA-256 book id in Room, independent of Nostr.

### Requirement: EPUB read aloud
The EPUB reader SHALL offer a read-aloud control backed by the device's selected Android text-to-speech engine. Alternative engines such as offline neural TTS SHALL remain optional external installations and SHALL NOT be bundled into Bookstr. Reading SHALL begin at the currently visible text, automatically select the language declared by the EPUB, use the highest-quality installed matching voice, use a natural reading pace, and provide a control to stop speech. Bookstr SHALL submit short sentence-sized utterances with bounded look-ahead so buffered neural engines begin promptly, and SHALL insert a brief audible pause between utterances for natural phrasing. Generic Portuguese `pt` metadata SHALL default to European Portuguese `pt-PT`, while explicit regional tags such as `pt-BR` and `pt-PT` SHALL be preserved so a matching installed regional voice can be used. While read-aloud is active or preparing, the hardware volume keys SHALL adjust audio volume rather than navigate pages. The currently narrated text block SHALL be visibly highlighted and scrolled into view, and narration progress SHALL update the persisted EPUB reading position.
