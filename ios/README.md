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

Open `BookstrIOS.xcodeproj` in Xcode. The project bundles the canonical mobile
reader runtime from `../shared/reader/`, so both native apps exercise the same
EPUB implementation.

Minimum iOS version: 17.0.

## CarPlay audio

The CarPlay browse scene lists only locally downloaded EPUB and FB2 books and
uses cached artwork; cover discovery does not run from the car UI. Apple must
approve the `com.apple.developer.carplay-audio` capability for this app ID
before the scene appears on a real car display. After approval and provisioning
profile regeneration, set `CODE_SIGN_ENTITLEMENTS` for the BookstrIOS target to
`BookstrIOS/CarPlayAudio.entitlements` in both `project.yml` and the Xcode
project. The entitlement is intentionally not active in the checked-in signing
settings: the current team profile rejects it and enabling it would prevent
ordinary iPhone builds.
