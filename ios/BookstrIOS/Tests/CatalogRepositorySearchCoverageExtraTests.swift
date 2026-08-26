import XCTest
@testable import BookstrIOS

final class CatalogRepositorySearchCoverageExtraTests: XCTestCase {
    func testBookFormatFromFallsBackToUrlFormatWhenUnknownFormatIsProvided() {
        XCTAssertEqual(BookFormat.from(format: "mobi", url: "https://example.org/read.PDF"), .pdf)
        XCTAssertEqual(BookFormat.from(format: nil, url: "https://example.org/read.epub"), .epub)
    }

    func testBookFormatFromDefaultsToEpubWhenNoPdfHint() {
        XCTAssertEqual(BookFormat.from(format: "", url: "https://example.org/read.bin"), .epub)
        XCTAssertEqual(BookFormat.from(format: "mobi", url: "https://example.org/read.bin"), .epub)
    }

    func testBookFormatFromRespectsWhitespaceAndCaseInExplicitFormat() {
        XCTAssertEqual(BookFormat.from(format: " PDF "), .pdf)
        XCTAssertEqual(BookFormat.from(format: "\nEPUB\t", url: "https://example.org/file.txt"), .epub)
    }

    func testBookFormatFromFallsBackToPdfWhenQueryContainsPdfHint() {
        XCTAssertEqual(BookFormat.from(format: "mobi", url: "https://example.org/read.txt?download=book.PDF"), .pdf)
    }

    func testBookFormatFromExplicitEpubOverridesUrlPdfHint() {
        XCTAssertEqual(BookFormat.from(format: " epub ", url: "https://example.org/read.PDF"), .epub)
    }

    func testParseSearchResponsePrefersExtensionOverFormat() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"extension-priority","title":"Extension takes precedence","format":"mobi","extension":"epub","url":"https://example.org/story.pdf","link":"https://example.org/story.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].format, .epub)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/story.pdf")
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponsePrefersUnsupportedExtensionOverURLFormatFallback() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"legacy","source":"archive","title":"Unknown extension","extension":"txt","url":"https://example.org/story.PDF?download=1"}
                ]}
                """.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertNil(results[0].format)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/story.PDF?download=1")
        XCTAssertFalse(results[0].isReadable)
    }

    func testParseSearchResponseDefaultsSourceWhenTokenIsUndefined() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"source":"UNDEFINED","id":"unknown-source","title":"Fallback source","url":"https://example.org/read.epub"}
                ]}
                """.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:unknown-source")
        XCTAssertEqual(results[0].source, "all.books.party")
    }

    func testParseSearchResponseDefaultsSourceWhenTokenIsNull() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"source":"null","id":"source-null","title":"Null source","url":"https://example.org/read.epub"}
                ]}
                """.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:source-null")
        XCTAssertEqual(results[0].source, "all.books.party")
    }

    func testParseSearchResponseDefaultsTitleWhenTitleIsBlank() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"source":"archive","id":"blank-title","title":"   ","url":"https://example.org/read.epub"}
                ]}
                """.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].title, "Untitled")
    }

    func testParseSearchResponseUsesResultsWhenBooksArrayCannotBeParsedAsDictionaries() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"books":[1],"results":[
                  {"id":"fallback-result","title":"Result fallback","url":"https://example.org/result.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:fallback-result")
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/result.epub")
        XCTAssertEqual(results[0].format, .epub)
    }

    func testParseSearchResponseFallsBackToNumericNativeIdWhenSourceNativeIdIsMissing() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"source":"openlibrary","title":"No ids","source_native_id":"","readUrl":"https://example.org/story.pdf"},
                  {"source":"openlibrary","id":2024,"readable":"no","title":"numeric only","readUrl":"https://example.org/numeric.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "openlibrary:2024")
    }

    func testParseSearchResponseUsesSourceNativeIdWhenIdIsBlank() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"   ","source":"OPENBOOK","source_native_id":"  OB-12  ","title":"Id fallback","url":"https://example.org/fallback.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "openbook:OB-12")
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/fallback.epub")
    }

    func testParseSearchResponseFallsBackToEpubForUnknownFormatAndNonPdfUrl() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"unknown","source":"archive","title":"Unknown format","format":"mobi","url":"https://example.org/read.txt"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].format, .epub)
        XCTAssertEqual(results[0].id, "all.books.party:unknown")
        XCTAssertTrue(results[0].isReadable)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.txt")
    }

    func testParseSearchResponseStopsAfterLimitBeforeFilteringMalformedRows() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  1,
                  {"id":"one","title":"Inside limit","url":"https://example.org/one.epub"},
                  {"id":"two","title":"Dropped by limit","url":"https://example.org/two.epub"}
                ]}
                """#.utf8
            ),
            limit: 2
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:one")
    }

    func testParseSearchResponseFallsBackToLinkWhenFormatIsUnsupportedAndUrlIsNullish() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"fallback","source":"archive","title":"Unsupported format, nullish URL","format":"mobi","url":"undefined","link":"https://example.org/read.PDF"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.PDF")
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseDropsMalformedLeadingRowsWhenPrefixLimitIsOne() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  1,
                  {"id":"visible","title":"Not reached","url":"https://example.org/visible.epub"},
                  {"id":"also-visible","title":"Also not reached","url":"https://example.org/also.epub"}
                ]}
                """#.utf8
            ),
            limit: 1
        )

        XCTAssertEqual(results.count, 0)
    }

    func testParseSearchResponsePrefersEmptyBooksArrayOverResults() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"books":[],"results":[
                  {"id":"result-should-be-ignored","title":"Ignored","url":"https://example.org/ignore.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertTrue(results.isEmpty)
    }

    func testParseSearchResponseUsesIssuedDateFromTimestamp() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"issued-date","title":"Issued date","issued":"2029-12-24T11:00:00Z","url":"https://example.org/read.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].year, "2029")
    }

    func testParseSearchResponseConvertsNumericCoverIdToDownloadImage() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"numeric-cover","title":"Numeric cover","cover_id":1234,"url":"https://example.org/read.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].coverUrl, "https://covers.openlibrary.org/b/id/1234-M.jpg")
    }

    func testParseSearchResponseUsesReadUrlWhenUrlIsBlankString() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"readurl-blank-url","source":"archive","title":"ReadUrl used","readUrl":"https://example.org/read.PDF","url":""}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.PDF")
        XCTAssertEqual(results[0].format, .pdf)
    }
}
