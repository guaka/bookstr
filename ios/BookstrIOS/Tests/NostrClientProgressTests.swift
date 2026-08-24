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

    func testRejectsInvalidPayloadWithoutLocationOrProgression() {
        XCTAssertNil(NostrClient.parseProgressContent(#"{"bookId":"book-1","foo":"bar"}"#, fallbackBookId: "fallback"))
        XCTAssertNil(NostrClient.parseProgressContent("null", fallbackBookId: "fallback"))
        XCTAssertNil(NostrClient.parseProgressContent("not-json", fallbackBookId: "fallback"))
    }

    func testUsesAuthorsFallbackWhenAuthorFieldMissing() {
        let content = #"{"locator":{"progression":0.12,"cfi":"epubcfi"}}"
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
