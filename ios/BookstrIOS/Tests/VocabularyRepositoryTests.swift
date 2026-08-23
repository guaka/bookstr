import XCTest
@testable import BookstrIOS

final class VocabularyRepositoryTests: XCTestCase {
    func testSaveSelectionIncrementsLookupCount() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = VocabularyRepository(fileStore: store)
        let first = repo.saveSelection(
            word: "hello",
            language: "en",
            bookId: "book",
            bookTitle: "Book",
            cfi: "cfi-1",
            context: "hello world"
        )
        let second = repo.saveSelection(
            word: "hello",
            language: "en",
            bookId: "book",
            bookTitle: "Book",
            cfi: "cfi-2",
            context: "hello again"
        )
        XCTAssertEqual(first.key, second.key)
        XCTAssertEqual(second.lookupCount, 2)
    }

    func testMergeRemotePersistsAcrossReload() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let store = JSONFileStore(subdirectory: directory)
        let repo = VocabularyRepository(fileStore: store)
        let word = VocabularyWord(
            key: "en:cache",
            word: "cache",
            language: "en",
            syncId: "sync-1",
            bookId: "book",
            bookTitle: "Book",
            cfi: "",
            contextSentence: "",
            partOfSpeech: "noun",
            definitions: ["a store"],
            translation: nil,
            sourceUrl: "",
            lookupCount: 1,
            firstSeenAt: 1,
            lastSeenAt: 2,
            deleted: false
        )
        XCTAssertTrue(repo.mergeRemote(word))
        repo.persist()
        let reloaded = VocabularyRepository(fileStore: JSONFileStore(subdirectory: directory))
        XCTAssertEqual(reloaded.all().map(\.word), ["cache"])
        XCTAssertEqual(reloaded.word(syncId: "sync-1")?.definitions, ["a store"])
    }

    func testRemoveHidesWordAndKeepsTombstone() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let store = JSONFileStore(subdirectory: directory)
        let repo = VocabularyRepository(fileStore: store)
        let saved = repo.saveSelection(
            word: "ephemeral",
            language: "en",
            bookId: "book",
            bookTitle: "Book",
            cfi: "",
            context: ""
        )
        XCTAssertEqual(repo.all().map(\.word), ["ephemeral"])
        XCTAssertNotNil(repo.remove(key: saved.key))
        XCTAssertTrue(repo.all().isEmpty)
        XCTAssertEqual(repo.word(syncId: saved.syncId)?.deleted, true)

        let reloaded = VocabularyRepository(fileStore: JSONFileStore(subdirectory: directory))
        XCTAssertTrue(reloaded.all().isEmpty)
        XCTAssertEqual(reloaded.word(syncId: saved.syncId)?.deleted, true)
    }
}
