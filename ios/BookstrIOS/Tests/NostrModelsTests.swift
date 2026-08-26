import XCTest
@testable import BookstrIOS

final class NostrModelsTests: XCTestCase {
    func testProgressTagBuilderIsStable() {
        let bookId = "abc123"
        XCTAssertEqual(NostrKinds.progressDTag(bookId: bookId), "app.bookstr.progress.abc123")
    }

    func testFavoritesChunkTagBuilderUsesDefaults() {
        XCTAssertEqual(NostrKinds.favoritesChunkDTag(index: 7), "libvault-favorites-chunk-7")
    }

    func testFavoritesChunkTagBuilderAcceptsCustomPrefix() {
        XCTAssertEqual(NostrKinds.favoritesChunkDTag(prefix: "custom-prefix", index: 2), "custom-prefix-2")
    }

    func testDTagReadsFirstTagOnly() {
        let event = NostrEvent(id: nil, pubkey: nil, createdAt: 1, kind: 1, tags: [["x", "other"], ["d", "keep-this"], ["d", "ignore"]], content: "", sig: nil)
        XCTAssertEqual(event.dTag, "keep-this")
    }

    func testFromRelayObjectAcceptsMissingFieldsAndConvertsNumbers() {
        let event = NostrEvent.fromRelayObject([
            "kind": "30078",
            "created_at": "1710000000",
            "tags": [["d", "libvault-favorites"], [1, "second"]]
        ])

        XCTAssertNotNil(event)
        XCTAssertEqual(event?.kind, 30078)
        XCTAssertEqual(event?.createdAt, 1_710_000_000)
        XCTAssertEqual(event?.dTag, "libvault-favorites")
        XCTAssertEqual(event?.tags[1], ["1", "second"])
        XCTAssertEqual(event?.id, nil)
        XCTAssertEqual(event?.content, "")
    }

    func testFromRelayObjectHandlesEmptyOrInvalidEvents() {
        XCTAssertNil(NostrEvent.fromRelayObject(["kind": "bad", "created_at": []]))
        XCTAssertNotNil(NostrEvent.fromRelayObject(["kind": 10, "created_at": 123, "content": 42]))
    }

    func testFromRelayObjectDefaultsMissingFieldsToZeroAndEmptyContent() {
        let event = NostrEvent.fromRelayObject(["tags": [["x", "y"]]])

        let relayEvent = XCTUnwrap(event)
        XCTAssertNil(relayEvent.id)
        XCTAssertNil(relayEvent.pubkey)
        XCTAssertEqual(relayEvent.createdAt, 0)
        XCTAssertEqual(relayEvent.kind, 0)
        XCTAssertEqual(relayEvent.content, "")
        XCTAssertEqual(relayEvent.tags, [["x", "y"]])
    }

    func testFromRelayObjectRejectsNonArrayTagsAndReadsNumericTagParts() {
        let payload: [String: Any] = [
            "kind": "30078",
            "created_at": 1_710_000_001,
            "content": "",
            "tags": [
                ["d", 42],
                "junk",
                ["kind", 1]
            ]
        ]

        let event = NostrEvent.fromRelayObject(payload)
        XCTAssertNotNil(event)
        XCTAssertEqual(event?.tags.first, ["d", "42"])
    }

    func testFromRelayObjectSkipsEmptyTagRows() {
        let event = NostrEvent.fromRelayObject([
            "kind": 1,
            "created_at": 1_710_000_002,
            "tags": [
                ["x", "1"],
                [],
                ["y", "2"],
            ],
        ])

        let relayEvent = XCTUnwrap(event)
        XCTAssertEqual(relayEvent.tags, [["x", "1"], ["y", "2"]])
    }

    func testDTagNilWhenMissingDTag() {
        let event = NostrEvent(
            id: nil,
            pubkey: nil,
            createdAt: 1,
            kind: 1,
            tags: [["x", "y"]],
            content: "",
            sig: nil
        )

        XCTAssertNil(event.dTag)
    }
}
