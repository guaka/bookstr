# Electron and iPhone: search, download, read

Proposed implementation plan, 12 September 2026. Product target: search the
connected book catalogs, obtain an available edition, read comfortably offline,
and continue on the other device. Electron and native iPhone are equal release
targets. This plan does not claim that the installed builds have been tested.

## Baseline and scope

Reviewed against Bookstr main at `b8110c8`:

- [Web search](../web/index.html), also used by Electron, fans out to enabled
  public providers and custom OPDS feeds. It merges arriving results and caps
  them at 200. LibVault records also have a desktop acquisition path; do not
  assume the public search registry itself includes the private catalog.
- [iOS catalog repository](../ios/BookstrIOS/Sources/Data/CatalogRepository.swift)
  uses a single `/search` endpoint, defaults to 20 results, and exposes no page
  cursor. Downloads use an ephemeral session. The
  [search screen](../ios/BookstrIOS/Sources/Features/Search/SearchView.swift)
  downloads a readable selection before opening it.
- [Electron](../desktop/README.md) already checks local files and can resolve
  and acquire an individual LibVault record through its repository torrent.
  Extend and verify that path instead of implementing another torrent engine.
- Reader, favorites, progress, and verified-download implementations exist.
  The old [iOS parity checklist](../openspec/changes/align-ios-with-android-apk/tasks.md)
  is not sufficient evidence that a feature is absent.
- [Device transfer](DEVICE_TRANSFER.md) defines private discovery and file
  handoff; the [infrastructure roadmap](ROADMAP.md) still lists mobile bridge
  work. A protocol contract is not proof of working iPhone file transfer.

“All books” means records in enabled public catalogs, the connected private
LibVault catalog, and the user's local library. It does not promise a complete
worldwide catalog or a downloadable file for every record. Keep metadata-only,
borrow, buy, and preview acquisitions discoverable without treating them as
direct downloads. Inside-book search is separate and covers indexed files only.

Keep the existing native shells and static web runtime. Reuse the
[provider contract](../shared/catalog/provider-contract.md), publication IDs,
file hashes, and [progress contract](../shared/contracts/reading-progress-v2.md).
Retain source-specific access rules; never publish a private library by default.

## Delivery sequence

### 0. Establish the device baseline

Record the installed Electron/iPhone versions and run one public EPUB, one
personal-library EPUB, and one PDF through search, download, reopen, and resume.
Record each failure with the exact build and reproduction. Reconcile outdated
checklists only where source and tests substantiate the updated status.

Exit: a reproducible gap list, fixture books, and build/install steps for both
targets. Do not mark physical-device checks complete from simulator results.

### 1. Search coverage and navigation

Define a paginated search result contract: records, provider-specific cursors,
source completion/errors, and a query identity. Use it from the desktop web UI
and the native iOS repository. Public adapters can remain client-side; private
LibVault access retains its existing authorization. Avoid a mandatory new
aggregation service in this first slice.

- Include enabled public sources, private catalog access when connected, and
  local library results in one search experience on each client.
- Search by title, author, and ISBN; add language, format, and downloadable
  filters using compact native controls and existing feedback surfaces.
- Load further pages rather than silently truncating the searchable catalog.
  For providers without pagination, retain their limits explicitly in the
  internal source state and do not invent totals or continuation cursors.
- Rank exact ISBN and title matches before weaker matches. Use stable ordering
  independent of provider response timing. Cancel or ignore superseded queries.
- Deduplicate identical provider records/files first. Group editions only with
  sufficient identity evidence; never collapse translations or revisions from
  title similarity alone. Preserve the user's edition/format choice.
- Show successful results when another source fails; retries must not duplicate
  rows or reset the user's place in the results.

Exit: a fixture result beyond the first 20 and beyond the first 200 is reachable;
both clients find matching editions from the same enabled sources; delayed,
failed, and superseded responses do not corrupt results. Local search works
offline. Unit/contract tests cover pagination, ordering, normalization, identity,
and partial failure; UI tests cover filters, further pages, and opening a result.

### 2. Reliable acquisition and an offline library

Separate save-for-later, download-on-this-device, and open actions. Prefer EPUB
when suitable, preserve explicit format choices, and keep PDF available for
fixed-layout material. Keep non-downloadable records inspectable.

- Connect source acquisitions to Electron's existing acquisition manager and
  local store. Preserve its selected-file torrent behavior and fallback logic.
- Give iOS a persisted queue and background URLSession integration, with visible
  progress, cancellation, retry, and recovery after ordinary app suspension.
  Test force-quit separately and document actual recovery behavior; do not
  promise that downloads continue after a user force-quits the app.
- Persist acquisition identity and state: queued, downloading, verifying,
  ready, failed, or cancelled. A partial file never appears as ready.
- Validate format and size, compute a content hash, and compare a trusted
  expected checksum when supplied. Computing a new hash alone does not prove
  authenticity. Preserve stricter existing transport verification contracts.
- Distinguish removing a device copy from removing a saved book. Pin deliberate
  offline downloads against automatic eviction and provide storage management.

Exit: interruption and relaunch recover or offer a useful retry; corrupt files
never open; deleting a local copy leaves saved metadata and progress intact;
downloaded EPUB/PDF files open in airplane mode. Test both queue transitions and
complete UI flows, including low storage and unavailable origins.

### 3. Comfortable reading on both screens

Audit existing features before adding replacements. Make Library and Search the
primary destinations, with Continue reading prominent and downloads accessible.
Use existing icons, menus, and feedback rather than new explanatory UI copy.

- Verify EPUB typography, font size, line spacing, margins, theme, chapters,
  in-book search, and bookmarks. Preserve reading position across layout changes.
- Verify PDF fit-width, zoom, page navigation, and page restoration; do not
  promise EPUB-like reflow for scanned PDFs.
- Check desktop keyboard navigation and resizing; check iPhone safe areas,
  orientation, touch targets, VoiceOver, and text sizing.
- Save position on navigation and lifecycle changes. Relaunch directly into
  the correct book and location. Preserve existing FB2/comic behavior.

Exit: a 30-minute reading session on each physical target has no lost position,
clipped controls, or unintended navigation. Automated reader tests cover layout
changes, chapters, search, bookmarks, relaunch, and accessibility identifiers.

### 4. Continue across devices

Reuse optional Nostr identity, favorites, and progress sync. Associate locations
with the actual edition; an EPUB CFI cannot safely migrate to another file just
because its title matches. Keep current location separate from furthest progress
so intentionally rereading an earlier chapter remains possible.

First retrieve the same edition from an available authorized HTTPS/Blossom
source on the receiving device. Sync must tolerate offline changes, duplicate
events, and older events arriving late. Define deterministic conflict behavior
and test it on both clients before shipping.

For desktop-only files, complete the documented private mobile transfer bridge
as a separate follow-up. Validate Electron-to-iPhone transfer, network changes,
authorization/revocation, and receiver verification on real devices. If the
desktop is offline, retain the saved book and offer a retry rather than claiming
the file is downloaded. Do not make private transfer a prerequisite for reading
books independently available on both devices.

Exit: read an EPUB on desktop, download the same edition on iPhone, resume at the
same passage, read offline, and sync back without jumping to stale progress.
Repeat for a PDF page. Local-only transfer has its own explicit release gate.

## Pull requests and release gates

Use separate reviewable PRs in this order: baseline/documentation; search contract
and fixtures; Electron search; iPhone search; desktop acquisition integration;
iPhone download queue; reader fixes per platform; progress/device handoff; then
private local-file transfer. Split further where a change becomes hard to review.
Search clients depend on the shared contract; acquisition depends on stable
edition identity; handoff depends on verified local persistence and restoration.

The first useful release includes stages 1–3 and stage 4 for independently
retrievable editions. It must pass search → edition selection → download →
offline reading → cross-device resume on Electron and the user's iPhone.
Desktop-only file transfer is the next milestone, not silently omitted from
the overall goal.

Every executable change requires behavior tests and changed-line coverage under
AGENTS.md. Navigation and reader changes require end-to-end tests with stable
accessibility identifiers. Use hermetic small book fixtures in CI and a separate
real-device smoke checklist. Record first-result latency, download recovery,
offline-open success, and location restoration on the baseline hardware; set
performance thresholds from those measurements rather than invented timings.

No production deployment is needed to approve this plan. Any later LibVault API
work belongs in its own repository PR and follows its deployment/data-preservation
rules. Defer additional social features, public seeding UI, audio catalogs, and
new transfer engines until the reading milestones pass.
