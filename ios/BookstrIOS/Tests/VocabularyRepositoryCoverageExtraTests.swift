import XCTest
@testable import BookstrIOS

final class VocabularyRepositoryCoverageExtraTests: XCTestCase {
    func testSaveSelectionNormalizesKeyAndReusesExistingSyncId() {
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: "bookstr-test-\(UUID().uuidString)"))

        let first = repo.saveSelection(
            word: "Hello",
            language: "EN",
            bookId: "book-1",
            bookTitle: "Book",
            cfi: "cfi-1",
            context: "hello from start",
        )

        let second = repo.saveSelection(
            word: "HELLO",
            language: "EN",
            bookId: "book-1",
            bookTitle: "Book",
            cfi: "cfi-2",
            context: "hello again",
        )

        XCTAssertEqual(first.key, "en:hello")
        XCTAssertEqual(first.word, "Hello")
        XCTAssertEqual(first.syncId, second.syncId)
        XCTAssertEqual(first.key, second.key)
        XCTAssertEqual(second.lookupCount, 2)
    }

    func testParseRemoteHandlesNumericValuesAndMixedDefinitions() {
        let parsed = VocabularyRepository.parseRemote([
            "word": "Hello",
            "language": "EN",
            "syncId": "sync-num-1",
            "bookId": "book-id",
            "bookTitle": "Book",
            "definitions": ["first", 2, "third", nil as Any],
            "definition": "ignored",
            "lookupCount": "11",
            "firstSeenAt": "5",
            "lastSeenAt": 22.0,
            "updatedAt": "100",
            "deleted": false,
        ])!

        XCTAssertEqual(parsed.key, "en:hello")
        XCTAssertEqual(parsed.word, "hello")
        XCTAssertEqual(parsed.definitions, ["first", "third"])
        XCTAssertEqual(parsed.lookupCount, 11)
        XCTAssertEqual(parsed.firstSeenAt, 5)
        XCTAssertEqual(parsed.lastSeenAt, 22)
        XCTAssertEqual(parsed.translation, nil)
    }

    func testSaveDefinitionPreservesExistingMetadataWhenNoValueProvided() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: directory))
        let remote = VocabularyWord(
            key: "en:revive",
            word: "revive",
            language: "en",
            syncId: "sync-revive",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            contextSentence: "before",
            partOfSpeech: "noun",
            definitions: ["old"],
            translation: "old",
            sourceUrl: "https://source.example/old",
            lookupCount: 1,
            firstSeenAt: 1,
            lastSeenAt: 1,
            deleted: false,
        )

        XCTAssertTrue(repo.mergeRemote(remote))
        let updated = repo.saveDefinition(key: remote.key, partOfSpeech: "", definitions: [], translation: nil, sourceUrl: "")

        XCTAssertEqual(updated?.partOfSpeech, "noun")
        XCTAssertEqual(updated?.definitions, ["old"])
        XCTAssertEqual(updated?.translation, "old")
        XCTAssertEqual(updated?.sourceUrl, "https://source.example/old")
    }

    func testMergeRemoteCanReviveDeletedWordWhenRemoteIsNewer() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let store = JSONFileStore(subdirectory: directory)
        let repo = VocabularyRepository(fileStore: store)
        let saved = repo.saveSelection(
            word: "stale",
            language: "en",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            context: "before",
        )
        let tombstone = repo.remove(key: saved.key)!

        let revived = VocabularyWord(
            key: saved.key,
            word: saved.word,
            language: saved.language,
            syncId: saved.syncId,
            bookId: saved.bookId,
            bookTitle: saved.bookTitle,
            cfi: saved.cfi,
            contextSentence: "after",
            partOfSpeech: "verb",
            definitions: ["returned"],
            translation: nil,
            sourceUrl: saved.sourceUrl,
            lookupCount: saved.lookupCount,
            firstSeenAt: saved.firstSeenAt,
            lastSeenAt: tombstone.lastSeenAt + 10,
            deleted: false,
        )

        XCTAssertTrue(repo.mergeRemote(revived))
        let live = repo.word(syncId: saved.syncId)
        XCTAssertNotNil(live)
        XCTAssertFalse(live?.deleted == true)
        XCTAssertEqual(live?.definitions, ["returned"])
        XCTAssertEqual(live?.contextSentence, "after")
    }

    func testMergeRemoteRejectsOlderWordForDeletedTombstone() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: directory))
        let saved = repo.saveSelection(
            word: "obsolete",
            language: "en",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            context: "keep",
        )
        let tombstone = repo.remove(key: saved.key)!

        let stale = VocabularyWord(
            key: saved.key,
            word: saved.word,
            language: saved.language,
            syncId: saved.syncId,
            bookId: saved.bookId,
            bookTitle: saved.bookTitle,
            cfi: saved.cfi,
            contextSentence: "stale",
            partOfSpeech: "",
            definitions: ["ignore"],
            translation: nil,
            sourceUrl: saved.sourceUrl,
            lookupCount: saved.lookupCount,
            firstSeenAt: saved.firstSeenAt,
            lastSeenAt: tombstone.lastSeenAt - 1,
            deleted: false,
        )

        XCTAssertFalse(repo.mergeRemote(stale))
        XCTAssertTrue(repo.word(syncId: saved.syncId)?.deleted == true)
    }

    func testParseRemoteRejectsIncompletePayloads() {
        XCTAssertNil(VocabularyRepository.parseRemote(["language": "en"]))
        XCTAssertNil(VocabularyRepository.parseRemote(["word": "", "language": "en", "syncId": "s", "bookId": "b", "bookTitle": "t"]))
        XCTAssertNil(VocabularyRepository.parseRemote(["word": "word", "language": "en", "syncId": "", "bookId": "b", "bookTitle": "t"]))
        XCTAssertNil(VocabularyRepository.parseRemote(["word": "word", "language": "en", "syncId": "s", "bookTitle": "t"]))
    }

    func testAllFiltersDeletedWordsAndSortsNewestFirst() {
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: "bookstr-vocab-extra-\(UUID().uuidString)"))

        _ = repo.mergeRemote(testWord(
            key: "en:older",
            word: "older",
            syncId: "sync-old",
            sourceUrl: "https://example.org/older",
            lastSeenAt: 1_700_000_000_001
        ))
        _ = repo.mergeRemote(testWord(
            key: "en:newer",
            word: "newer",
            syncId: "sync-new",
            sourceUrl: "https://example.org/newer",
            lastSeenAt: 1_700_000_000_999
        ))
        _ = repo.mergeRemote(testWord(
            key: "en:deleted",
            word: "deleted",
            syncId: "sync-del",
            lastSeenAt: 1_700_000_001_000,
            deleted: true
        ))

        let words = repo.all()

        XCTAssertEqual(words.count, 2)
        XCTAssertEqual(words.map(\.key), ["en:newer", "en:older"])
        XCTAssertEqual(words.first?.lastSeenAt, 1_700_000_000_999)
    }

    func testMergeRemoteSkipsOlderNonDeletedEntry() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: directory))
        let saved = repo.saveSelection(
            word: "Repeat",
            language: "en",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            context: "before",
        )

        let stale = testWord(
            key: saved.key,
            word: saved.word,
            syncId: "new-sync-id",
            language: saved.language,
            lastSeenAt: saved.lastSeenAt - 10_000,
            sourceUrl: "https://ignored.example"
        )
        XCTAssertFalse(repo.mergeRemote(stale))
        XCTAssertEqual(saved.sourceUrl, repo.word(syncId: saved.syncId)?.sourceUrl)
        XCTAssertEqual(saved.lastSeenAt, repo.word(syncId: saved.syncId)?.lastSeenAt)
    }

    func testMergeRemoteAcceptsEqualLastSeenAtAsNewer() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: directory))
        let saved = repo.saveSelection(
            word: "touch",
            language: "en",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            context: "before",
        )

        let replacement = testWord(
            key: saved.key,
            word: saved.word,
            syncId: saved.syncId,
            language: saved.language,
            lastSeenAt: saved.lastSeenAt,
            sourceUrl: "https://equal.example",
        )

        XCTAssertTrue(repo.mergeRemote(replacement))
        XCTAssertEqual(repo.word(syncId: saved.syncId)?.sourceUrl, "https://equal.example")
    }

    func testSaveDefinitionKeepsLookupCountAndSeenStateWhenUpdating() {
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: "bookstr-vocab-extra-\(UUID().uuidString)"))
        let before = repo.saveSelection(
            word: "steady",
            language: "en",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            context: "before"
        )
        let after = repo.saveDefinition(
            key: before.key,
            partOfSpeech: "verb",
            definitions: ["move", "run"],
            translation: "translate",
            sourceUrl: "https://example.org/steady"
        )

        XCTAssertNotNil(after)
        XCTAssertEqual(before.lookupCount, after?.lookupCount)
        XCTAssertEqual(before.firstSeenAt, after?.firstSeenAt)
        XCTAssertEqual(before.lastSeenAt, after?.lastSeenAt)
    }

    func testParseRemoteConvertsNSNumberTimestampValues() {
        let parsed = VocabularyRepository.parseRemote([
            "word": "counted",
            "language": "EN",
            "syncId": "sync-number-values",
            "bookId": "book-id",
            "bookTitle": "Book",
            "lookupCount": NSNumber(value: 7.8),
            "firstSeenAt": NSNumber(value: 1_700_000_000_222.9),
            "lastSeenAt": NSNumber(value: 1_700_000_000_333.9),
        ])!

        XCTAssertEqual(parsed.lookupCount, 7)
        XCTAssertEqual(parsed.firstSeenAt, 1_700_000_000_222)
        XCTAssertEqual(parsed.lastSeenAt, 1_700_000_000_333)
    }

    func testParseRemoteFallsBackToUpdatedAtForLastSeenAtWhenMissing() {
        let parsed = VocabularyRepository.parseRemote([
            "word": "Fallback",
            "language": "EN",
            "syncId": "sync-fallback",
            "bookId": "book-id",
            "bookTitle": "Book",
            "updatedAt": 1_700_000_000_321,
            "lookupCount": 3,
        ])!

        XCTAssertEqual(parsed.word, "fallback")
        XCTAssertEqual(parsed.lastSeenAt, 1_700_000_000_321)
        XCTAssertEqual(parsed.firstSeenAt, 1_700_000_000_321)
        XCTAssertEqual(parsed.lookupCount, 3)
    }

    func testMergeRemoteAcceptsDeletedWordWhenExistingEntryIsMissing() {
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: "bookstr-vocab-extra-\(UUID().uuidString)"))
        let deleted = VocabularyWord(
            key: "en:missing",
            word: "missing",
            language: "en",
            syncId: "sync-missing",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            contextSentence: "before",
            partOfSpeech: "noun",
            definitions: ["one"],
            translation: nil,
            sourceUrl: "https://example.org",
            lookupCount: 1,
            firstSeenAt: 10,
            lastSeenAt: 20,
            deleted: true,
        )

        XCTAssertTrue(repo.mergeRemote(deleted))
        XCTAssertTrue(repo.word(syncId: deleted.syncId)?.deleted == true)
        XCTAssertTrue(repo.all().isEmpty())
    }

    func testRemoveTwiceReturnsNilSecondTime() {
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: "bookstr-vocab-extra-\(UUID().uuidString)"))
        let saved = repo.saveSelection(
            word: "repeat",
            language: "en",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            context: "before"
        )
        _ = repo.remove(key: saved.key)

        XCTAssertNil(repo.remove(key: saved.key))
        XCTAssertTrue(repo.all().isEmpty())
    }

    func testSaveDefinitionReturnsNilForDeletedWord() {
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: "bookstr-vocab-extra-\(UUID().uuidString)"))
        let saved = repo.saveSelection(
            word: "gone",
            language: "en",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            context: "before"
        )
        _ = repo.remove(key: saved.key)

        XCTAssertNil(repo.saveDefinition(key: saved.key, partOfSpeech: "noun", definitions: ["left"], translation: nil, sourceUrl: "https://example.org"))
    }

    func testSaveSelectionRevivesDeletedWord() {
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: "bookstr-vocab-extra-\(UUID().uuidString)"))
        let removed = repo.saveSelection(
            word: "revived",
            language: "EN",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            context: "before"
        )
        _ = repo.remove(key: removed.key)
        let restored = repo.saveSelection(
            word: "Revived",
            language: "en",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi-v2",
            context: "after"
        )

        XCTAssertEqual(removed.syncId, restored.syncId)
        XCTAssertEqual(removed.key, restored.key)
        XCTAssertEqual(removed.firstSeenAt, restored.firstSeenAt)
        XCTAssertEqual(restored.deleted, false)
        XCTAssertTrue(repo.word(syncId: restored.syncId)?.deleted == false)
        XCTAssertEqual(restored.lookupCount, 2)
    }

    func testWordLookupByUnknownSyncIdReturnsNil() {
        let repo = VocabularyRepository(fileStore: JSONFileStore(subdirectory: "bookstr-vocab-extra-\(UUID().uuidString)"))

        XCTAssertNil(repo.word(syncId: "sync-does-not-exist"))
    }

    func testPersistPersistsAllDataAndCanReload() {
        let directory = "bookstr-test-\(UUID().uuidString)"
        let store = JSONFileStore(subdirectory: directory)
        let repo = VocabularyRepository(fileStore: store)
        let saved = repo.saveSelection(
            word: "persist",
            language: "en",
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            context: "before"
        )
        repo.persist()

        let reloaded = VocabularyRepository(fileStore: store)
        XCTAssertEqual(reloaded.word(syncId: saved.syncId)?.key, saved.key)
        XCTAssertEqual(reloaded.word(syncId: saved.syncId)?.word, "persist")
    }

    func testParseRemoteKeepsProvidedKeyWhenPresent() {
        let parsed = VocabularyRepository.parseRemote([
            "word": "Case",
            "language": "EN",
            "syncId": "sync-keyed",
            "key": "vocab:custom-key",
            "bookId": "book-id",
            "bookTitle": "Book",
        ])!

        XCTAssertEqual(parsed.key, "vocab:custom-key")
        XCTAssertEqual(parsed.word, "case")
        XCTAssertEqual(parsed.firstSeenAt, 0)
        XCTAssertEqual(parsed.lastSeenAt, 0)
    }

    private func testWord(
        key: String,
        word: String,
        language: String = "en",
        syncId: String,
        sourceUrl: String = "",
        partOfSpeech: String = "",
        definitions: [String] = [],
        translation: String? = nil,
        lookupCount: Int = 1,
        firstSeenAt: Int64 = 1_700_000_000_000,
        lastSeenAt: Int64,
        deleted: Bool = false
    ) -> VocabularyWord {
        VocabularyWord(
            key: key,
            word: word,
            language: language,
            syncId: syncId,
            bookId: "book-id",
            bookTitle: "Book",
            cfi: "cfi",
            contextSentence: "context",
            partOfSpeech: partOfSpeech,
            definitions: definitions,
            translation: translation,
            sourceUrl: sourceUrl,
            lookupCount: lookupCount,
            firstSeenAt: firstSeenAt,
            lastSeenAt: lastSeenAt,
            deleted: deleted
        )
    }
}
