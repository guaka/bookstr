import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class NostrClientProgressTests: XCTestCase {
    func testSharedBlossomAuthorizationV1Fixtures() throws {
        let fixture = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: blossomAuthorizationFixtureURL())) as? [String: Any]
        )
        XCTAssertEqual(fixture["version"] as? Int, 1)
        for entry in try XCTUnwrap(fixture["cases"] as? [[String: Any]]) {
            let name = try XCTUnwrap(entry["name"] as? String)
            let request = try? BlossomAuthorizationWire.unsignedGetEvent(
                hash: try XCTUnwrap(entry["hash"] as? String),
                server: try XCTUnwrap(entry["server"] as? String),
                now: try XCTUnwrap(entry["now"] as? Int64 ?? (entry["now"] as? NSNumber)?.int64Value),
                content: try XCTUnwrap(entry["content"] as? String)
            )
            guard entry["valid"] as? Bool == true else {
                XCTAssertNil(request, name)
                continue
            }
            let value = try XCTUnwrap(request, name)
            let actual: [String: Any] = [
                "kind": value.kind,
                "created_at": value.createdAt,
                "tags": value.tags,
                "content": value.content,
            ]
            XCTAssertTrue(
                NSDictionary(dictionary: actual).isEqual(to: try XCTUnwrap(entry["expected"] as? [String: Any])),
                name
            )
        }
    }

    private func blossomAuthorizationFixtureURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("shared/fixtures/blossom-authorization-v1.json")
    }

    func testProgressRoundTripsRightsMetadata() throws {
        let content = NostrClient.progressContent(
            bookId: "book", progression: 0.4, cfi: "cfi", title: "Open", author: "Author", updatedAt: 1,
            rights: BookRights(status: .openLicense, license: "CC BY 4.0", licenseURL: nil, source: "catalog")
        )
        let rights = NostrClient.parseProgressRights(content)
        XCTAssertEqual(rights.status, .openLicense)
        XCTAssertEqual(rights.license, "CC BY 4.0")
        XCTAssertEqual(rights.source, "catalog")
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

    func testFetchLatestProgressReturnsNilForEmptyRelayList() async {
        let client = NostrClient()
        let event = await client.fetchLatestProgress(pubkey: "abc", bookId: "book-id", relays: [])

        XCTAssertNil(event)
    }

    func testFetchVocabularyReturnsEmptyForEmptyRelayList() async {
        let client = NostrClient()
        let events = await client.fetchVocabulary(pubkey: "abc", relays: [])

        XCTAssertTrue(events.isEmpty)
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

    func testRelaySessionFailsFastWithoutWaitingForConnectivity() {
        let config = NostrClient.makeRelaySessionConfiguration()
        XCTAssertFalse(config.waitsForConnectivity)
        XCTAssertEqual(config.timeoutIntervalForRequest, NostrClient.queryRequestTimeout)
        XCTAssertEqual(config.timeoutIntervalForResource, NostrClient.queryResourceTimeout)
        XCTAssertLessThanOrEqual(config.timeoutIntervalForRequest, 15)
        XCTAssertLessThanOrEqual(config.timeoutIntervalForResource, 20)
    }

    func testPullCooldownSkipsRecentSyncsUnlessForced() {
        let now = Date(timeIntervalSince1970: 2_000)
        let recent = Date(timeIntervalSince1970: 1_950)
        let stale = Date(timeIntervalSince1970: 1_000)

        XCTAssertTrue(NostrPullCooldown.shouldSkip(lastSync: recent, now: now))
        XCTAssertFalse(NostrPullCooldown.shouldSkip(lastSync: recent, now: now, force: true))
        XCTAssertFalse(NostrPullCooldown.shouldSkip(lastSync: stale, now: now))
        XCTAssertFalse(NostrPullCooldown.shouldSkip(lastSync: nil, now: now))
        XCTAssertTrue(NostrPullCooldown.shouldSkip(lastSyncs: [stale, recent], now: now))
        XCTAssertFalse(NostrPullCooldown.shouldSkip(lastSyncs: [stale, nil], now: now))
    }
}

final class NostrModelCoverageTests: XCTestCase {
    func testRelayObjectParserHandlesSupportedScalarRepresentations() {
        let numeric = NostrEvent.fromRelayObject([
            "id": "event-id",
            "pubkey": "pubkey",
            "created_at": NSNumber(value: 42),
            "kind": NSNumber(value: 1),
            "content": "content",
            "tags": [["d", "topic"]],
            "sig": "signature"
        ])
        XCTAssertEqual(numeric?.dTag, "topic")

        let strings = NostrEvent.fromRelayObject([
            "created_at": "43",
            "kind": "1",
            "content": 123,
            "tags": [["p", "person"]],
            "sig": 456
        ])
        XCTAssertNil(strings?.dTag)

        _ = NostrEvent.fromRelayObject([
            "created_at": 44.5,
            "kind": true,
            "tags": ["malformed"]
        ])
    }
}

final class NostrCoverageExpansionTests: XCTestCase {
    func testModelHelpersCoverScalarAndTagRepresentations() {
        XCTAssertFalse(NostrKinds.progressDTag(bookId: "book").isEmpty)
        XCTAssertFalse(NostrKinds.favoritesChunkDTag(index: 1).isEmpty)
        XCTAssertFalse(NostrKinds.favoritesChunkDTag(prefix: "custom", index: 2).isEmpty)

        let values: [Any] = [Int64(1), Int(2), 3.5, NSNumber(value: 4), "5"]
        for value in values {
            _ = NostrEvent.fromRelayObject([
                "created_at": value,
                "kind": value,
                "content": value,
                "tags": [["d", "topic", value]],
                "sig": value
            ])
        }
        let event = NostrEvent.fromRelayObject([
            "created_at": 6,
            "kind": 1,
            "tags": [["d", "topic"], [], ["p", "person", true], "malformed"]
        ])
        XCTAssertEqual(event?.dTag, "topic")
        _ = NostrEvent.fromRelayObject(["created_at": true, "kind": true, "tags": ["malformed"]])
    }

    func testInvalidRelayURLsReturnWithoutEvents() async {
        let client = NostrClient()
        let relay = ["https://relay.example"]
        let progress = await client.fetchLatestProgress(pubkey: "pubkey", bookId: "book", relays: relay)
        let vocabulary = await client.fetchVocabulary(pubkey: "pubkey", relays: relay)
        let applicationData = await client.fetchApplicationData(pubkey: "pubkey", relays: relay)
        let event = NostrEvent(id: nil, pubkey: nil, createdAt: 1, kind: 1, tags: [], content: "", sig: nil)
        let published = await client.publishEvent(event, relays: relay)
        XCTAssertNil(progress)
        XCTAssertTrue(vocabulary.isEmpty)
        XCTAssertTrue(applicationData.isEmpty)
        XCTAssertFalse(published)
    }
}

final class NostrPureFunctionCoverageTests: XCTestCase {
    func testProgressRightsAndTimestampFallbacks() {
        let rightsContent = NostrClient.progressContent(
            bookId: "book", progression: 0.2, cfi: "cfi", furthestProgression: 0.1,
            title: "Title", author: "Author", updatedAt: 12,
            rights: BookRights(status: .openLicense, license: "CC BY", licenseURL: "https://license", source: "catalog")
        )
        XCTAssertEqual(NostrClient.parseProgressRights(rightsContent).licenseURL, "https://license")
        XCTAssertEqual(NostrClient.parseProgressRights(#"{"rights":"CC0","license_url":"https://cc0"}"#).license, "CC0")
        XCTAssertEqual(NostrClient.parseProgressRights("not-json").status, .unknown)

        XCTAssertEqual(NostrClient.parseFurthestProgression("not-json", fallback: 0.4), 0.4)
        XCTAssertEqual(NostrClient.parseFurthestProgression(#"{"furthestProgression":0.2}"#, fallback: 0.4), 0.4)
        XCTAssertEqual(NostrClient.parseFurthestProgression(#"{"locator":{"furthestProgression":"0.8"}}"#, fallback: 0.4), 0.8)
        XCTAssertEqual(NostrClient.parseFurthestProgression(#"{"furthestProgression":0.9}"#, fallback: 0.4), 0.9)

        XCTAssertEqual(NostrClient.parseProgressUpdatedAt("not-json", eventCreatedAtSeconds: 12), 12_000)
        XCTAssertEqual(NostrClient.parseProgressUpdatedAt(#"{"updatedAt":0}"#, eventCreatedAtSeconds: 12), 12_000)
        XCTAssertEqual(NostrClient.parseProgressUpdatedAt(#"{"updatedAt":"15"}"#, eventCreatedAtSeconds: 12), 15)
    }

    func testRelayReportCollectsDTags() {
        let event = NostrEvent(id: "id", pubkey: "pubkey", createdAt: 1, kind: 1, tags: [["d", "one"], ["p", "two"]], content: "", sig: nil)
        let report = RelayQueryReport(relay: "relay", events: [event], finished: "eose", elapsedMs: 1, notices: [], error: nil)
        XCTAssertEqual(report.dTags, ["one"])
    }

    func testConnectionRefusalExercisesSocketErrorPaths() async {
        let client = NostrClient()
        let relay = ["ws://127.0.0.1:1"]
        let progress = await client.fetchLatestProgress(pubkey: "pubkey", bookId: "book", relays: relay)
        XCTAssertNil(progress)
        let event = NostrEvent(id: nil, pubkey: nil, createdAt: 1, kind: 1, tags: [], content: "", sig: nil)
        let published = await client.publishEvent(event, relays: relay)
        XCTAssertFalse(published)
    }
}
