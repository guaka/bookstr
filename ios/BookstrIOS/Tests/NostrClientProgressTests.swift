import Foundation
import Network
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class NostrClientProgressTests: XCTestCase {
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
    private func event(_ id: String?, createdAt: Int64, dTag: String? = nil) -> NostrEvent {
        NostrEvent(
            id: id, pubkey: "pubkey", createdAt: createdAt, kind: NostrKinds.progress,
            tags: dTag.map { [["d", $0]] } ?? [], content: "", sig: nil
        )
    }

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
        _ = NostrEvent.fromRelayObject([
            "created_at": Date(), "kind": Date(), "tags": [["x", Date()]]
        ])
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

    func testInjectedRelayQueriesCoverLatestDedupAndVocabularyFiltering() async {
        let older = event("same", createdAt: 1, dTag: NostrKinds.vocabularyPrefix + "old")
        let newer = event("same", createdAt: 3, dTag: NostrKinds.vocabularyPrefix + "new")
        let byDTag = event(nil, createdAt: 2, dTag: "other")
        let anonymous = event(nil, createdAt: 4)
        let client = NostrClient(queryOverride: { relay, _, _ in
            RelayQueryReport(
                relay: relay, events: relay == "wss://a" ? [older, byDTag] : [newer, byDTag, anonymous],
                finished: "eose", elapsedMs: 1, notices: [], error: nil
            )
        })

        let latest = await client.fetchLatestProgress(pubkey: "PUBKEY", bookId: "book", relays: ["wss://b", "wss://a"])
        XCTAssertEqual(latest?.createdAt, 4)
        let application = await client.fetchApplicationData(pubkey: "PUBKEY", relays: ["wss://a", "wss://b"])
        XCTAssertTrue(application.contains { $0.id == "same" && $0.createdAt == 3 })
        XCTAssertEqual(application.filter { $0.dTag == "other" }.count, 1)
        let vocabulary = await client.fetchVocabulary(pubkey: "PUBKEY", relays: ["wss://a", "wss://b"])
        XCTAssertEqual(vocabulary.map(\.id), ["same"])
    }

    func testInjectedFavoriteQueriesCoverTaggedAndFallbackResults() async {
        let favorite = event("favorite", createdAt: 20, dTag: NostrKinds.favoritesDTag)
        let tagged = NostrClient(queryOverride: { relay, subscription, filter in
            XCTAssertEqual((filter["authors"] as? [String])?.first, "pubkey")
            return RelayQueryReport(
                relay: relay, events: subscription == "bookstr-favorites" ? [favorite] : [],
                finished: "eose", elapsedMs: 1, notices: [], error: nil
            )
        })
        let direct = await tagged.fetchLatestFavorites(pubkey: "PUBKEY", relays: ["wss://custom"])
        XCTAssertEqual(direct.event?.id, "favorite")
        XCTAssertFalse(direct.fallbackUsed)
        XCTAssertEqual(direct.reports.map(\.relay), ["wss://custom", NostrClient.defaultInteropRelay].sorted())

        let fallback = NostrClient(queryOverride: { relay, subscription, _ in
            RelayQueryReport(
                relay: relay,
                events: subscription == "bookstr-favorites-all"
                    ? [self.event("wrong", createdAt: 30, dTag: "wrong"), favorite] : [],
                finished: "eose", elapsedMs: 1, notices: [], error: nil
            )
        })
        let recovered = await fallback.fetchLatestFavorites(pubkey: "PUBKEY", relays: [])
        XCTAssertEqual(recovered.event?.id, "favorite")
        XCTAssertTrue(recovered.fallbackUsed)
        XCTAssertEqual(recovered.reports.count, 2)
    }

    func testInjectedReplaceableAndPublisherCoverSuccessAndFailure() async {
        let older = event("old", createdAt: 1, dTag: "target")
        let newer = event("new", createdAt: 2, dTag: "target")
        let client = NostrClient(
            queryOverride: { relay, _, _ in
                RelayQueryReport(relay: relay, events: [older, newer], finished: "eose", elapsedMs: 0, notices: [], error: nil)
            },
            publishOverride: { _, relay in relay.hasSuffix("accept") }
        )
        let replaceable = await client.fetchReplaceable(pubkey: "PUBKEY", kind: 30_078, dTag: "target", relays: [])
        XCTAssertEqual(replaceable?.id, "new")
        let accepted = await client.publishEvent(newer, relays: ["wss://reject", "wss://accept"])
        let rejected = await client.publishEvent(newer, relays: [])
        XCTAssertTrue(accepted)
        XCTAssertFalse(rejected)
    }

    func testLocalWebSocketRelayExercisesQueryAndPublishProtocol() async throws {
        let relayEvent = NostrEvent(
            id: "relay-event", pubkey: "pubkey", createdAt: 42, kind: NostrKinds.progress,
            tags: [["d", NostrKinds.progressDTag(bookId: "book")]], content: "{}", sig: "sig"
        )
        let relay = try await LocalWebSocketRelay(event: relayEvent).start()
        let client = NostrClient()
        let relayURL = await relay.url
        let url = try XCTUnwrap(relayURL)

        let fetched = await client.fetchLatestProgress(pubkey: "pubkey", bookId: "book", relays: [url])
        let queryMessages = await relay.receivedMessages()
        XCTAssertEqual(fetched?.id, "relay-event")
        XCTAssertTrue(queryMessages.contains { $0.contains("\"REQ\"") })

        let accepted = await client.publishEvent(relayEvent, relays: [url])
        let publishMessages = await relay.receivedMessages()
        XCTAssertTrue(accepted)
        XCTAssertTrue(publishMessages.contains { $0.contains("\"EVENT\"") })
        await relay.stop()

        let rejectingRelay = try await LocalWebSocketRelay(event: relayEvent, publishAccepted: false).start()
        let optionalRejectingURL = await rejectingRelay.url
        let rejectingURL = try XCTUnwrap(optionalRejectingURL)
        let rejected = await client.publishEvent(relayEvent, relays: [rejectingURL])
        XCTAssertFalse(rejected)
        await rejectingRelay.stop()
    }

    func testLocalSilentRelayExercisesReceiveTimeout() async throws {
        let event = NostrEvent(id: "event", pubkey: "pubkey", createdAt: 1, kind: 1, tags: [], content: "", sig: nil)
        let relay = try await LocalWebSocketRelay(event: event, respondToQueries: false).start()
        let optionalURL = await relay.url
        let url = try XCTUnwrap(optionalURL)
        let fetched = await NostrClient().fetchLatestProgress(pubkey: "pubkey", bookId: "book", relays: [url])
        XCTAssertNil(fetched)
        await relay.stop()
    }
}

private actor LocalWebSocketRelay {
    private let event: NostrEvent
    private let publishAccepted: Bool
    private let respondToQueries: Bool
    private var listener: NWListener?
    private var messages: [String] = []

    init(event: NostrEvent, publishAccepted: Bool = true, respondToQueries: Bool = true) {
        self.event = event
        self.publishAccepted = publishAccepted
        self.respondToQueries = respondToQueries
    }

    var url: String? {
        guard let port = listener?.port else { return nil }
        return "ws://127.0.0.1:\(port.rawValue)"
    }

    func start() async throws -> LocalWebSocketRelay {
        let parameters = NWParameters.tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(NWProtocolWebSocket.Options(), at: 0)
        let listener = try NWListener(using: parameters, on: .any)
        self.listener = listener
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { return }
            connection.start(queue: .global(qos: .userInitiated))
            self.receive(on: connection)
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    continuation.resume()
                case .failed(let error):
                    continuation.resume(throwing: error)
                default:
                    break
                }
            }
            listener.start(queue: .global(qos: .userInitiated))
        }
        return self
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    func receivedMessages() -> [String] { messages }

    nonisolated private func receive(on connection: NWConnection) {
        connection.receiveMessage { [weak self] data, _, _, error in
            guard let self else { return }
            if let data, let text = String(data: data, encoding: .utf8) {
                Task { await self.handle(text, connection: connection) }
            } else if error == nil {
                self.receive(on: connection)
            }
        }
    }

    private func handle(_ text: String, connection: NWConnection) {
        messages.append(text)
        if text.contains("\"REQ\"") {
            guard respondToQueries else {
                receive(on: connection)
                return
            }
            send("[\"NOTICE\",\" local relay ready \"]", on: connection)
            let object = (try? JSONEncoder().encode(event))
                .flatMap { try? JSONSerialization.jsonObject(with: $0) }
            let payload = object.flatMap { try? JSONSerialization.data(withJSONObject: ["EVENT", "subscription", $0]) }
                .flatMap { String(data: $0, encoding: .utf8) }
            if let payload { send(payload, on: connection) }
            send("[\"EOSE\",\"subscription\"]", on: connection)
        } else if text.contains("\"EVENT\"") {
            if publishAccepted {
                send("[\"OK\",\"event\",true,\"accepted\"]", on: connection)
            } else {
                for index in 0..<8 {
                    send("[\"NOTICE\",\"rejected \(index)\"]", on: connection)
                }
            }
        }
        receive(on: connection)
    }

    nonisolated private func send(_ text: String, on connection: NWConnection) {
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: UUID().uuidString, metadata: [metadata])
        connection.send(content: Data(text.utf8), contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
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
