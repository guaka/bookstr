import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class ReadingProgressV2ContractTests: XCTestCase {
    func testIOSProgressAdapterConformsToEverySharedV2Case() throws {
        let fixture = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL())) as? [String: Any]
        )
        XCTAssertEqual(fixture["version"] as? Int, 2)
        let cases = try XCTUnwrap(fixture["cases"] as? [[String: Any]])
        for entry in cases {
            let name = try XCTUnwrap(entry["name"] as? String)
            let object = try XCTUnwrap(entry["content"] as? [String: Any])
            let fallbackBookId = try XCTUnwrap(entry["fallbackBookId"] as? String)
            let eventCreatedAt = try XCTUnwrap(entry["eventCreatedAt"] as? Int64)
            let valid = try XCTUnwrap(entry["valid"] as? Bool)
            let data = try JSONSerialization.data(withJSONObject: object)
            let content = String(data: data, encoding: .utf8)!
            let parsed = NostrClient.parseProgressContent(content, fallbackBookId: fallbackBookId)
            guard valid else {
                XCTAssertNil(parsed, name)
                continue
            }
            let expected = try XCTUnwrap(entry["expected"] as? [String: Any])
            XCTAssertEqual(parsed?.bookId, expected["bookId"] as? String, name)
            XCTAssertEqual(
                parsed?.progression ?? -1, try XCTUnwrap(expected["progression"] as? Double),
                accuracy: 0.0001, name
            )
            XCTAssertEqual(parsed?.cfi, expected["cfi"] as? String, name)
            XCTAssertEqual(
                NostrClient.parseFurthestProgression(content, fallback: parsed?.progression ?? 0),
                try XCTUnwrap(expected["furthestProgression"] as? Double), accuracy: 0.0001, name
            )
            XCTAssertEqual(
                NostrClient.parseProgressUpdatedAt(content, eventCreatedAtSeconds: eventCreatedAt),
                try XCTUnwrap(expected["updatedAt"] as? Int64), name
            )
        }
    }

    func testCanonicalEmitterIncludesV2AndMonotonicFurthestProgress() throws {
        let content = NostrClient.progressContent(
            bookId: "book", progression: 0.8, cfi: "here", furthestProgression: 0.2,
            title: nil, author: nil, updatedAt: 3
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(content.utf8)) as? [String: Any])
        let locator = try XCTUnwrap(object["locator"] as? [String: Any])
        XCTAssertEqual(object["v"] as? Int, 2)
        XCTAssertEqual(locator["furthestProgression"] as? Double, 0.8)
        XCTAssertEqual(NostrClient.parseFurthestProgression("not-json", fallback: 0.4), 0.4)
        XCTAssertEqual(NostrClient.parseProgressUpdatedAt("not-json", eventCreatedAtSeconds: 7), 7_000)
    }

    private func fixtureURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("shared/fixtures/reading-progress-v2.json")
    }
}
