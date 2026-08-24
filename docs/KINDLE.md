# Bookstr on Kindle

Bookstr should be feasible on a jailbroken Kindle e-reader, but the existing
Android APK cannot be installed directly. Kindle e-readers run Amazon's
Linux-based Kindle OS rather than Android, and jailbreaking does not add the
Android application runtime.

## Recommended approach

Build a Kindle-specific Bookstr package as a KUAL extension, with a split of
responsibilities:

- Bookstr provides the library, downloads, optional Nostr synchronization,
  reading progress, and saved vocabulary.
- [KOReader](https://koreader.rocks/) opens and renders EPUB and PDF files.
- A small adapter launches KOReader and, where practical, exchanges reading
  progress with Bookstr.

This uses a mature e-ink reading engine instead of making the browser-based
EPUB reader handle Kindle-specific rendering, refresh behavior, memory limits,
and controls. It should also provide much better PDF support.

## Browser prototype

The quickest proof of concept is to package the dependency-free Bookstr web
client with a tiny local HTTP server and launch it from KUAL in the Kindle
browser. Alternatively, the hosted client at <https://books.guaka.org> can be
tested directly before writing any Kindle code.

Browser viability depends on the Kindle generation and firmware:

- Newer firmware uses a Chromium-based browser and is the most promising.
- Older firmware uses a limited WebKit browser and may require Bookstr's
  JavaScript to be transpiled or polyfilled.
- Recent firmware may block applications loaded with `file://`; serving the
  files from `http://127.0.0.1` avoids that restriction.
- EPUB may work through epub.js, but performance, offline storage, downloads,
  WebSockets, and e-ink interactions must be tested on real hardware.
- Browser-based PDF handling is unlikely to be as reliable as KOReader.

[WebLaunch](https://github.com/PaulFreund/WebLaunch) and other KUAL extensions
demonstrate the fullscreen/local-web-application pattern on Kindle.

## Proposed implementation phases

1. Record the exact Kindle model and firmware version and confirm that a
   compatible jailbreak is available.
2. Open the hosted Bookstr client in the built-in browser and test navigation,
   EPUB rendering, downloads, local storage, and network access.
3. Create a minimal KUAL extension that starts a local server and launches a
   Kindle-adjusted Bookstr interface.
4. Add downloading and handoff of EPUB/PDF files to KOReader.
5. Add library integration and progress exchange between Bookstr and KOReader.
6. Test optional Nostr sync, including WebSocket support and safe signer/key
   handling.
7. Tune the interface for grayscale, touch targets, page refreshes, low memory,
   sleep/resume, and offline operation.

## Information needed before development

- Kindle model and generation
- Firmware version
- Whether it is already jailbroken
- Whether KUAL and KOReader are installed
- Whether Bookstr must work completely offline
- Whether Nostr sync is required in the first version

Jailbreak support is firmware-specific and changes over time. Consult the
[current KindleModding guide](https://kindlemodding.org/jailbreaking/) rather
than following an old device-independent procedure. Jailbreaking permits
homebrew code such as KUAL extensions and KOReader; it does not make Android
APKs compatible with Kindle OS.

## Initial recommendation

Start with a KUAL prototype that downloads books and opens them in KOReader.
Treat the embedded Bookstr web reader as an experiment for newer Kindles, not
as the foundation of the first dependable Kindle release.
