import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class ReaderSelectionActionsTests: XCTestCase {
    func testClassifiesEmptyOneTwoAndLongerSelections() {
        XCTAssertEqual(ReaderSelectionActions.kind(for: "   "), .empty)
        XCTAssertEqual(ReaderSelectionActions.kind(for: "hello"), .words("hello"))
        XCTAssertEqual(ReaderSelectionActions.kind(for: "don't worry"), .words("don't worry"))
        XCTAssertEqual(ReaderSelectionActions.kind(for: "well-known fact"), .words("well-known fact"))
        XCTAssertEqual(ReaderSelectionActions.kind(for: "one two three"), .mark)
        XCTAssertTrue(ReaderSelectionActions.offersMark(for: "A longer marked passage here."))
        XCTAssertEqual(ReaderSelectionActions.phraseForVocabulary(from: "  Hello  World  "), "Hello World")
        XCTAssertNil(ReaderSelectionActions.phraseForVocabulary(from: "one two three"))
    }

    func testRejectsNonWordTokensAsVocabularyPhrases() {
        XCTAssertEqual(ReaderSelectionActions.kind(for: "hello 123"), .mark)
        XCTAssertEqual(ReaderSelectionActions.kind(for: "42"), .mark)
    }
}
