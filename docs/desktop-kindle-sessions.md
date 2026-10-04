# Electron Kindle transfer sessions

## Behavior

- USB discovery is passive. Background polling does not open an MTP session,
  inspect device files, or convert comics.
- The Kindle offer opens a book selector. Filter the downloaded books and select
  only the books to transfer. Selection survives changes to the filter.
- The main process validates selected download IDs. Duplicate content is checked
  using SHA-256, and existing device filenames are never overwritten.
- On macOS and Linux, one native process keeps the MTP session open through the
  duplicate check, copy, and read-back verification. Closing a session between
  these operations made the observed Kindle Scribe leave USB mode.
- Conversion, checking, copying, and verification are reported separately.
- Comic conversion is sequential. Limits are 512 MiB per archive, 2,500 pages,
  24 MiB per page, 512 MiB total image input, and 30 million pixels per image.
  JPEG, PNG, GIF first frames, and BMP are supported. GIF/BMP conversion uses
  packaged JavaScript codecs on each desktop platform.
- A ZIP disguised as an image can contain additional pages. Only one nesting
  level is allowed; page count, total bytes, encryption and path checks still
  apply. Archive paths are never unpacked into the filesystem.

## Native protocol

`kindle-mtp session <device-id>` opens a single device. It emits a JSON ready
message including available storage bytes, then accepts tab-delimited `files`,
`put <source> <name>` and `get <object-id> <destination>` lines on stdin. Newlines,
tabs and NULs in command arguments are rejected by Electron. EOF releases the
device. Each response ends with a completion or error record; progress records
do not complete a command. A failed enumeration must not be mistaken for an
empty device.

## Validation and remaining work

The 2026-10-04 hardware investigation used Electron's selected-book IPC and a
task-scoped persistent-session adapter on an Apple Silicon Mac with a Kindle
Scribe 32 GB. Transfer results were checked by downloading each copied PDF and
comparing SHA-256 hashes. The temporary adapter and local transfer manifests are
not repository dependencies.

All 24 selected files completed and passed read-back verification: 16 Naruto
files and 8 Jujutsu Kaisen volumes, totaling 3.24 GiB of PDFs. No other local book
IDs were eligible in that session. Existing device files were not overwritten or
deleted. The task adapter observed 6.9 GiB free before the final 14-book batch.
Sampled Electron main-process RSS was approximately 150–420 MiB and the native
MTP helper approximately 7 MiB; these are samples, not a measured process-tree
peak.

This source integration is a draft, pending automated adapter/converter tests,
changed-line coverage, and one-worker Electron selection/progress UI tests. The
new packaged app has not been built or installed; the user requested that build
for later. Linux/macOS packaging and Windows Portable Devices hardware checks
remain. Windows currently retains its existing PowerShell transport; persistent
WPD sessions need separate validation.

Before marking the PR ready, run the applicable `.github/workflows/ci.yml`
commands, including generated-file checks, web tests/coverage, Electron unit
coverage and focused UI tests. Use one Electron process and one Playwright worker
at a time, bound the Node heap, and inspect RSS before native builds. Do not clear
personal Android app data for any transfer checks.
