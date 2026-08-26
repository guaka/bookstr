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
}
