import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class NostrClientProgressTests: XCTestCase {
    func testRelayQueryReportExtractsDTagValues() {
        let report = RelayQueryReport(
            relay: "wss://relay.example",
            events: [
                NostrEvent(
                    id: nil,
                    pubkey: nil,
                    createdAt: 0,
                    kind: 0,
                    tags: [["e", "x"], ["d", "app.bookstr.progress.book-id"], ["d", "other"]],
                    content: "",
                    sig: nil
                )
            ],
            finished: "ok",
            elapsedMs: 12,
            notices: [],
            error: nil
        )

        XCTAssertEqual(report.dTags, ["app.bookstr.progress.book-id", "other"])
    }

    func testRelayQueryReportReturnsEmptyDTagsWhenNoDTag() {
        let report = RelayQueryReport(
            relay: "wss://relay.example",
            events: [
                NostrEvent(
                    id: nil,
                    pubkey: nil,
                    createdAt: 0,
                    kind: 0,
                    tags: [["e", "event-id"], ["x", "note"]],
                    content: "",
                    sig: nil
                )
            ],
            finished: "ok",
            elapsedMs: 12,
            notices: [],
            error: nil
        )

        XCTAssertEqual(report.dTags, [])
    }

    func testParseProgressContentFallsBackWhenTopLevelProgressionIsBoolean() {
        let content = #"{"locator": {"progression": true, "cfi":"epubcfi(/6/42)"}, "updatedAt":"1700000000000"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.progression ?? -1, 0.0, accuracy: 0.0001)
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/42)")
        XCTAssertEqual(parsed?.updatedAt, 1_700_000_000_000)
    }

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

    func testProgressContentOmitsBlankMetadataFields() {
        let content = NostrClient.progressContent(
            bookId: "book-id",
            progression: 0.2,
            cfi: "epubcfi(/6/14)",
            title: " ",
            author: "",
            updatedAt: 1_700_000_000_010
        )
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "book-id")
        XCTAssertNil(parsed?.title)
        XCTAssertNil(parsed?.author)
    }

    func testProgressContentIncludesMetadataWhenProvided() {
        let content = NostrClient.progressContent(
            bookId: "book-id",
            progression: 0.2,
            cfi: "epubcfi(/6/14)",
            title: "Title",
            author: "Author",
            updatedAt: 1
        )
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "book-id")
        XCTAssertEqual(parsed?.title, "Title")
        XCTAssertEqual(parsed?.author, "Author")
        XCTAssertEqual(parsed?.updatedAt, 1)
    }

    func testProgressContentFallsBackToLegacyBookIdOnLocatorWithBlankBookId() {
        let content = #"{"locator":{"bookId":"","progression":0.42,"cfi":"epubcfi(/6/20)"}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback-book")

        XCTAssertEqual(parsed?.bookId, "fallback-book")
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/20)")
        XCTAssertEqual(parsed?.progression ?? -1, 0.42, accuracy: 0.0001)
    }

    func testProgressContentUsesTopLevelUpdatedAtStringInLegacyPayload() {
        let content = #"{"bookId":"legacy-book","progression":0.3,"cfi":"epubcfi(/6/12)","updatedAt":"1700000000123"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.updatedAt, 1_700_000_000_123)
        XCTAssertEqual(parsed?.bookId, "legacy-book")
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
        XCTAssertEqual(parsed?.progression ?? -1, 0.15, accuracy: 0.0001)
    }

    func testLocatorProgressionStringValueIsParsed() {
        let content = #"{"locator":{"progression":"0.77","cfi":"epubcfi(/6/4)"}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/4)")
        XCTAssertEqual(parsed?.progression ?? -1, 0.77, accuracy: 0.0001)
    }

    func testLocatorProgressionIntValueIsParsed() {
        let content = #"{"locator":{"progression":2,"cfi":"epubcfi(/6/12)"}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/12)")
        XCTAssertEqual(parsed?.progression ?? -1, 2.0, accuracy: 0.0001)
    }

    func testLocatorWithNonStringCfiFallsBackToEmptyCfi() {
        let content = #"{"locator":{"progression":0.15,"cfi":123}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "")
        XCTAssertEqual(parsed?.progression ?? -1, 0.15, accuracy: 0.0001)
    }

    func testLocatorParsesUpdatedAtAsString() {
        let content = #"{"locator":{"progression":0.77,"cfi":"epubcfi(/6/4)"}, "updatedAt":"1700000000000", "title":"Example"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/4)")
        XCTAssertEqual(parsed?.progression ?? -1, 0.77, accuracy: 0.0001)
        XCTAssertEqual(parsed?.title, "Example")
        XCTAssertEqual(parsed?.updatedAt, 1_700_000_000_000)
    }

    func testLegacyPayloadUsesFallbackBookIdAndDefaultsToZeroCfiForNonText() {
        let content = #"{"progression":0.2,"cfi":123}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.cfi, "")
        XCTAssertEqual(parsed?.progression ?? -1, 0.2, accuracy: 0.0001)
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

    func testLegacyProgressPreservesTitle() {
        let content = #"{"bookId":"book-legacy","progression":0.9,"cfi":"epubcfi(/6/2)","title":"Legacy title"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.title, "Legacy title")
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/2)")
        XCTAssertEqual(parsed?.progression ?? -1, 0.9, accuracy: 0.0001)
    }

    func testUsesAuthorsFallbackWhenAuthorFieldMissing() {
        let content = #"{"locator":{"progression":0.12,"cfi":"epubcfi"}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertNil(parsed?.title)
        XCTAssertNil(parsed?.author)
    }

    func testFetchLatestProgressReturnsNilWithInvalidRelayURL() async {
        let client = NostrClient()
        let event = await client.fetchLatestProgress(
            pubkey: "abc",
            bookId: "book-1",
            relays: ["not a valid url"]
        )

        XCTAssertNil(event)
    }

    func testFetchReplaceableReturnsNilWithInvalidRelayURL() async {
        let client = NostrClient()
        let event = await client.fetchReplaceable(
            pubkey: "abc",
            kind: NostrKinds.favorites,
            dTag: NostrKinds.favoritesDTag,
            relays: ["://bad"]
        )

        XCTAssertNil(event)
    }

    func testFetchApplicationDataReturnsEmptyWithInvalidRelayURL() async {
        let client = NostrClient()
        let events = await client.fetchApplicationData(pubkey: "abc", relays: [" "])

        XCTAssertEqual(events.count, 0)
    }

    func testFetchVocabularyReturnsEmptyWhenRelayIsInvalid() async {
        let client = NostrClient()
        let events = await client.fetchVocabulary(pubkey: "abc", relays: ["%%"])

        XCTAssertEqual(events.count, 0)
    }

    func testAcceptsAuthorsAliasFromMetadata() {
        let content = #"{"locator":{"progression":0.12,"cfi":"epubcfi"},"authors":"Alias Author"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")
        XCTAssertEqual(parsed?.author, "Alias Author")
    }

    func testProgressAcceptsUpdatedAtAsNumber() {
        let content = #"{"locator":{"progression":0.34,"cfi":"epubcfi"},"updatedAt":1700000000000}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.updatedAt, 1_700_000_000_000)
    }

    func testLegacyAuthorFieldWinsOverAuthorsAlias() {
        let content = #"{"progression":0.55,"cfi":"epubcfi","author":"Primary Author","authors":"Alias Author"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.author, "Primary Author")
    }

    func testProgressContentOmitsEmptyMetadataFields() {
        let content = NostrClient.progressContent(
            bookId: "book-2",
            progression: 0.25,
            cfi: "epubcfi(/6/10)",
            title: "",
            author: "   ",
            updatedAt: 1_700_000_000_123
        )
        let parsed = content.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }

        XCTAssertNotNil(parsed)
        XCTAssertNil(parsed?["title"])
        XCTAssertNil(parsed?["author"])
        XCTAssertEqual(parsed?["bookId"] as? String, "book-2")
    }

    func testLocatorProgressionFromNumberStringInTopLevelPayload() {
        let content = #"{"progression":"0.42","cfi":"epubcfi(/6/7)","author":"Top-level author"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.progression ?? -1, 0.42, accuracy: 0.0001)
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/7)")
        XCTAssertEqual(parsed?.author, "Top-level author")
    }

    func testProgressContentIgnoresNonStringUpdatedAtInLocatorPayload() {
        let content = #"{"locator":{"progression":0.5,"cfi":"epubcfi(/6/8)","updatedAt":"not-number"},"updatedAt":"not-number"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.progression ?? -1, 0.5, accuracy: 0.0001)
        XCTAssertNil(parsed?.updatedAt)
    }

    func testProgressContentParsesUpdatedAtFromNumericStringInsideLocatorPayload() {
        let content = #"{"locator":{"progression":0.5,"cfi":"epubcfi(/6/9)","updatedAt":"1700000000001"}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.updatedAt, 1_700_000_000_001)
    }

    func testProgressContentParsesNegativeUpdatedAtAsStringAsNil() {
        let content = #"{"locator":{"progression":0.5,"cfi":"epubcfi(/6/9)","updatedAt":"bad-number"}}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertNil(parsed?.updatedAt)
    }

    func testProgressContentReturnsNilForNonJsonPayload() {
        let parsed = NostrClient.parseProgressContent("not-json", fallbackBookId: "fallback")
        XCTAssertNil(parsed)
    }

    func testLocatorEmptyObjectDefaultsProgressionToZero() {
        let content = #"{"locator":{},"progression":"0.88","cfi":"legacy"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.progression ?? -1, 0.0, accuracy: 0.0001)
        XCTAssertEqual(parsed?.cfi, "")
    }

    func testParseProgressContentDropsMalformedUpdatedAt() {
        let content = #"{"locator":{"progression":0.33,"cfi":"epubcfi"},"updatedAt":"not-a-number"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "book-2")

        XCTAssertEqual(parsed?.bookId, "book-2")
        XCTAssertEqual(parsed?.progression ?? -1, 0.33, accuracy: 0.0001)
        XCTAssertNil(parsed?.updatedAt)
    }

    func testParseProgressContentFallsBackToLegacyWhenLocatorIsNotAnObject() {
        let content = #"{"locator":"x","progression":"0.6","cfi":"epubcfi(/6/10)"}"#
        let parsed = NostrClient.parseProgressContent(content, fallbackBookId: "fallback")

        XCTAssertEqual(parsed?.bookId, "fallback")
        XCTAssertEqual(parsed?.progression ?? -1, 0.6, accuracy: 0.0001)
        XCTAssertEqual(parsed?.cfi, "epubcfi(/6/10)")
    }
}
