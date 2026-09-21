import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class SpeechModelStoreTests: XCTestCase {
    private final class MockURLProtocol: URLProtocol {
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data("data".utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }

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
        XCTAssertEqual(SpeechModelCatalog.bundledModels.count, 9)
        let kokoro = try XCTUnwrap(SpeechModelCatalog.model(.kokoroEnglish))
        let tugao = try XCTUnwrap(SpeechModelCatalog.model(.portuguesePortugal))
        let miro = try XCTUnwrap(SpeechModelCatalog.model(.portuguesePortugalMiro))
        let dii = try XCTUnwrap(SpeechModelCatalog.model(.portuguesePortugalDii))
        let french = try XCTUnwrap(SpeechModelCatalog.model(.frenchMiro))
        let german = try XCTUnwrap(SpeechModelCatalog.model(.germanMiro))
        let spanish = try XCTUnwrap(SpeechModelCatalog.model(.spanishMiro))
        let catalan = try XCTUnwrap(SpeechModelCatalog.model(.catalanOna))
        let dutch = try XCTUnwrap(SpeechModelCatalog.model(.dutchDii))
        XCTAssertEqual(dutch.repository, "csukuangfj/vits-piper-nl_NL-dii-high")
        XCTAssertEqual(dutch.revision, "12169a38e0f40f3ffc429273346f6d0700387cdf")
        XCTAssertEqual(dutch.kind, .vits(model: "nl_NL-dii-high.onnx"))
        XCTAssertEqual(dutch.files.count, 22)
        XCTAssertTrue(dutch.files.contains(.init(path: "espeak-ng-data/nl_dict", expectedBytes: 65_979)))
        XCTAssertTrue(dutch.files.contains(.init(path: "espeak-ng-data/lang/gmw/nl", expectedBytes: 23)))
        XCTAssertEqual(kokoro.files.count, 23)
        XCTAssertEqual(tugao.files.count, 22)
        XCTAssertEqual(miro.files.count, 22)
        XCTAssertEqual(dii.files.count, 22)
        XCTAssertEqual(french.files.count, 22)
        XCTAssertEqual(german.files.count, 22)
        XCTAssertEqual(spanish.files.count, 22)
        XCTAssertEqual(catalan.files.count, 22)
        XCTAssertGreaterThan(kokoro.approximateBytes, 352_148_969)
        XCTAssertGreaterThan(tugao.approximateBytes, 63_939_446)
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
        XCTAssertEqual(
            SpeechEngineID.allCases.map(\.id),
            [
                "system",
                "kokoro_en",
                "piper_pt_pt",
                "piper_pt_pt_miro",
                "piper_pt_pt_dii",
                "piper_fr_fr",
                "piper_de_de",
                "piper_es_es",
                "piper_ca_es",
                "piper_nl_nl_dii",
            ]
        )
        XCTAssertTrue(kokoro.dataDirectory.path.hasSuffix("espeak-ng-data"))
        XCTAssertTrue(kokoro.tokensURL.path.hasSuffix("tokens.txt"))
        let savedRoot = SpeechModelCatalog.rootDirectoryOverride
        SpeechModelCatalog.rootDirectoryOverride = nil
        XCTAssertTrue(SpeechModelCatalog.rootDirectory.path.contains("bookstr/speech-models"))
        SpeechModelCatalog.rootDirectoryOverride = savedRoot
    }

    @MainActor
    func testSuccessfulDownloadSelectsItsLanguageAndFailureKeepsPreviousVoice() async throws {
        let suite = "speech-auto-select-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = SettingsRepository(defaults: defaults)
        settings.setSpeechVoice("previous-english", for: "en")
        settings.setSpeechVoice("previous-dutch", for: "nl")
        let failed = SpeechModelStore(downloader: FixtureSpeechDownloader(payload: Data(), status: 404))
        await failed.installAndSelect(.kokoroEnglish, settings: settings)
        XCTAssertEqual(settings.speechChoice(for: "en").voiceIdentifier, "previous-english")
        let success = SpeechModelStore(downloader: FixtureSpeechDownloader(payload: Data("data".utf8)))
        await success.installAndSelect(.dutchDii, settings: settings)
        XCTAssertEqual(settings.speechChoice(for: "nl").voiceIdentifier, "previous-dutch", "An unavailable model must not be selected")
        await success.installAndSelect(.kokoroEnglish, settings: settings)
        XCTAssertEqual(settings.speechChoice(for: "en").neuralEngine, .kokoroEnglish)
        XCTAssertEqual(settings.speechChoice(for: "nl").voiceIdentifier, "previous-dutch")
        XCTAssertEqual(SettingsRepository(defaults: defaults).speechChoice(for: "en").neuralEngine, .kokoroEnglish)
    }

    @MainActor
    func testDutchInstallSharesPronunciationDataAcrossVoicesAndRemoval() async throws {
        SpeechModelCatalog.modelsOverride = [SpeechModelSpec(
            id: .dutchDii, repository: "example/dutch", revision: "pinned",
            files: [.init(path: "espeak-ng-data/nl_dict", expectedBytes: 4)],
            kind: .vits(model: "model.onnx")
        )]
        let model = try XCTUnwrap(SpeechModelCatalog.model(.dutchDii))
        let store = SpeechModelStore(downloader: FixtureSpeechDownloader(payload: Data("data".utf8)))
        await store.install(.dutchDii)
        XCTAssertNil(store.errorMessage)
        XCTAssertTrue(store.isInstalled(.dutchDii))
        let shared = model.dataDirectory.appendingPathComponent("nl_dict")
        XCTAssertEqual(try Data(contentsOf: shared), Data("data".utf8))
        store.remove(.dutchDii)
        XCTAssertFalse(store.isInstalled(.dutchDii))
        XCTAssertTrue(FileManager.default.fileExists(atPath: shared.path))
        XCTAssertEqual(model.dataDirectory, SpeechModelCatalog.bundledModels[0].dataDirectory)
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

    func testURLSessionDownloaderUsesInjectedSession() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let (url, response) = try await URLSessionSpeechDownloader(session: URLSession(configuration: configuration))
            .download(from: URL(string: "https://example.test/model")!)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(try Data(contentsOf: url), Data("data".utf8))
    }

    @MainActor
    func testInstallReplacesDuplicateDestination() async {
        let invalid = SpeechModelStore(
            downloader: FixtureSpeechDownloader(payload: Data("data".utf8)),
            sourceURLBuilder: { _, _, _ in nil }
        )
        await invalid.install(.kokoroEnglish)
        XCTAssertEqual(invalid.lastErrorEngine, .kokoroEnglish)

        SpeechModelCatalog.modelsOverride = [
            SpeechModelSpec(
                id: .kokoroEnglish, repository: "example/model", revision: "revision",
                files: [
                    .init(path: "same.bin", expectedBytes: nil),
                    .init(path: "same.bin", expectedBytes: nil),
                ],
                kind: .vits(model: "same.bin")
            )
        ]
        let duplicate = SpeechModelStore(downloader: FixtureSpeechDownloader(payload: Data("data".utf8)))
        await duplicate.install(.kokoroEnglish)
        XCTAssertNil(duplicate.errorMessage)
        XCTAssertEqual(duplicate.completedFiles, 2)
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
