# Bookstr iOS

This directory contains the native iOS SwiftUI port of Bookstr. The iOS app
shares the dependency-free EPUB reader assets with Android and targets feature
parity where iOS permits it.

## Structure

- `App`: app entry, DI container, top-level navigation.
- `Shared`: shared models and small utilities.
- `Data`: catalog/settings/progress/vocabulary repositories and persistence.
- `Nostr`: relay client and signer abstractions.
- `Features`: SwiftUI screens (Library, Reader, Words, Settings).
- `Tests`: protocol/data/serialization tests.

## Build

Open `BookstrIOS.xcodeproj` in Xcode. The project bundles `reader.html`, epub.js,
and JSZip directly from the Android asset directory so both apps exercise the
same EPUB implementation.

Minimum iOS version: 17.0.
