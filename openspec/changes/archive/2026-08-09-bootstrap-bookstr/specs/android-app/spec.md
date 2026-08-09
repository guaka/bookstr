## Purpose

Native Android bookstr client.

## ADDED Requirements

### Requirement: Application identity
The Android app SHALL use applicationId `app.bookstr` and minSdk 27.

### Requirement: Library from catalog URL
The app SHALL let the user set a catalog HTTPS URL, fetch `catalog.json`, list books, and open the immersive reader after download/verify.

### Requirement: Local progress persistence
The app SHALL persist last reading position per SHA-256 book id in Room, independent of Nostr.
