import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class ReaderRelocationTests: XCTestCase {
    func testParsesIntegerProgressionThatJSONSerializationBoxesAsNSNumber() throws {
        let payload = try XCTUnwrap(ReaderRelocation.parse(
            #"{"cfi":"epubcfi(/6/8!/4/2/4)","progression":0,"sectionIndex":2,"sectionCount":10}"#
        ))
        XCTAssertEqual(payload.cfi, "epubcfi(/6/8!/4/2/4)")
        XCTAssertEqual(payload.progression, 0, accuracy: 0.000_001)
        XCTAssertEqual(payload.sectionIndex, 2)
        XCTAssertEqual(payload.sectionCount, 10)
        XCTAssertNil(payload.source)
    }

    func testParsesFractionalProgressionAndSpeechSource() throws {
        let payload = try XCTUnwrap(ReaderRelocation.parse(
            #"{"cfi":"epubcfi(/6/14!/4/12/1:40)","progression":0.42,"source":"speech"}"#
        ))
        XCTAssertEqual(payload.progression, 0.42, accuracy: 0.000_001)
        XCTAssertEqual(payload.source, "speech")
        XCTAssertEqual(payload.sectionCount, 1)
    }

    func testParsesStringNumbersAndRejectsEmptyLocators() {
        let payload = ReaderRelocation.parse(
            #"{"cfi":" epubcfi(/6/4) ","progression":"0.25","sectionIndex":"3","sectionCount":"4"}"#
        )
        XCTAssertEqual(payload?.cfi, "epubcfi(/6/4)")
        XCTAssertEqual(payload?.progression ?? -1, 0.25, accuracy: 0.000_001)
        XCTAssertEqual(payload?.sectionIndex, 3)
        XCTAssertEqual(payload?.sectionCount, 4)
        XCTAssertNil(ReaderRelocation.parse(nil))
        XCTAssertNil(ReaderRelocation.parse("{"))
        XCTAssertNil(ReaderRelocation.parse(#"{"progression":0.5}"#))
        XCTAssertNil(ReaderRelocation.parse(#"{"cfi":"  "}"#))
    }

    func testMissingProgressionDefaultsToZeroAndOutOfRangeValuesAreClamped() {
        XCTAssertEqual(ReaderRelocation.parse(#"{"cfi":"epubcfi(/6/2)"}"#)?.progression, 0)
        XCTAssertEqual(ReaderRelocation.parse(#"{"cfi":"epubcfi(/6/2)","progression":-0.5}"#)?.progression, 0)
        XCTAssertEqual(ReaderRelocation.parse(#"{"cfi":"epubcfi(/6/2)","progression":1.5}"#)?.progression, 1)
    }

    func testJSONHelpersIgnoreBooleansAndInvalidStrings() throws {
        XCTAssertNil(ReaderRelocation.jsonDouble(true))
        XCTAssertNil(ReaderRelocation.jsonDouble(false))
        XCTAssertNil(ReaderRelocation.jsonDouble("not-a-number"))
        XCTAssertNil(ReaderRelocation.jsonDouble(nil))
        XCTAssertEqual(try XCTUnwrap(ReaderRelocation.jsonDouble(NSNumber(value: 0))), 0)
        XCTAssertEqual(try XCTUnwrap(ReaderRelocation.jsonDouble(0.5)), 0.5, accuracy: 0.000_001)
        XCTAssertEqual(try XCTUnwrap(ReaderRelocation.jsonDouble(" 0.8 ")), 0.8, accuracy: 0.000_001)
        XCTAssertNil(ReaderRelocation.jsonInt(true))
        XCTAssertNil(ReaderRelocation.jsonInt("x"))
        XCTAssertNil(ReaderRelocation.jsonInt(nil))
        XCTAssertEqual(try XCTUnwrap(ReaderRelocation.jsonInt(NSNumber(value: 4.9))), 4)
        XCTAssertEqual(try XCTUnwrap(ReaderRelocation.jsonInt(7)), 7)
        XCTAssertEqual(try XCTUnwrap(ReaderRelocation.jsonInt("9")), 9)
        XCTAssertNil(ReaderRelocation.jsonDouble(Date()))
        XCTAssertNil(ReaderRelocation.jsonInt(Date()))
    }

    @MainActor
    func testProgressSyncDebouncerPublishesOnlyLatestRelocationAndCancelsPendingWork() async {
        let sleeper = ReaderDebouncerTestSleeper()
        let debouncer = ReaderProgressSyncDebouncer(
            delayNanoseconds: 123,
            sleep: { nanoseconds in try await sleeper.sleep(nanoseconds) }
        )
        var published: [Int] = []
        let discardedWorkPublished = expectation(description: "discarded work must not publish")
        discardedWorkPublished.isInverted = true
        let firstSleepStarted = expectation(description: "first debounce wait started")
        debouncer.schedule {
            published.append(1)
            discardedWorkPublished.fulfill()
        }
        sleeper.onWaitStarted = { firstSleepStarted.fulfill() }
        await fulfillment(of: [firstSleepStarted], timeout: 1)

        let replacementSleepStarted = expectation(description: "replacement debounce wait started")
        sleeper.onWaitStarted = { replacementSleepStarted.fulfill() }
        let replacementPublished = expectation(description: "replacement operation published")
        debouncer.schedule {
            published.append(2)
            replacementPublished.fulfill()
        }
        await fulfillment(of: [replacementSleepStarted], timeout: 1)
        XCTAssertEqual(sleeper.requestedDelays, [123, 123])

        sleeper.releaseAll()
        await fulfillment(of: [replacementPublished], timeout: 1)
        XCTAssertEqual(published, [2], "replaced work must not publish")

        let cancelledSleepStarted = expectation(description: "cancelled debounce wait started")
        sleeper.onWaitStarted = { cancelledSleepStarted.fulfill() }
        debouncer.schedule {
            published.append(3)
            discardedWorkPublished.fulfill()
        }
        await fulfillment(of: [cancelledSleepStarted], timeout: 1)
        debouncer.cancel()
        sleeper.releaseAll()
        await fulfillment(of: [discardedWorkPublished], timeout: 1)
        XCTAssertEqual(published, [2])
    }

    @MainActor
    func testProgressSyncDebouncerDefaultSleeperPublishesAfterConfiguredWait() async {
        let debouncer = ReaderProgressSyncDebouncer(delayNanoseconds: 0)
        let published = expectation(description: "default sleeper publishes")
        debouncer.schedule { published.fulfill() }
        await fulfillment(of: [published], timeout: 1)
    }
}

@MainActor
private final class ReaderDebouncerTestSleeper {
    private var continuations: [CheckedContinuation<Void, Error>] = []
    private(set) var requestedDelays: [UInt64] = []
    var onWaitStarted: (() -> Void)?

    func sleep(_ nanoseconds: UInt64) async throws {
        requestedDelays.append(nanoseconds)
        onWaitStarted?()
        try await withCheckedThrowingContinuation { continuation in
            continuations.append(continuation)
        }
        try Task.checkCancellation()
    }

    func releaseAll() {
        let pending = continuations
        continuations.removeAll()
        pending.forEach { $0.resume() }
    }
}
