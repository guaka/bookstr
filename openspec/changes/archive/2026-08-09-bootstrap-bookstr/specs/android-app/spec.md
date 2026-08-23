## Purpose

Native Android bookstr client.

## ADDED Requirements

### Requirement: Application identity
The Android app SHALL use applicationId `app.bookstr` and minSdk 27.

### Requirement: Local progress persistence
The app SHALL persist last reading position per SHA-256 book id in Room, independent of Nostr.
