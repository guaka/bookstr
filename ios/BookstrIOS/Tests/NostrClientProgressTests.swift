import XCTest
@testable import BookstrIOS

final class NostrClientProgressTests: XCTestCase {
    func testProgressContentRoundTrip() {
        let content = NostrClient.progressContent(
            bookId: "book-1",
            progression: 0.42,
            cfi: "epubcfi(/6/2)",
            title: "Example",
            author: "Author",
            updatedAt: 1_700_000_000_000
        )
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertNotNil(parsed)
        XCTAssertEqual(parsed?.bookId, "book-1")
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/2)")
        XCTAssertEqual(parsed!.progression, 0.42, accuracy: 0.0001)
        XCTAssertEqual(parsed?.title, "Example")
        XCTAssertEqual(parsed?.author, "Author")
        XCTAssertEqual(parsed?.updatedAt, 1_700_000_000_000)
    }

    func testLegacyProgressFormatParses() {
        let content = #"{"progression":0.9,"cfi":"x"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "legacy-book")
        XCTAssertEqual(parsed?.bookId, "legacy-book")
        XCTAssertEqual(parsed?.cfi, "x")
        XCTAssertEqual(parsed!.progression, 0.9, accuracy: 0.0001)
    }

    func testLegacyProgressAcceptsStringProgression() {
        let content = #"{"progression":"0.9","cfi":"x"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "legacy-book")
        XCTAssertEqual(parsed?.bookId, "legacy-book")
        XCTAssertEqual(parsed?.cfi, "x")
        XCTAssertEqual(parsed!.progression, 0.9, accuracy: 0.0001)
    }

    func testLegacyProgressFallsBackInvalidProgressionToZero() {
        let content = #"{"progression":"not-a-number","cfi":"x"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "legacy-book")
        XCTAssertEqual(parsed?.bookId, "legacy-book")
        XCTAssertEqual(parsed?.cfi, "x")
        XCTAssertEqual(parsed!.progression, 0.0, accuracy: 0.0001)
    }

    func testLegacyProgressDefaultsToZeroWhenProgressionMissing() {
        let content = #"{"cfi":"epubcfi(/6/2)"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "legacy-book")
        XCTAssertEqual(parsed?.bookId, "legacy-book")
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/2)")
        XCTAssertEqual(parsed!.progression, 0.0, accuracy: 0.0001)
    }

    func testLegacyProgressDefaultsEmptyCfiWhenCfiIsNonString() {
        let content = #"{"progression":0.9,"cfi":123}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "legacy-book")
        XCTAssertEqual(parsed?.bookId, "legacy-book")
        XCTAssertEqual(parsed?.cfi, "")
        XCTAssertEqual(parsed!.progression, 0.9, accuracy: 0.0001)
    }

    func testLocatorWithoutCfiDefaultsToEmptyString() {
        let content = #"{"locator":{"progression":0.15},"cfi":"should-ignore"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "")
        XCTAssertEqual(parsed?.progression, 0.15, accuracy: 0.0001)
    }

    func testLocatorProgressionStringValueIsParsed() {
        let content = #"{"locator":{"progression":"0.77","cfi":"epubcfi(/6/4)"}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/4)")
        XCTAssertEqual(parsed?.progression, 0.77, accuracy: 0.0001)
    }

    func testLocatorWithNonStringCfiFallsBackToEmptyCfi() {
        let content = #"{"locator":{"progression":0.15,"cfi":123}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "")
        XCTAssertEqual(parsed?.progression, 0.15, accuracy: 0.0001)
    }

    func testLocatorParsesUpdatedAtAsString() {
        let content = #"{"locator":{"progression":0.77,"cfi":"epubcfi(/6/4)"}, "updatedAt":"1700000000000", "title":"Example"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/4)")
        XCTAssertEqual(parsed?.progression, 0.77, accuracy: 0.0001)
        XCTAssertEqual(parsed?.title, "Example")
        XCTAssertEqual(parsed?.updatedAt, 1_700_000_000_000)
    }

    func testLegacyPayloadUsesFallbackBookIdAndDefaultsToZeroCfiForNonText() {
        let content = #"{"progression":0.2,"cfi":123}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "")
        XCTAssertEqual(parsed?.progression, 0.2, accuracy: 0.0001)
    }

    func testLocatorMustBeAnObject() {
        let content = #"{"locator":"not-an-object","progression":0.99,"cfi":"ignored"}"#
        XCTAssertNil(NostrClient.parseProgressContent(content, fallbackBookId: "fallback"))
    }

    func testLocatorUsesFallbackBookIdWhenBookIdBlank() {
        let content = #"{"bookId":"","locator":{"progression":0.33,"cfi":"epubcfi(/6/3)"}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertEqual(parsed?.bookId, "fallback")
    }

    func testUpdatedAtFallsBackToNilForMissingOrInvalidValue() {
        XCTAssertNil(NostrClient.parseProgressContent(#"{"locator":{"progression":0.2,"cfi":"x"}}"#, fallbackBookId: "fallback")?.updatedAt)
        XCTAssertNil(NostrClient.parseProgressContent(#"{"locator":{"progression":0.2,"cfi":"x"},"updatedAt":"bad"}"#, fallbackBookId: "fallback")?.updatedAt)
    }

    func testRejectsInvalidPayloadWithoutLocationOrProgression() {
        XCTAssertNil(NostrClient.parseProgressContent(#"{"bookId":"book-1","foo":"bar"}"#, fallbackBookId: "fallback"))
        XCTAssertNil(NostrClient.parseProgressContent("null", fallbackBookId: "fallback"))
        XCTAssertNil(NostrClient.parseProgressContent("not-json", fallbackBookId: "fallback"))
    }

    func testUsesAuthorsFallbackWhenAuthorFieldMissing() {
        let content = #"{"locator":{"progression":0.12,"cfi":"epubcfi"}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertNil(parsed?.title)
        XCTAssertNil(parsed?.author)
    }

    func testAcceptsAuthorsAliasFromMetadata() {
        let content = #"{"locator":{"progression":0.12,"cfi":"epubcfi"},"authors":"Alias Author"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertEqual(parsed?.author, "Alias Author")
    }
}
