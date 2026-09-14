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
test('download pane keeps search available and exposes each queued edition', () => {
  const view = read('ios/BookstrIOS/Sources/Features/Search/SearchView.swift');
  assert.doesNotMatch(view, /openingBookID/);
  assert.match(view, /DownloadsPane\(queue: container.downloads\)/);
  for (const id of ['search.downloads', 'downloads.done', 'downloads.open.', 'downloads.retry.', 'downloads.status.']) {
    assert.ok(view.includes(id));
  }
  assert.match(view, /Text\(job.result.title\)/);
  assert.match(read('ios/TorrentEngine/README.md'), /additional books queue sequentially/);
});
