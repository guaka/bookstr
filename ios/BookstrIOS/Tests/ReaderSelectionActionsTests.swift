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
        XCTAssertTrue(ReaderSelectionActions.offersSpeech(for: "hello"))
        XCTAssertTrue(ReaderSelectionActions.offersSpeech(for: "A longer marked passage here."))
        XCTAssertFalse(ReaderSelectionActions.offersSpeech(for: "   "))
        XCTAssertEqual(ReaderSelectionActions.extraItems(for: "hello", allowsSpeech: true), [.addWord, .mark, .readFromHere])
        XCTAssertEqual(ReaderSelectionActions.extraItems(for: "hello", allowsSpeech: false), [.addWord, .mark])
        XCTAssertEqual(
            ReaderSelectionActions.extraItems(for: "one two three", allowsSpeech: true),
            [.mark, .readFromHere]
        )
        XCTAssertEqual(ReaderSelectionActions.extraItems(for: "one two three", allowsSpeech: false), [.mark])
        XCTAssertEqual(ReaderSelectionActions.extraItems(for: "   ", allowsSpeech: true), [])
        XCTAssertEqual(
            ReaderSelectionActions.menuItems(for: "   ", allowsSpeech: true),
            [.addWord, .mark, .readFromHere]
        )
        XCTAssertEqual(ReaderSelectionActions.menuItems(for: "   ", allowsSpeech: false), [.addWord, .mark])
        XCTAssertEqual(ReaderSelectionActions.phraseForVocabulary(from: "  Hello  World  "), "Hello World")
        XCTAssertNil(ReaderSelectionActions.phraseForVocabulary(from: "one two three"))
    }

    func testRejectsNonWordTokensAsVocabularyPhrases() {
        XCTAssertEqual(ReaderSelectionActions.kind(for: "hello 123"), .mark)
        XCTAssertEqual(ReaderSelectionActions.kind(for: "42"), .mark)
    }
}
