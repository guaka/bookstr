import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(new URL('../../'+path, import.meta.url),'utf8');
test('iPhone torrent bridge is built reproducibly and packaged with notices',()=>{
  const build=read('scripts/build-ios-torrent.sh');
  assert.match(build,/9d7443f467147d1784fb7516d2a882db1abb5a8b/);
  assert.match(build,/git.*rev-parse HEAD/);
  assert.match(build,/arm64;x86_64/);
  assert.match(build,/create-xcframework/);
  const ensure=read('scripts/ensure-ios-torrent.sh');
  assert.match(ensure,/TorrentEngine\.xcframework/);
  assert.match(ensure,/build-ios-torrent\.sh/);
  assert.match(ensure,/ios-arm64\/TorrentEngine\.framework\/TorrentEngine/);
  assert.match(read('scripts/repair-ios-spm.sh'), /SourcePackages/);
  assert.match(read('scripts/install-ios-ip2.sh'), /ensure-ios-torrent\.sh/);
  assert.match(read('scripts/install-ios-ip2.sh'), /repair-ios-spm\.sh/);
  // Link the XCFramework directly — a local SPM binaryTarget breaks resolution
  // whenever the gitignored framework is missing.
  const projectYml=read('ios/project.yml');
  assert.match(projectYml,/framework:\s*TorrentEngine\/TorrentEngine\.xcframework/);
  assert.doesNotMatch(projectYml,/path:\s*TorrentEngine/);
  assert.doesNotMatch(projectYml,/- package:\s*TorrentEngine/);
  assert.match(projectYml,/TorrentEngineNotices\.txt/);
  const project=read('ios/BookstrIOS.xcodeproj/project.pbxproj');
  assert.match(project,/TorrentEngineNotices.txt in Resources/);
  assert.match(project,/TorrentEngine\.xcframework in Frameworks/);
  assert.doesNotMatch(project,/XCLocalSwiftPackageReference "TorrentEngine"/);
  assert.doesNotMatch(project,/productName = TorrentEngine/);
  assert.match(read('ios/TorrentEngine/README.md'), /framework: TorrentEngine\/TorrentEngine\.xcframework/);
  assert.match(read('ios/TorrentEngine/Package.swift'), /Do not re-add this as an SPM local package/);
  assert.match(read('ios/BookstrIOS/TorrentEngineNotices.txt'),/Boost Software License/);
  assert.match(read('.github/workflows/ios.yml'),/scripts\/ensure-ios-torrent\.sh/);
});
test('phone opening resolves and imports only verified torrent editions',()=>{
  const code=read('ios/BookstrIOS/Sources/Data/CatalogRepository.swift');
  assert.doesNotMatch(code,/CatalogSearchPage\.publication|response\["blossom"\]/);
  assert.match(code,/guard let record = response\["book"\]/);
  assert.match(code,/TorrentEdition\(record: record, expectedMD5: md5\)/);
  assert.match(code,/ForegroundTorrentDownloader.shared.download/);
  assert.match(code,/isValidCachedFile\(book: corrected, fileURL: staging/);
  assert.match(read('ios/BookstrIOS/Sources/App/BookstrIOSApp.swift'),/setActive\(phase == .active\)/);
  assert.match(read('ios/BookstrIOS/UITests/AppShellUITests.swift'),/testTorrentSearchOpensAndReopensOfflinePublication/);
});
test('download pane keeps search available and exposes each selected edition', () => {
  const view = read('ios/BookstrIOS/Sources/Features/Search/SearchView.swift');
  assert.doesNotMatch(view, /openingBookID/);
  assert.match(view, /DownloadsPane\(queue: container.downloads\)/);
  for (const id of ['search.downloads', 'downloads.done', 'downloads.open.', 'downloads.retry.', 'downloads.status.', 'downloads.dismiss.']) {
    assert.ok(view.includes(id));
  }
  assert.match(view, /Text\(job.result.title\)/);
  assert.match(view, /queue\.pruneCompleted\(\)/);
  assert.match(view, /queue\.dismiss\(job\.id\)/);
  assert.match(read('ios/TorrentEngine/README.md'), /additional books download concurrently/);
});

test('completed downloads leave the queue after a day and can be dismissed sooner', () => {
  const code = read('ios/BookstrIOS/Sources/Data/TorrentDownload.swift');
  assert.match(code, /completedRetention/);
  assert.match(code, /24 \* 60 \* 60/);
  assert.match(code, /completedAt/);
  assert.match(code, /func pruneCompleted/);
  assert.match(code, /func dismiss\(_ id: String\)/);
  assert.match(code, /isDismissible/);
  const tests = read('ios/BookstrIOS/Tests/TorrentDownloadTests.swift');
  assert.match(tests, /testCompletedDownloadsPruneAfterRetentionAndCanBeDismissed/);
});

test('catalog collection and filename extensions are covered by real-engine tests', () => {
  const tests = read('ios/BookstrIOS/Tests/TorrentDownloadTests.swift');
  assert.match(tests, /testNativeHashFilenamesWithExtensionsAndAmbiguity/);
  assert.match(tests, /testMissingCollectionRetriesExactEditionAndReplacesWrongCache/);
  assert.match(read('ios/TorrentEngine/README.md'), /r_000/);
  assert.match(read('ios/BookstrIOS/Sources/App/LibraryUITestFixtures.swift'), /"authors": "Fixture Author", "collection": "fiction"/);
});

test('Zlib numeric-file acquisition retains verification and offline-reader coverage', () => {
  const download = read('ios/BookstrIOS/Sources/Data/TorrentDownload.swift');
  assert.match(download, /filename: edition.selectedFilename/);
  assert.match(download, /try Self.verify\(file, edition: edition\)/);
  assert.match(download, /managed_by_aa\/zlib\//);
  const tests = read('ios/BookstrIOS/Tests/TorrentDownloadTests.swift');
  assert.match(tests, /testNativeZlibDownloadVerifiesPayloadAndResumesCachedMetadata/);
  assert.match(tests, /testNativeZlibSelectsExactIDAndRejectsUnsafeOrAmbiguousNames/);
  assert.match(read('ios/BookstrIOS/UITests/AppShellUITests.swift'), /testZlibSearchDownloadsAndReopensOfflinePublication/);
  assert.match(read('ios/TorrentEngine/README.md'), /Zlib2 TAR and newer AAC/);
});

test('downloads persist independently and native search keeps its safe area', () => {
  const app = read('ios/BookstrIOS/Sources/App/BookstrIOSApp.swift');
  assert.match(app, /downloads.resume\(prepare:/);
  assert.doesNotMatch(app, /TopSafeAreaCollapser/);
  assert.doesNotMatch(read('ios/BookstrIOS/Sources/Shared/ScreenChrome.swift'), /additionalSafeAreaInsets.top/);
  const code = read('ios/BookstrIOS/Sources/Data/TorrentDownload.swift');
  assert.match(code, /engines\[edition.md5\]/);
  assert.match(code, /options: .atomic/);
  assert.doesNotMatch(code, /"Queued"/);
  assert.match(read('ios/BookstrIOS/Sources/Data/CatalogRepository.swift'), /torrent-edition-/);
});

test('custom clock and battery replace the system status bar on every pane', () => {
  const info = read('ios/BookstrIOS/Info.plist');
  assert.match(info, /<key>UIStatusBarHidden<\/key>\s*<true\/>/);
  assert.match(read('ios/project.yml'), /UIStatusBarHidden:\s*true/);
  const app = read('ios/BookstrIOS/Sources/App/BookstrIOSApp.swift');
  assert.match(app, /statusBarHidden\(true\)/);
  assert.match(app, /persistentSystemOverlays\(\.hidden\)/);
  const root = read('ios/BookstrIOS/Sources/App/RootView.swift');
  assert.match(root, /ReaderClockLabel\(\)/);
  assert.match(root, /presentLocalIfAvailable/);
  assert.match(root, /Task \{ _ = await container\.nostrSyncService\.retryPendingFavorites\(\) \}/);
  assert.doesNotMatch(
    root,
    /_ = await container\.nostrSyncService\.retryPendingFavorites\(\)\s*guard !attemptedInitialContinuation/
  );
  const chrome = read('ios/BookstrIOS/Sources/Shared/ScreenChrome.swift');
  assert.match(chrome, /isBatteryMonitoringEnabled = true/);
  const clock = read('ios/BookstrIOS/Sources/Features/Reader/ReaderHostView.swift');
  assert.match(clock, /batterySnapshot/);
  assert.match(clock, /accessibilityIdentifier\("reader-clock"\)/);
  assert.match(clock, /bolt\.fill/);
});

test('opening a book shows its title instead of technical reader stages', () => {
  const host = read('ios/BookstrIOS/Sources/Features/Reader/ReaderHostView.swift');
  assert.match(host, /static func openingMessage\(for book: CatalogBook\)/);
  assert.match(host, /ProgressView\(Self\.openingMessage\(for: book\)\)/);
  assert.doesNotMatch(host, /Opening \\\(activeFormat\.rawValue\.uppercased\(\)\)/);
  assert.doesNotMatch(host, /loadingStage \+ "…"/);
  const shared = read('shared/reader/reader.html');
  assert.match(shared, /reportReaderStartupStage\("fetching"\)/);
  assert.match(shared, /reportReaderStartupStage\("rendering"\)/);
  assert.doesNotMatch(shared, /Opening archive/);
  assert.doesNotMatch(shared, /Laying out pages/);
  assert.doesNotMatch(shared, /Decoding EPUB/);
  assert.doesNotMatch(shared, /Reading book metadata/);
});

test('library can delete local books after swipe confirmation', () => {
  const view = read('ios/BookstrIOS/Sources/Features/Library/LibraryView.swift');
  assert.match(view, /\.swipeActions\(edge: \.trailing/);
  assert.match(view, /pendingDeletion/);
  assert.match(view, /library-delete-confirm/);
  assert.match(view, /Remove from this device\?/);
  assert.match(view, /deleteFromLibrary\(book\)/);
  const model = read('ios/BookstrIOS/Sources/Features/Library/LibraryViewModel.swift');
  assert.match(model, /func deleteFromLibrary\(_ book: CatalogBook\)/);
  const catalog = read('ios/BookstrIOS/Sources/Data/CatalogRepository.swift');
  assert.match(catalog, /func removeFromLibrary\(_ book: CatalogBook\)/);
});
test('search and library share compact flexible book rows', () => {
  const chrome = read('ios/BookstrIOS/Sources/Shared/ScreenChrome.swift');
  assert.match(chrome, /Text\(title\).font\(.subheadline.weight\(.semibold\)\)/);
  assert.match(chrome, /dynamicTypeSize.isAccessibilitySize/);
  assert.match(chrome, /AnyLayout\(VStackLayout/);
  assert.match(chrome, /leading: 12, bottom: 9, trailing: 12/);
  for (const path of ['Search/SearchView.swift', 'Library/LibraryView.swift']) {
    const view = read('ios/BookstrIOS/Sources/Features/' + path);
    assert.match(view, /BookListDetails\(/);
    assert.match(view, /\.listStyle\(.plain\)/);
    assert.match(view, /\.bookstrListRow\(\)/);
  }
});
