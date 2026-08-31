import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class WordSortOrderingTests: XCTestCase {
    func testRecentlyAddedDiffersFromRecentlySeen() {
        let olderAddedSeenLately = word("alpha", firstSeenAt: 100, lastSeenAt: 400)
        let newerAddedSeenEarlier = word("beta", firstSeenAt: 300, lastSeenAt: 350)
        let words = [olderAddedSeenLately, newerAddedSeenEarlier]

        XCTAssertEqual(
            sortVocabularyWords(words, by: .recent).map(\.word),
            ["alpha", "beta"]
        )
        XCTAssertEqual(
            sortVocabularyWords(words, by: .recentlyAdded).map(\.word),
            ["beta", "alpha"]
        )
        XCTAssertEqual(
            sortVocabularyWords(words, by: .firstSaved).map(\.word),
            ["alpha", "beta"]
        )
    }

    func testSortLabelsDistinguishRecentlyAddedFromRecentlySeen() {
        XCTAssertEqual(WordSortKey.recent.label, "Recently seen")
        XCTAssertEqual(WordSortKey.recentlyAdded.label, "Recently added")
        XCTAssertNotEqual(WordSortKey.recent.label, WordSortKey.recentlyAdded.label)
    }

    private func word(_ value: String, firstSeenAt: Int64, lastSeenAt: Int64) -> VocabularyWord {
        VocabularyWord(
            key: "en:\(value)",
            word: value,
            language: "en",
            syncId: value,
            bookId: "book",
            bookTitle: "Book",
            cfi: "",
            contextSentence: "",
            partOfSpeech: "",
            definitions: [],
            translation: nil,
            sourceUrl: "",
            lookupCount: 1,
            firstSeenAt: firstSeenAt,
            lastSeenAt: lastSeenAt,
            deleted: false
        )
    }
}

final class WordSortOrderingCoverageTests: XCTestCase {
    func testEveryOrderingExposesLabels() {
        let orderings: [WordSortKey] = [
            .recent,
            .recentlyAdded,
            .alphabetical,
            .book,
            .mostSeen,
            .firstSaved
        ]

        for ordering in orderings {
            XCTAssertEqual(ordering.id, ordering.rawValue)
            XCTAssertFalse(ordering.label.isEmpty)
            XCTAssertFalse(ordering.shortLabel.isEmpty)
        }
    }
}

final class WordSortComparisonCoverageTests: XCTestCase {
    func testSortVocabularyWordsCoversEveryComparator() {
        let words = [
            word("alpha", bookTitle: "Zoo", lookupCount: 1, firstSeenAt: 100, lastSeenAt: 400),
            word("beta", bookTitle: "Alpha", lookupCount: 3, firstSeenAt: 300, lastSeenAt: 200),
            word("gamma", bookTitle: "Alpha", lookupCount: 2, firstSeenAt: 200, lastSeenAt: 300)
        ]

        XCTAssertEqual(sortVocabularyWords(words, by: .recent).map(\.word), ["alpha", "gamma", "beta"])
        XCTAssertEqual(sortVocabularyWords(words, by: .recentlyAdded).map(\.word), ["beta", "gamma", "alpha"])
        XCTAssertEqual(sortVocabularyWords(words, by: .alphabetical).map(\.word), ["alpha", "beta", "gamma"])
        XCTAssertEqual(sortVocabularyWords(words, by: .book).map(\.word), ["beta", "gamma", "alpha"])
        XCTAssertEqual(sortVocabularyWords(words, by: .mostSeen).map(\.word), ["beta", "gamma", "alpha"])
        XCTAssertEqual(sortVocabularyWords(words, by: .firstSaved).map(\.word), ["alpha", "gamma", "beta"])
    }

    private func word(
        _ value: String,
        bookTitle: String,
        lookupCount: Int,
        firstSeenAt: Int64,
        lastSeenAt: Int64
    ) -> VocabularyWord {
        VocabularyWord(
            key: "en:\(value)",
            word: value,
            language: "en",
            syncId: value,
            bookId: bookTitle,
            bookTitle: bookTitle,
            cfi: "",
            contextSentence: "",
            partOfSpeech: "",
            definitions: [],
            translation: nil,
            sourceUrl: "",
            lookupCount: lookupCount,
            firstSeenAt: firstSeenAt,
            lastSeenAt: lastSeenAt,
            deleted: false
        )
    }
}
