## High-level design

1. **Secure desktop shell and protocol**
   - Keep `nodeIntegration` disabled and context isolation enabled.
   - Use a custom `app://bookstr` protocol to serve `web/` assets.
   - Block renderer navigation that is not local protocol and route external URLs
     through `shell.openExternal`.

2. **Reader windows with bridge callbacks**
   - Main window uses `web/index.html`.
   - `openReader` opens a reader window for `epub` (`reader.html`) or `pdf`
     (`pdf-reader.html`) and passes a base64 payload through a preload bridge.
   - Same book identity focuses existing reader window instead of opening duplicates.
   - EPUB and PDF reader windows expose operating-system read-aloud controls when
     Chromium provides the Web Speech API. Browser readers do not expose them.
   - Both readers consume the shared speech plan, including exact chunk offsets,
     language normalization, and paragraph-aware pauses. PDF pages act as
     paragraph boundaries.

3. **Desktop bridge contract**
   - `window.bookstrDesktop.openReader(payload)` for creating reader windows.
   - `window.bookstrDesktop.onOpenReader(handler)` in reader pages to receive
     payloads.
   - `window.bookstrDesktop.reportProgress(payload)` from readers to main process.
   - `window.bookstrDesktop.onProgress(handler)` in the library window for live
     sync between all windows.

4. **Nostr facade compatibility**
   - Expose `window.nostr` with `getPublicKey`, `signEvent`, and NIP-44 methods.
   - Keep a local encrypted-secret fallback path for native desktop signing in a
     future phase.

5. **Read-aloud lifecycle**
   - Speak one chunk at a time and schedule each chunk's pre-delay locally; the
     desktop bridge requires no new IPC.
   - Pause and resume both active system speech and pending inter-chunk delays.
   - Cancel utterances, timers, and stale callbacks on stop, navigation, reader
     replacement, and window teardown.
