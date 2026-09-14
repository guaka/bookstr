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
  const project=read('ios/BookstrIOS.xcodeproj/project.pbxproj');
  assert.match(project,/TorrentEngineNotices.txt in Resources/);
  assert.match(project,/productName = TorrentEngine/);
  assert.match(read('ios/BookstrIOS/TorrentEngineNotices.txt'),/Boost Software License/);
  assert.match(read('.github/workflows/ios.yml'),/scripts\/build-ios-torrent.sh/);
});
test('phone opening preserves ready Blossom downloads and imports only verified torrent editions',()=>{
  const code=read('ios/BookstrIOS/Sources/Data/CatalogRepository.swift');
  assert.match(code,/if let published = try\? CatalogSearchPage.publication/);
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
  for (const id of ['search.downloads', 'downloads.done', 'downloads.open.', 'downloads.retry.', 'downloads.status.']) {
    assert.ok(view.includes(id));
  }
  assert.match(view, /Text\(job.result.title\)/);
  assert.match(read('ios/TorrentEngine/README.md'), /additional books download concurrently/);
});

test('catalog collection and filename extensions are covered by real-engine tests', () => {
  const tests = read('ios/BookstrIOS/Tests/TorrentDownloadTests.swift');
  assert.match(tests, /testNativeHashFilenamesWithExtensionsAndAmbiguity/);
  assert.match(tests, /testMissingCollectionRetriesExactEditionAndReplacesWrongCache/);
  assert.match(read('ios/TorrentEngine/README.md'), /r_000/);
  assert.match(read('ios/BookstrIOS/Sources/App/LibraryUITestFixtures.swift'), /"authors": "Fixture Author", "collection": "fiction"/);
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
