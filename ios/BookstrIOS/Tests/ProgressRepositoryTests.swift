import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class ProgressRepositoryTests: XCTestCase {
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
}
