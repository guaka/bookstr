## 1. Build and shared reader foundation

- [x] 1.1 Confirm the iOS app and test bundle compile for the iOS 17 simulator SDK
- [x] 1.2 Bundle the shared reader HTML, epub.js, and JSZip assets
- [ ] 1.3 Add an iOS JavaScript bridge and open downloaded EPUB data

## 2. Reader parity

- [ ] 2.1 Restore EPUB CFI and PDF page positions
- [ ] 2.2 Match themes, progress chrome, chapters, and navigation
- [ ] 2.3 Save selected vocabulary and show dictionary results
- [ ] 2.4 Add reading aloud and keep-awake settings
- [ ] 2.5 Resolve local-versus-Nostr progress conflicts

## 3. Library and delivery parity

- [ ] 3.1 Port search and favorite mutation behavior
- [ ] 3.2 Authenticate BUD-11 Blossom downloads and verify SHA-256
- [ ] 3.3 Match Library, Words, Search, and Settings presentation

## 4. Signer and Lock Screen integration

- [ ] 4.1 Open Signstr directly with the generated `nostrconnect://` URI
- [ ] 4.2 Preserve QR and copy/share pairing fallbacks
- [ ] 4.3 Restore NIP-46 sessions and test NIP-44 favorite decryption
- [ ] 4.4 Add a Current Book Live Activity with resume deep link

## 5. Verification and delivery

- [ ] 5.1 Add unit and UI coverage for the parity contracts
- [ ] 5.2 Run tests on an installed simulator or physical device
- [ ] 5.3 Install and validate the development build on `ip2`
