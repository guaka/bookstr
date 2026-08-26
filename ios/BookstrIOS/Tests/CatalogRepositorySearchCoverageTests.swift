import XCTest
@testable import BookstrIOS

final class CatalogRepositorySearchCoverageTests: XCTestCase {
    func testParseSearchResponseUsesSourceNativeIdWhenNumericIdMissingAndDefaultsSource() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"books":[{"source":"openlibrary","source_native_id":"OL1M","title":"Native ID Search"}]}
                """#.utf8
            ),
            limit: 10,
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "openlibrary:OL1M")
        XCTAssertEqual(results[0].title, "Native ID Search")
    }

    func testParseSearchResponseInfersReadableFormatFromUrlAndLeavesMetadataFallbackOnlyRecordReadable() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"book-1","title":"Readable","url":"https://example.org/read.pdf"},
                  {"id":"book-2","title":"Metadata only","author":"Anon"}
                ]}
                """#.utf8
            ),
            limit: 10,
        )

        XCTAssertEqual(results.count, 2)
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertTrue(results[0].isReadable)
        XCTAssertNil(results[1].format)
        XCTAssertFalse(results[1].isReadable)
    }

    func testParseSearchResponseSortsReadableResultsBeforeMetadataOnly() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"one","title":"Metadata","year":"2021"},
                  {"id":"two","title":"Readable","url":"https://example.org/story.epub"},
                  {"id":"three","title":"Metadata Second","author":"Joe"}
                ]}
                """#.utf8
            ),
            limit: 10,
        )

        XCTAssertEqual(results.map(\.id), ["all.books.party:two", "all.books.party:one", "all.books.party:three"])
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseReturnsEmptyForMalformedPayload() {
        XCTAssertTrue(CatalogRepository.parseSearchResponse(Data("{invalid json}".utf8)).isEmpty)
    }

    func testParseSearchResponsePrefersReadUrlOverUrlAndLink() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {
                    "id":"read-priority",
                    "title":"Read URL First",
                    "format":"pdf",
                    "readUrl":"https://example.org/read.pdf",
                    "url":"https://example.org/url.epub",
                    "link":"https://example.org/link.epub"
                  }
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.pdf")
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseDropsLimitWhenSetToZero() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"one","title":"One","url":"https://example.org/one.epub"}
                ]}
                """#.utf8
            ),
            limit: 0
        )

        XCTAssertTrue(results.isEmpty)
    }

    func testParseSearchResponseUsesCoverIdFromNumericValue() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"id1","title":"Has cover","cover_id":123}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].coverUrl, "https://covers.openlibrary.org/b/id/123-M.jpg")
    }

    func testParseSearchResponseSkipsMalformedRowsAndPrioritizesReadableResult() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  1,
                  ["invalid"],
                  {"id":"bad"},
                  {"id":"r1","title":"Readable result","readUrl":"https://example.org/read.epub", "url":"https://example.org/fallback.pdf"},
                  {"id":"r2","title":"Unread metadata only"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.map(\.id), ["all.books.party:r1", "all.books.party:r2"])
        XCTAssertTrue(results[0].isReadable)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.epub")
    }

    func testParseSearchResponsePrefersBooksArrayEvenWhenResultsHasValues() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {
                  "books":[{"id":"books-1","title":"Catalog result"}],
                  "results":[{"id":"result-1","title":"Search result","url":"https://example.org/result.epub"}]
                }
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:books-1")
        XCTAssertEqual(results[0].title, "Catalog result")
    }

    func testParseSearchResponseAcceptsNumericIdAndIssuedYearOnly() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":2021,"issued":"2021-08-24","title":"Numeric ID Example","url":"https://example.org/book.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:2021")
        XCTAssertEqual(results[0].year, "2021")
        XCTAssertEqual(results[0].format, .epub)
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseInfersFormatFromReadUrlWhenUnknownFormatProvided() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {
                    "id":"format-fallback",
                    "title":"Unknown format",
                    "format":"mobi",
                    "readUrl":"https://example.org/story.PDF",
                    "url":"https://example.org/story.epub"
                  }
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/story.PDF")
    }

    func testParseSearchResponseFallsBackToAuthorsFieldWhenAuthorIsMissing() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"authors-only","title":"Legacy Author Field","authors":"Ada Lovelace"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].author, "Ada Lovelace")
        XCTAssertEqual(results[0].source, "all.books.party")
    }

    func testParseSearchResponseUsesExtensionFieldForFormatFallback() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"ext-pdf","title":"PDF ext","extension":"pdf","url":"https://example.test/fallback.bin"},
                  {"id":"ext-unsupported","title":"Unsupported ext","extension":"txt","url":"https://example.test/read.txt"},
                  {"id":"ext-epub","title":"Epub ext","extension":"epub","url":"https://example.test/fallback.bin"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 3)
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertTrue(results[0].isReadable)
        XCTAssertNil(results[1].format)
        XCTAssertFalse(results[1].isReadable)
        XCTAssertEqual(results[2].format, .epub)
        XCTAssertTrue(results[2].isReadable)
    }

    func testParseSearchResponseUsesLinkWhenReadUrlAndUrlAreMissing() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"missing-link","title":"No link"},
                  {"id":"with-link","title":"Link first","link":"https://example.org/read.pdf"},
                  {"source_native_id":"NATIVE-12","source":"  ","title":"Legacy native","readable":"nope"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 2)
        XCTAssertEqual(results[0].id, "all.books.party:with-link")
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.pdf")
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertTrue(results[0].isReadable)
        XCTAssertEqual(results[1].id, "all.books.party:NATIVE-12")
    }

    func testParseSearchResponseReturnsEmptyForArrayPayload() {
        XCTAssertTrue(CatalogRepository.parseSearchResponse(Data("[{\"id\":\"one\",\"title\":\"x\",\"url\":\"https://example.org/x.epub\"}]".utf8)).isEmpty)
    }

    func testParseSearchResponseFallsBackToGutenbergDownloadUrlWhenUrlIsMissing() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"321","source":"Gutenberg","title":"Gutenberg fallback"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "gutenberg:321")
        XCTAssertEqual(results[0].downloadUrl, "https://books-api.guaka.org/api/books/321/download")
        XCTAssertEqual(results[0].format, .epub)
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseTrimsSourceNativeIdBeforeApplyingNativeIdFallback() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"source":"  OpenLibrary  ","source_native_id":"  OL123M  ","title":"Trimmed source native id"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "openlibrary:OL123M")
    }

    func testParseSearchResponseFallsBackToLinkAfterUnsupportedFormatWhenUrlMissing() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"fallback","source":"archive","title":"Fallback by link","format":"txt","link":"https://example.org/story.PDF","url":"undefined"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/story.PDF")
    }

    func testParseSearchResponseHonorsZeroLimitAsEmpty() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[{"id":"one","title":"One","url":"https://example.org/one.epub"}]}
                """#.utf8
            ),
            limit: 0
        )

        XCTAssertTrue(results.isEmpty)
    }

    func testParseSearchResponseHonorsNegativeLimitAsEmpty() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[{"id":"one","title":"One","url":"https://example.org/one.epub"}]}
                """#.utf8
            ),
            limit: -3
        )

        XCTAssertTrue(results.isEmpty)
    }
}
