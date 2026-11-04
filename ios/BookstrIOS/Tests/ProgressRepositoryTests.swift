import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class ProgressRepositoryTests: XCTestCase {
    func testJSONFileStorePersistsValuesAndFallsBackForMissingOrMalformedFiles() throws {
        let subdirectory = "bookstr-test-json-store-\(UUID().uuidString)"
        defer { removeApplicationSupportDirectory(subdirectory) }
        let store = JSONFileStore(subdirectory: subdirectory)
        store.save("value.json", value: ["answer": 42])

        let reloaded = JSONFileStore(subdirectory: subdirectory)
        XCTAssertEqual(reloaded.load("value.json", as: [String: Int].self, fallback: [:]), ["answer": 42])
        XCTAssertEqual(reloaded.load("missing.json", as: [String: Int].self, fallback: ["fallback": 1]), ["fallback": 1])
        try Data("not json".utf8).write(to: applicationSupportDirectory(subdirectory).appendingPathComponent("broken.json"))
        XCTAssertEqual(reloaded.load("broken.json", as: [String: Int].self, fallback: ["invalid": 2]), ["invalid": 2])

        struct UnencodableValue: Encodable {
            func encode(to encoder: Encoder) throws { throw EncodingError.invalidValue(self, .init(codingPath: [], debugDescription: "intentional test failure")) }
        }
        reloaded.save("unencodable.json", value: UnencodableValue())
        XCTAssertEqual(reloaded.load("unencodable.json", as: [String: Int].self, fallback: ["encode": 3]), ["encode": 3])
    }

    func testJSONFileStoreDiscoversPublicationAndCoverFiles() throws {
        let subdirectory = "bookstr-test-file-discovery-\(UUID().uuidString)"
        defer { removeApplicationSupportDirectory(subdirectory) }
        let store = JSONFileStore(subdirectory: subdirectory)
        XCTAssertTrue(store.publicationFiles().isEmpty, "missing books directory should produce an empty listing")
        XCTAssertTrue(store.cachedCoverURLs().isEmpty, "missing covers directory should produce an empty cache")
        XCTAssertTrue(store.discoveredCoverURLs().isEmpty, "missing discovered-covers directory should produce an empty map")
        store.ensureBooksDirectory()
        store.ensureCoversDirectory()
        let book = store.bookFileURL(bookId: "local-book", format: .epub)
        let cover = store.coverFileURL(bookId: "local-book", ext: "png")
        let alternateCover = store.coverFileURL(bookId: "UPPER-BOOK", ext: "webp")
        try Data("book".utf8).write(to: book)
        try Data("cover".utf8).write(to: cover)
        try Data("alternate".utf8).write(to: alternateCover)
        try Data("hidden".utf8).write(to: book.deletingLastPathComponent().appendingPathComponent(".hidden"))

        XCTAssertEqual(store.publicationFiles(), [book])
        XCTAssertEqual(store.cachedCoverURLs()["local-book"], cover)
        XCTAssertEqual(store.cachedCoverURLs()["upper-book"], alternateCover)
        let caseVariantCover = store.coverFileURL(bookId: "upper-book", ext: "jpeg")
        try Data("case variant".utf8).write(to: caseVariantCover)
        XCTAssertTrue([alternateCover, caseVariantCover].contains(store.cachedCoverURLs()["upper-book"]),
                      "case-insensitive duplicate basenames should collapse to one cached URL")
        XCTAssertEqual(store.discoveredCoverFileURL(key: "query").lastPathComponent, "query.jpg")
        try Data("jpg".utf8).write(to: store.discoveredCoverFileURL(key: "query"))
        try Data("png".utf8).write(to: store.discoveredCoverFileURL(key: "ignored").deletingPathExtension().appendingPathExtension("png"))
        XCTAssertEqual(store.discoveredCoverURLs().mapValues(\.lastPathComponent), ["query": "query.jpg"])
    }

    func testReaderProgressRecorderPersistsProgressAndResolvedSessionMetadata() throws {
        let subdirectory = "bookstr-test-recorder-\(UUID().uuidString)"
        defer { removeApplicationSupportDirectory(subdirectory) }
        let progress = ProgressRepository(fileStore: JSONFileStore(subdirectory: subdirectory))
        let defaultsName = "bookstr-test-recorder-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: defaultsName)!
        defer { defaults.removePersistentDomain(forName: defaultsName) }
        let settings = SettingsRepository(defaults: defaults)
        let book = CatalogBook(id: "comic", title: "Panel", author: "Artist", epubUrl: "", coverUrl: nil,
                               sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .cbz, year: "2024",
                               rightsStatus: "public_domain", license: "CC0", licenseUrl: nil, rightsSource: "catalog")

        ReaderProgressRecorder.record(book: book, format: .cbz, progression: 0.5, locator: "comic:4:80",
                                      progressRepository: progress, settingsRepository: settings)

        XCTAssertEqual(progress.get(bookId: "comic").cfi, "comic:4:80")
        let session = try XCTUnwrap(settings.readerSession())
        XCTAssertEqual(session.pageIndex, 4)
        XCTAssertEqual(session.author, "Artist")
        XCTAssertEqual(session.rightsStatus, "public_domain")
        XCTAssertEqual(session.license, "CC0")
        let overridden = ReaderProgressRecorder.session(
            book: book, format: .pdf, locator: "page:9", pageIndex: 2,
            rights: BookRights(status: .openLicense, license: "CC BY 4.0", licenseURL: "https://example.test/license", source: "override")
        )
        XCTAssertEqual(overridden.pageIndex, 2)
        XCTAssertEqual(overridden.rightsStatus, RightsStatus.openLicense.rawValue)
        XCTAssertEqual(overridden.licenseUrl, "https://example.test/license")
        XCTAssertEqual(overridden.rightsSource, "override")
        XCTAssertEqual(ReaderProgressRecorder.resolvedPageIndex(for: .pdf, locator: "page:12"), 12)
        XCTAssertEqual(ReaderProgressRecorder.resolvedPageIndex(for: .pdf, locator: "invalid"), 0)
        XCTAssertEqual(ReaderProgressRecorder.resolvedPageIndex(for: .cbr, locator: "comic:-3"), 0)
        XCTAssertEqual(ReaderProgressRecorder.resolvedPageIndex(for: .epub, locator: "epubcfi(/6/2)"), 0)
        XCTAssertEqual(ReaderProgressRecorder.resolvedPageIndex(for: .cbz, locator: nil), 0)

    }

    private func applicationSupportDirectory(_ subdirectory: String) -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent(subdirectory, isDirectory: true)
    }

    private func removeApplicationSupportDirectory(_ subdirectory: String) {
        try? FileManager.default.removeItem(at: applicationSupportDirectory(subdirectory))
    }

    func testSaveAndGetProgress() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = ProgressRepository(fileStore: store)
        repo.save(bookId: "a", progression: 0.5, cfi: "loc")
        let p = repo.get(bookId: "a")
        XCTAssertEqual(p.bookId, "a")
        XCTAssertEqual(p.cfi, "loc")
        XCTAssertEqual(p.progression, 0.5, accuracy: 0.0001)
    }

    func testGetReturnsZeroProgressForUnknownBook() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = ProgressRepository(fileStore: store)

        let progress = repo.get(bookId: "missing")

        XCTAssertEqual(progress, BookProgress(bookId: "missing", progression: 0, cfi: "", updatedAt: 0))
    }

    func testSaveOverwritesExistingBookProgressEntry() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = ProgressRepository(fileStore: store)
        repo.save(bookId: "book-1", progression: 0.1, cfi: "old")
        repo.save(bookId: "book-1", progression: 0.9, cfi: "new")

        let all = repo.all()
        let progress = repo.get(bookId: "book-1")

        XCTAssertEqual(1, all.count { $0.bookId == "book-1" })
        XCTAssertEqual(0.9, progress.progression, accuracy: 0.0001)
        XCTAssertEqual("new", progress.cfi)
    }

    func testRepositoryLoadsProgressFromStoredFile() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        store.save("book_progress.json", value: [
            BookProgress(bookId: "newer", progression: 0.2, cfi: "n", updatedAt: 20),
            BookProgress(bookId: "older", progression: 0.1, cfi: "o", updatedAt: 10),
        ])

        let repo = ProgressRepository(fileStore: store)
        let all = repo.all()

        XCTAssertEqual(["newer", "older"], all.map(\.bookId))
        XCTAssertEqual(0.2, repo.get(bookId: "newer").progression, accuracy: 0.0001)
    }

    func testRepositoryPersistsNewProgressAcrossInstances() {
        let subdirectory = "bookstr-test-\(UUID().uuidString)"
        let store = JSONFileStore(subdirectory: subdirectory)
        let first = ProgressRepository(fileStore: store)
        first.save(bookId: "book-2", progression: 0.7, cfi: "checkpoint")

        let second = ProgressRepository(fileStore: JSONFileStore(subdirectory: subdirectory))
        let progress = second.get(bookId: "book-2")

        XCTAssertEqual(0.7, progress.progression, accuracy: 0.0001)
        XCTAssertEqual("checkpoint", progress.cfi)
    }

    func testRemoteMergeNormalizesSecondsAndRejectsOlderUpdates() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = ProgressRepository(fileStore: store)

        XCTAssertTrue(repo.mergeRemote(
            bookId: "remote",
            progression: 0.6,
            cfi: "new",
            updatedAt: 1_700_000_100
        ))
        XCTAssertFalse(repo.mergeRemote(
            bookId: "remote",
            progression: 0.1,
            cfi: "old",
            updatedAt: 1_700_000_000_000
        ))

        let progress = repo.get(bookId: "remote")
        XCTAssertEqual(progress.progression, 0.6, accuracy: 0.0001)
        XCTAssertEqual(progress.cfi, "new")
        XCTAssertEqual(progress.updatedAt, 1_700_000_100_000)
    }

    func testRemoteMergeAcceptsEqualTimestampCorrectionsButNotExactDuplicates() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = ProgressRepository(fileStore: store)

        XCTAssertTrue(repo.mergeRemote(
            bookId: "remote",
            progression: 0.2,
            cfi: "first",
            updatedAt: 1_700_000_100_000
        ))
        XCTAssertTrue(repo.mergeRemote(
            bookId: "remote",
            progression: 0.3,
            cfi: "corrected",
            updatedAt: 1_700_000_100_000
        ))
        XCTAssertFalse(repo.mergeRemote(
            bookId: "remote",
            progression: 0.3,
            cfi: "corrected",
            updatedAt: 1_700_000_100_000
        ))

        XCTAssertEqual(repo.get(bookId: "remote").cfi, "corrected")
    }

    func testRemoveClearsProgressForBook() {
        let subdirectory = "bookstr-test-progress-remove-\(UUID().uuidString)"
        let store = JSONFileStore(subdirectory: subdirectory)
        let repo = ProgressRepository(fileStore: store)
        repo.save(bookId: "keep", progression: 0.2, cfi: "a")
        repo.save(bookId: "gone", progression: 0.9, cfi: "b")
        repo.remove(bookId: "gone")
        XCTAssertEqual(repo.get(bookId: "keep").progression, 0.2, accuracy: 0.0001)
        XCTAssertEqual(repo.get(bookId: "gone").progression, 0, accuracy: 0.0001)
        XCTAssertEqual(repo.get(bookId: "gone").cfi, "")
        let reloaded = ProgressRepository(fileStore: JSONFileStore(subdirectory: subdirectory))
        XCTAssertEqual(reloaded.get(bookId: "keep").cfi, "a")
        XCTAssertEqual(reloaded.get(bookId: "gone").cfi, "")
    }
}
