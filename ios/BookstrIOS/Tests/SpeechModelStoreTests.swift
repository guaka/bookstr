import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class SpeechModelStoreTests: XCTestCase {
    private var root: URL!

    override func setUp() {
        super.setUp()
        root = FileManager.default.temporaryDirectory.appendingPathComponent("bookstr-speech-\(UUID().uuidString)")
        SpeechModelCatalog.rootDirectoryOverride = root
        SpeechModelCatalog.modelsOverride = [
            SpeechModelSpec(
                id: .kokoroEnglish,
                repository: "example/kokoro",
                revision: "abc",
                files: [.init(path: "tokens.txt", expectedBytes: 4)],
                kind: .kokoro(model: "tokens.txt", voices: "tokens.txt", speaker: 0)
            )
        ]
    }

    override func tearDown() {
        SpeechModelCatalog.modelsOverride = nil
        SpeechModelCatalog.rootDirectoryOverride = nil
        try? FileManager.default.removeItem(at: root)
        super.tearDown()
    }

    func testCatalogBundledModelsAndSourceURLs() throws {
        SpeechModelCatalog.modelsOverride = nil
        XCTAssertEqual(SpeechModelCatalog.bundledModels.count, 2)
        let kokoro = try XCTUnwrap(SpeechModelCatalog.model(.kokoroEnglish))
        let tugao = try XCTUnwrap(SpeechModelCatalog.model(.portuguesePortugal))
        XCTAssertEqual(kokoro.files.count, 11)
        XCTAssertEqual(tugao.files.count, 9)
        XCTAssertEqual(kokoro.approximateBytes, 352_148_969)
        XCTAssertEqual(tugao.approximateBytes, 63_939_446)
        XCTAssertNil(SpeechModelCatalog.model(.system))
        let url = SpeechModelCatalog.sourceURL(
            repository: "csukuangfj/vits-piper-pt_PT-tugao-medium",
            revision: "rev",
            path: "espeak-ng-data/lang/roa/pt"
        )
        XCTAssertEqual(
            url?.absoluteString,
            "https://huggingface.co/csukuangfj/vits-piper-pt_PT-tugao-medium/resolve/rev/espeak-ng-data/lang/roa/pt"
        )
    }

    @MainActor
    func testInstallRejectsWrongSizeThenSucceedsAndRemoveClearsFiles() async {
        let store = SpeechModelStore(downloader: FixtureSpeechDownloader(payload: Data("no".utf8)))
        XCTAssertFalse(store.isInstalled(.kokoroEnglish))
        XCTAssertTrue(store.isInstalled(.system))
        await store.install(.system)
        XCTAssertNil(store.installing)
        XCTAssertNil(store.errorMessage)
        await store.install(.kokoroEnglish)
        XCTAssertEqual(store.lastErrorEngine, .kokoroEnglish)
        XCTAssertNotNil(store.errorMessage)
        XCTAssertFalse(store.isInstalled(.kokoroEnglish))

        let success = SpeechModelStore(downloader: FixtureSpeechDownloader(payload: Data("abcd".utf8)))
        await success.install(.kokoroEnglish)
        XCTAssertNil(success.errorMessage)
        XCTAssertTrue(success.isInstalled(.kokoroEnglish))
        XCTAssertEqual(success.completedFiles, 1)
        await success.install(.kokoroEnglish)
        XCTAssertTrue(success.isInstalled(.kokoroEnglish))

        success.remove(.system)
        success.remove(.kokoroEnglish)
        success.remove(.kokoroEnglish)
        XCTAssertFalse(success.isInstalled(.kokoroEnglish))
        XCTAssertNil(success.errorMessage)
        _ = URLSessionSpeechDownloader()
    }

    @MainActor
    func testInstallRecordsHTTPFailure() async {
        let store = SpeechModelStore(downloader: FixtureSpeechDownloader(payload: Data("abcd".utf8), status: 404))
        await store.install(.kokoroEnglish)
        XCTAssertEqual(store.lastErrorEngine, .kokoroEnglish)
        XCTAssertNotNil(store.errorMessage)
        XCTAssertFalse(store.isInstalled(.kokoroEnglish))
    }
}

private struct FixtureSpeechDownloader: SpeechFileDownloading {
    let payload: Data
    var status: Int = 200

    func download(from url: URL) async throws -> (URL, URLResponse) {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try payload.write(to: file)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
        return (file, response)
    }
}
