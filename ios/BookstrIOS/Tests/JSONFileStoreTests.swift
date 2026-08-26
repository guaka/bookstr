import Foundation
import XCTest
@testable import BookstrIOS

final class JSONFileStoreTests: XCTestCase {
    private func makeStore() -> (store: JSONFileStore, subdirectory: String) {
        let subdirectory = "bookstr-jsonfile-store-tests-\(UUID().uuidString)"
        return (JSONFileStore(subdirectory: subdirectory), subdirectory)
    }

    func testLoadFallsBackToDefaultWhenFileIsMissing() {
        let (store, _) = makeStore()
        let value = store.load("missing.json", as: [BookProgress].self, fallback: [BookProgress]())
        XCTAssertTrue(value.isEmpty)
    }

    func testSaveAndLoadRoundTrip() {
        let (store, _) = makeStore()
        let original = [
            BookProgress(bookId: "book-1", progression: 0.25, cfi: "epubcfi(/6/20)", updatedAt: 1_700_000_000_000),
            BookProgress(bookId: "book-2", progression: 0.75, cfi: "epubcfi(/7/5)", updatedAt: 1_700_000_000_001),
        ]

        store.save("book_progress.json", value: original)
        let loaded = store.load("book_progress.json", as: [BookProgress].self, fallback: [])

        XCTAssertEqual(original, loaded)
    }

    func testLoadFallsBackToDefaultWhenJsonIsMalformed() {
        let (store, subdirectory) = makeStore()
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let malformed = appSupport.appendingPathComponent(subdirectory).appendingPathComponent("malformed.json")
        try? "not-json".data(using: .utf8)?.write(to: malformed)

        let loaded = store.load("malformed.json", as: [BookProgress].self, fallback: [BookProgress]())

        XCTAssertTrue(loaded.isEmpty)
    }

    func testPublicationFilesIncludesFilesInBooksDirectory() throws {
        let (store, _) = makeStore()
        let bookUrl = store.bookFileURL(bookId: "alpha", format: .epub)
        let directory = bookUrl.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let sample = "content".data(using: .utf8)!
        try sample.write(to: bookUrl)

        let files = store.publicationFiles()

        XCTAssertTrue(files.contains(bookUrl))
    }

    func testEnsureBooksDirectoryCreatesDirectory() {
        let (store, _) = makeStore()
        let bookUrl = store.bookFileURL(bookId: "beta", format: .pdf)
        let directory = bookUrl.deletingLastPathComponent()

        if FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.removeItem(at: directory)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))

        store.ensureBooksDirectory()

        var isDirectory = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory))
        XCTAssertTrue(isDirectory)
    }
}
