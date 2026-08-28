import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class VocabularyRepositoryTests: XCTestCase {
    func testSharedVocabularyWireV1Fixtures() throws {
        let fixture = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: vocabularyFixtureURL())) as? [String: Any]
        )
        XCTAssertEqual(fixture["version"] as? Int, 1)
        let fields = try XCTUnwrap(fixture["fields"] as? [String: Any])
        let cases = try XCTUnwrap(fixture["cases"] as? [[String: Any]])
        for entry in cases {
            let name = try XCTUnwrap(entry["name"] as? String)
            let payload = try XCTUnwrap(entry["payload"] as? [String: Any])
            let parsed = VocabularyRepository.parseRemote(payload)
            guard entry["valid"] as? Bool == true else {
                XCTAssertNil(parsed, name)
                continue
            }
            let expected = try XCTUnwrap(entry["expected"] as? [String: Any])
            let value = try XCTUnwrap(parsed, name)
            let actual: [String: Any] = [
                "key": value.key, "word": value.word, "language": value.language, "syncId": value.syncId,
                "bookId": value.bookId, "bookTitle": value.bookTitle, "cfi": value.cfi,
                "contextSentence": value.contextSentence, "partOfSpeech": value.partOfSpeech,
                "definitions": value.definitions, "sourceUrl": value.sourceUrl, "lookupCount": value.lookupCount,
                "firstSeenAt": value.firstSeenAt, "lastSeenAt": value.lastSeenAt, "deleted": value.deleted,
            ]
            var comparable: [String: Any] = [:]
            for field in fields.keys { comparable[field] = actual[field] }
            XCTAssertTrue(NSDictionary(dictionary: comparable).isEqual(to: expected), name)
        }
    }

    private func vocabularyFixtureURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("shared/fixtures/vocabulary-wire-v1.json")
    }

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

    func testNewerLocalTombstoneRejectsStaleRemoteWord() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = VocabularyRepository(fileStore: store)
        let saved = repo.saveSelection(
            word: "returning", language: "en", bookId: "book", bookTitle: "Book", cfi: "", context: ""
        )
        let tombstone = repo.remove(key: saved.key)!
        let stale = VocabularyWord(
            key: saved.key, word: saved.word, language: saved.language, syncId: saved.syncId,
            bookId: saved.bookId, bookTitle: saved.bookTitle, cfi: saved.cfi,
            contextSentence: saved.contextSentence, partOfSpeech: saved.partOfSpeech,
            definitions: saved.definitions, translation: saved.translation, sourceUrl: saved.sourceUrl,
            lookupCount: saved.lookupCount, firstSeenAt: saved.firstSeenAt,
            lastSeenAt: tombstone.lastSeenAt - 1, deleted: false
        )

        XCTAssertFalse(repo.mergeRemote(stale))
        XCTAssertTrue(repo.all().isEmpty)
        XCTAssertEqual(repo.word(syncId: saved.syncId)?.deleted, true)
    }

    func testWordFilterClearsOnlyForDeletedWord() {
        XCTAssertTrue(shouldClearWordFilter("  Ephemeral ", deletedWord: "ephemeral"))
        XCTAssertFalse(shouldClearWordFilter("ephem", deletedWord: "ephemeral"))
        XCTAssertFalse(shouldClearWordFilter("another", deletedWord: "ephemeral"))
    }

    func testParseRemoteRejectsMissingWordOrLanguage() {
        XCTAssertNil(VocabularyRepository.parseRemote([
            "language": "en",
            "syncId": "sync-1",
            "bookId": "book-id",
            "bookTitle": "Book"
        ]))

        XCTAssertNil(VocabularyRepository.parseRemote([
            "word": "word",
            "syncId": "sync-2",
            "bookId": "book-id",
            "bookTitle": "Book"
        ]))
    }

    func testParseRemoteRejectsMissingSyncIdOrBookIdOrTitle() {
        XCTAssertNil(VocabularyRepository.parseRemote([
            "word": "word",
            "language": "en",
            "bookId": "book-id"
        ]))
        XCTAssertNil(VocabularyRepository.parseRemote([
            "word": "word",
            "language": "en",
            "syncId": "sync-3"
        ]))
    }

    func testParseRemoteFallsBackToDerivedKeyAndUsesUpdatedAtWhenLastSeenAtMissing() {
        let parsed = VocabularyRepository.parseRemote([
            "word": "HELLO",
            "language": "EN",
            "syncId": "sync-4",
            "bookId": "book-id",
            "bookTitle": "Book",
            "updatedAt": 100,
        ])!
        XCTAssertEqual(parsed.key, "en:hello")
        XCTAssertEqual(parsed.word, "hello")
        XCTAssertEqual(parsed.lastSeenAt, 100)
        XCTAssertEqual(parsed.firstSeenAt, 100)
    }

    func testParseRemoteParsesDefinitionsAndFlagsDeleted() {
        let parsed = VocabularyRepository.parseRemote([
            "word": "cache",
            "language": "en",
            "syncId": "sync-5",
            "bookId": "book-id",
            "bookTitle": "Book",
            "definitions": ["one", "two"],
            "partOfSpeech": "noun",
            "contextSentence": "a vault",
            "translation": "vault",
            "sourceUrl": "https://example.org/source.json",
            "lookupCount": 7,
            "firstSeenAt": 10,
            "lastSeenAt": 20,
            "deleted": true
        ])!
        XCTAssertEqual(parsed.definitions, ["one", "two"])
        XCTAssertEqual(parsed.partOfSpeech, "noun")
        XCTAssertEqual(parsed.translation, "vault")
        XCTAssertEqual(parsed.sourceUrl, "https://example.org/source.json")
        XCTAssertEqual(parsed.lookupCount, 7)
        XCTAssertTrue(parsed.deleted)
    }

    func testSaveDefinitionCanUpdateOnlyProvidedFields() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: directory))
        let saved = repo.saveSelection(
            word: "bridge",
            language: "en",
            bookId: "book",
            bookTitle: "Book",
            cfi: "cfi",
            context: "across"
        )

        let result = repo.saveDefinition(
            key: saved.key,
            partOfSpeech: "",
            definitions: [],
            translation: "",
            sourceUrl: ""
        )!
        XCTAssertEqual(result.partOfSpeech, saved.partOfSpeech)
        XCTAssertEqual(result.definitions, saved.definitions)
        XCTAssertEqual(result.translation, saved.translation)
        XCTAssertEqual(result.sourceUrl, saved.sourceUrl)

        let updated = repo.saveDefinition(
            key: saved.key,
            partOfSpeech: "noun",
            definitions: ["definition"],
            translation: "tr",
            sourceUrl: "source"
        )!
        XCTAssertEqual(updated.partOfSpeech, "noun")
        XCTAssertEqual(updated.definitions, ["definition"])
        XCTAssertEqual(updated.translation, "tr")
        XCTAssertEqual(updated.sourceUrl, "source")
    }

    func testSaveDefinitionReturnsNilForMissingOrDeleted() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: directory))
        let deleted = repo.saveSelection(
            word: "unused",
            language: "en",
            bookId: "book",
            bookTitle: "Book",
            cfi: "cfi",
            context: "nothing"
        )
        XCTAssertNotNil(repo.remove(key: deleted.key))
        XCTAssertNil(repo.saveDefinition(key: "missing", partOfSpeech: "noun", definitions: ["x"], translation: "", sourceUrl: "x"))
        XCTAssertNil(repo.saveDefinition(key: deleted.key, partOfSpeech: "noun", definitions: ["x"], translation: "", sourceUrl: "x"))
    }

    func testMergeRemoteRejectsStaleWord() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = VocabularyRepository(fileStore: store)
        let local = repo.saveSelection(
            word: "stale",
            language: "en",
            bookId: "book",
            bookTitle: "Book",
            cfi: "cfi",
            context: ""
        )
        let stale = VocabularyWord(
            key: local.key,
            word: local.word,
            language: local.language,
            syncId: local.syncId,
            bookId: local.bookId,
            bookTitle: local.bookTitle,
            cfi: local.cfi,
            contextSentence: local.contextSentence,
            partOfSpeech: local.partOfSpeech,
            definitions: local.definitions,
            translation: local.translation,
            sourceUrl: local.sourceUrl,
            lookupCount: 1,
            firstSeenAt: local.firstSeenAt,
            lastSeenAt: local.lastSeenAt - 1,
            deleted: false
        )

        XCTAssertFalse(repo.mergeRemote(stale))
        XCTAssertEqual(repo.all().first?.lastSeenAt, local.lastSeenAt)
    }

    func testMergeRemoteAcceptsFresherWordAndPersists() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = VocabularyRepository(fileStore: store)
        let local = repo.saveSelection(
            word: "fresher",
            language: "en",
            bookId: "book",
            bookTitle: "Book",
            cfi: "cfi",
            context: ""
        )
        let remote = VocabularyWord(
            key: local.key,
            word: local.word,
            language: local.language,
            syncId: local.syncId,
            bookId: local.bookId,
            bookTitle: local.bookTitle,
            cfi: local.cfi,
            contextSentence: local.contextSentence,
            partOfSpeech: "noun",
            definitions: ["fresh"],
            translation: "fresh",
            sourceUrl: local.sourceUrl,
            lookupCount: local.lookupCount + 4,
            firstSeenAt: local.firstSeenAt,
            lastSeenAt: local.lastSeenAt + 20,
            deleted: false
        )

        XCTAssertTrue(repo.mergeRemote(remote))
        repo.persist()
        let reread = VocabularyRepository(fileStore: store)
        XCTAssertEqual(reread.word(syncId: local.syncId)?.definitions, ["fresh"])
        XCTAssertEqual(reread.word(syncId: local.syncId)?.partOfSpeech, "noun")
        XCTAssertEqual(reread.word(syncId: local.syncId)?.lookupCount, local.lookupCount + 4)
    }

    func testMergeRemotePreservesLocalDeletedWhenOlderTombstone() {
        let store = JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)")
        let repo = VocabularyRepository(fileStore: store)
        let local = repo.saveSelection(
            word: "tomb",
            language: "en",
            bookId: "book",
            bookTitle: "Book",
            cfi: "cfi",
            context: ""
        )
        _ = repo.remove(key: local.key)
        let localTomb = repo.word(syncId: local.syncId)!

        let staleRemoteTomb = VocabularyWord(
            key: local.key,
            word: local.word,
            language: local.language,
            syncId: local.syncId,
            bookId: local.bookId,
            bookTitle: local.bookTitle,
            cfi: local.cfi,
            contextSentence: local.contextSentence,
            partOfSpeech: local.partOfSpeech,
            definitions: local.definitions,
            translation: local.translation,
            sourceUrl: local.sourceUrl,
            lookupCount: local.lookupCount,
            firstSeenAt: local.firstSeenAt,
            lastSeenAt: localTomb.lastSeenAt - 10,
            deleted: true
        )

        XCTAssertFalse(repo.mergeRemote(staleRemoteTomb))
        XCTAssertTrue(repo.word(syncId: local.syncId)?.deleted == true)
    }

    func testAllOmitsDeletedWordsButKeepsBySyncLookup() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: directory))
        let first = repo.saveSelection(word: "visible", language: "en", bookId: "book", bookTitle: "Book", cfi: "cfi", context: "")
        let deleted = repo.saveSelection(word: "removed", language: "en", bookId: "book", bookTitle: "Book", cfi: "cfi", context: "")
        _ = repo.remove(key: deleted.key)

        XCTAssertEqual(repo.all().count, 1)
        XCTAssertEqual(repo.all().first?.word, first.word)
        XCTAssertEqual(repo.word(syncId: deleted.syncId)?.deleted, true)
    }
}
