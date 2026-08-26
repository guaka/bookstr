import XCTest
@testable import BookstrIOS

final class CatalogRepositorySearchCoverageMoreTests: XCTestCase {
    func testParseSearchResponseDefaultsSourceWhenTokenIsLowercaseUndefined() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"source":"undefined","id":"lower-undefined","title":"Lowercase undefined","url":"https://example.org/read.epub"}
                ]}
                """.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:lower-undefined")
        XCTAssertEqual(results[0].source, "all.books.party")
        XCTAssertEqual(results[0].format, .epub)
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseDefaultsSourceWhenTokenIsWhitespace() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"source":"   ","id":"space-source","title":"Whitespace source","url":"https://example.org/read.epub"}
                ]}
                """.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:space-source")
        XCTAssertEqual(results[0].source, "all.books.party")
        XCTAssertEqual(results[0].format, .epub)
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseDefaultsTitleWhenTitleIsNil() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"source":"archive","id":"nil-title","title":null,"url":"https://example.org/read.epub"}
                ]}
                """.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].title, "Untitled")
        XCTAssertEqual(results[0].format, .epub)
    }

    func testParseSearchResponseUsesNumericSourceNativeIdWhenIdIsMissing() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"source":"openlibrary","source_native_id":777,"title":"Numeric fallback","format":"epub","readUrl":"https://example.org/read.epub"}
                ]}
                """.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "openlibrary:777")
        XCTAssertEqual(results[0].format, .epub)
        XCTAssertTrue(results[0].isReadable)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.epub")
    }
}
