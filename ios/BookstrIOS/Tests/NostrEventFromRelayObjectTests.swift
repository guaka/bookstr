import XCTest

@testable import BookstrIOS

final class NostrEventFromRelayObjectTests: XCTestCase {
    func testFromRelayObjectConvertsNumericAndStringScalarsInEventFieldsAndTags() {
        let event = NostrEvent.fromRelayObject([
            "id": "evt-1",
            "kind": "30078",
            "created_at": "1700000000",
            "tags": [
                ["d", 42],
                [7, true, 1.5],
            ],
            "content": 123,
        ])

        let relayEvent = XCTUnwrap(event)
        XCTAssertEqual(relayEvent.id, "evt-1")
        XCTAssertEqual(relayEvent.kind, 30078)
        XCTAssertEqual(relayEvent.createdAt, 1_700_000_000)
        XCTAssertEqual(relayEvent.tags.count, 2)
        XCTAssertEqual(relayEvent.tags[0], ["d", "42"])
        XCTAssertEqual(relayEvent.tags[1], ["7", "true", "1.5"])
        XCTAssertEqual(relayEvent.content, "")
    }

    func testFromRelayObjectIgnoresNonArrayTagsAndDefaultsEmptyContent() {
        let event = NostrEvent.fromRelayObject([
            "id": "evt-2",
            "kind": 7,
            "created_at": 11,
            "tags": "not-an-array",
            "content": ["value": "invalid"],
        ])

        let relayEvent = XCTUnwrap(event)
        XCTAssertEqual(relayEvent.tags, [])
        XCTAssertEqual(relayEvent.content, "")
        XCTAssertEqual(relayEvent.dTag, nil)
    }

    func testFromRelayObjectFallsBackToDefaultsForInvalidKindValue() {
        let event = NostrEvent.fromRelayObject([
            "id": "evt-kind",
            "kind": "bad-kind",
            "created_at": 11,
            "content": 123,
            "tags": [["d", 1]],
        ])

        let relayEvent = XCTUnwrap(event)
        XCTAssertEqual(relayEvent.kind, 0)
        XCTAssertEqual(relayEvent.createdAt, 11)
        XCTAssertEqual(relayEvent.tags, [["d", "1"]])
    }

    func testFromRelayObjectParsesDecimalCreatedAtAsTruncatedInteger() {
        let event = NostrEvent.fromRelayObject([
            "id": "evt-created-at",
            "kind": "30078",
            "created_at": 1_700_000_001.9,
            "tags": [["d", 1]],
            "content": "payload",
        ])

        let relayEvent = XCTUnwrap(event)
        XCTAssertEqual(relayEvent.createdAt, 1_700_000_001)
        XCTAssertEqual(relayEvent.kind, 3_007_8)
    }

    func testFromRelayObjectDefaultsInvalidCreatedAtToZero() {
        let event = NostrEvent.fromRelayObject([
            "id": "evt-created-at",
            "kind": "30078",
            "created_at": "not-a-number",
            "tags": [[], ["d", 1]],
            "content": "payload",
        ])

        let relayEvent = XCTUnwrap(event)
        XCTAssertEqual(relayEvent.createdAt, 0)
        XCTAssertEqual(relayEvent.tags, [["d", "1"]])
    }

    func testFromRelayObjectParsesStringCreatedAt() {
        let event = NostrEvent.fromRelayObject([
            "id": "evt-created-at-string",
            "kind": "30078",
            "created_at": "1700000002",
            "tags": [["d", 1]],
            "content": "payload",
        ])

        let relayEvent = XCTUnwrap(event)
        XCTAssertEqual(relayEvent.createdAt, 1_700_000_002)
        XCTAssertEqual(relayEvent.kind, 30078)
    }
}
