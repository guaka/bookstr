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
