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
    }
}
