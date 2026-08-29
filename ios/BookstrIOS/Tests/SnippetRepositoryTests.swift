import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class SnippetRepositoryTests: XCTestCase {
    func testSaveMarkAppearsInAllForMarksList() throws {
        let store = JSONFileStore(subdirectory: "bookstr-snippet-test-\(UUID().uuidString)")
        let repo = SnippetRepository(fileStore: store)
        let text = ReaderSelectionActions.normalizedText("  A longer marked passage from the book.  ")
        XCTAssertFalse(text.isEmpty)
        let saved = try XCTUnwrap(repo.saveMark(
            text: text,
            bookId: "book",
            bookTitle: "Title",
            author: "Author",
            isbn: nil,
            format: .epub,
            locator: "epubcfi(/6/4)"
        ))
        XCTAssertEqual(repo.all().map(\.text), [saved.text])
        XCTAssertEqual(repo.all().first?.locator, "epubcfi(/6/4)")
    }

    func testSaveMarkAndTombstoneHideFromAll() throws {
        let store = JSONFileStore(subdirectory: "bookstr-snippet-test-\(UUID().uuidString)")
        let repo = SnippetRepository(fileStore: store)
        let saved = try XCTUnwrap(repo.saveMark(
            text: "A longer marked passage from the book.",
            bookId: "book",
            bookTitle: "Title",
            author: "Author",
            isbn: "9781234567897",
            format: .epub,
            locator: "epubcfi(/6/2)"
        ))
        XCTAssertEqual(repo.all().map(\.syncId), [saved.syncId])
        XCTAssertNil(repo.saveMark(
            text: "   ",
            bookId: "book",
            bookTitle: "Title",
            author: "Author",
            isbn: nil,
            format: .epub,
            locator: "x"
        ))
        let tombstone = try XCTUnwrap(repo.remove(syncId: saved.syncId))
        XCTAssertTrue(tombstone.deleted)
        XCTAssertTrue(repo.all().isEmpty)
        XCTAssertEqual(repo.snippet(syncId: saved.syncId)?.deleted, true)
    }

    func testMergeRemoteUsesUpdatedAtAndParsesLegacyPayload() throws {
        let directory = "bookstr-snippet-test-\(UUID().uuidString)"
        let store = JSONFileStore(subdirectory: directory)
        let repo = SnippetRepository(fileStore: store)
        let older = BookSnippet(
            syncId: "snippet-1",
            text: "old",
            bookId: "book",
            bookTitle: "Title",
            author: "Author",
            isbn: nil,
            format: .epub,
            locator: "a",
            createdAt: 1,
            updatedAt: 10,
            deleted: false
        )
        let newer = BookSnippet(
            syncId: "snippet-1",
            text: "new",
            bookId: "book",
            bookTitle: "Title",
            author: "Author",
            isbn: nil,
            format: .epub,
            locator: "b",
            createdAt: 1,
            updatedAt: 20,
            deleted: false
        )
        XCTAssertTrue(repo.mergeRemote(older))
        XCTAssertTrue(repo.mergeRemote(newer))
        XCTAssertFalse(repo.mergeRemote(older))
        repo.persist()

        let reloaded = SnippetRepository(fileStore: JSONFileStore(subdirectory: directory))
        XCTAssertEqual(reloaded.all().first?.text, "new")

        let legacy = try XCTUnwrap(SnippetRepository.parseRemote([
            "version": 1,
            "id": "legacy-id",
            "text": "Legacy passage text",
            "bookId": "book",
            "title": "Legacy title",
            "author": "Author",
            "format": "fb2",
            "locator": "fb2:sec:0:0",
            "createdAt": 1_700_000_000_000,
        ] as [String: Any]))
        XCTAssertEqual(legacy.syncId, "legacy-id")
        XCTAssertEqual(legacy.bookTitle, "Legacy title")
        XCTAssertEqual(legacy.format, .fb2)
        XCTAssertEqual(legacy.updatedAt, 1_700_000_000_000)
        XCTAssertFalse(legacy.deleted)
    }
}
