import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class BookstrDebugLogTests: XCTestCase {
    func testPrunesByAgeAndCapacity() {
        let store = JSONFileStore(subdirectory: "bookstr/debug-tests-\(UUID().uuidString)")
        let log = BookstrDebugLog(
            store: store,
            filename: "speech.json",
            retention: 60,
            capacity: 3
        )
        let now = Date()
        log.record("old", now: now.addingTimeInterval(-120))
        log.record("a", now: now.addingTimeInterval(-10))
        log.record("b", now: now.addingTimeInterval(-5))
        log.record("c", now: now.addingTimeInterval(-1))
        log.record("d", now: now)

        let lines = log.snapshot().map(\.message)
        XCTAssertEqual(lines, ["b", "c", "d"])
        XCTAssertFalse(lines.contains("old"))
        XCTAssertFalse(lines.contains("a"))
    }

    func testExportAndClear() {
        let store = JSONFileStore(subdirectory: "bookstr/debug-tests-\(UUID().uuidString)")
        let log = BookstrDebugLog(store: store, filename: "export.json", retention: 3_600, capacity: 50)
        log.record("keep-alive on", category: BookstrDebugLog.speech)
        log.record("other", category: "ui")
        let speechOnly = log.exportText(category: BookstrDebugLog.speech)
        XCTAssertTrue(speechOnly.contains("[speech] keep-alive on"))
        XCTAssertFalse(speechOnly.contains("[ui]"))
        log.clear()
        XCTAssertTrue(log.snapshot().isEmpty)
        XCTAssertEqual(log.exportText(), "")
    }

    func testPersistsAcrossInstances() {
        let name = "persist-\(UUID().uuidString).json"
        let store = JSONFileStore(subdirectory: "bookstr/debug-tests-\(UUID().uuidString)")
        let first = BookstrDebugLog(store: store, filename: name, retention: 3_600, capacity: 50)
        first.record("survives")
        let second = BookstrDebugLog(store: store, filename: name, retention: 3_600, capacity: 50)
        XCTAssertEqual(second.snapshot().map(\.message), ["survives"])
    }
}
