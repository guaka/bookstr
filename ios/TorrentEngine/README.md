# Foreground iPhone torrents

Libcat search results without an existing ready download can now be acquired
on the phone. The app resolves the exact MD5, downloads the catalog's torrent
metadata over HTTPS, and selects only that MD5-named file from the batch,
including filenames with extensions such as `.epub` or `.fb2.zip`. The catalog
collection selects nonfiction, fiction, or comics torrents. For older records
without a collection, these are tried in order until the exact MD5 is found.
Nonfiction IDs below 1000 use the `r_000` batch.

For original Zlib releases, Libcat supplies the torrent metadata URL and numeric
book filename. The phone selects that exact file and still verifies its observed
MD5 and size before importing it. Only `pilimi-zlib-<first>-<last>.torrent`
locators within the declared ID range are accepted. Zlib2 TAR and newer AAC
releases require archive-member indexes and are not exposed through this route;
the phone does not download a bulk TAR as if it were an individual book.

The native libtorrent session runs while the app is active. Inactive/background
transitions pause the session; returning to the foreground resumes it. No audio
or other background-execution workaround is used. Partial files remain in the
app's private `Application Support/bookstr-torrents/<md5>` directory. The saved
download list and resolved editions restore unfinished transfers automatically
on app launch. Libtorrent restores resume data where available and otherwise
checks existing pieces. Completed downloads also remain in the list.

The completed file must match the catalog MD5 and declared size, then pass the
existing publication validator before it is copied into the offline library.
Downloads shows each book and its status, received bytes and peer count. Close
the pane to keep searching or reading; additional books download concurrently. Open
completed books or retry failures from the pane. The Search toolbar reopens it.
Existing Blossom downloads are unchanged.

## Build

On macOS with Xcode, CMake, and Boost headers installed:

```sh
BOOST_ROOT="$(brew --prefix boost)" scripts/build-ios-torrent.sh
```

The Xcode app target links this package through `ios/project.yml`
(`packages.TorrentEngine` + `dependencies: - package: TorrentEngine`). After
editing that file, regenerate with `xcodegen generate` from `ios/`. Never strip
the local package from `project.yml` — that is how device builds lose
`canImport(TorrentEngine)` and break torrent downloads.

The script verifies libtorrent commit
`9d7443f467147d1784fb7516d2a882db1abb5a8b` (v2.0.11), initializes its pinned
`try_signal` dependency, and builds a static XCFramework for arm64 iPhone and
arm64/x86_64 simulators. `CMAKE_BIN` can select a local CMake executable.
Generated source/build directories and binaries are ignored by Git. CI builds
the native package before running Xcode tests. Re-run the script after changing
the Objective-C++ bridge.

The build uses Apple's CommonCrypto, DHT, peer exchange, HTTP/UDP trackers and
BitTorrent peers. Torrent metadata itself uses URLSession HTTPS. HTTPS trackers
and HTTPS web seeds inside torrents are not enabled in this build, which omits
OpenSSL. Peer availability still determines whether a download can complete.

The source licenses are under `Licenses`; the app bundles their notices in
`TorrentEngineNotices.txt`.
