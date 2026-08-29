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
