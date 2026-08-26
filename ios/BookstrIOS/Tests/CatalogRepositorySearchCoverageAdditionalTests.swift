import XCTest
@testable import BookstrIOS

final class CatalogRepositorySearchCoverageAdditionalTests: XCTestCase {
    func testParseSearchResponseAcceptsNumericIdAndNumericMetadata() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":2024,"source":"OPENLIBRARY","title":"Numeric id","year":2024,"edition_count":9,"format":"pdf","url":"https://example.org/read.PDF"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "openlibrary:2024")
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertEqual(results[0].year, "2024")
        XCTAssertEqual(results[0].editionCount, 9)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.PDF")
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseBuildsGutenbergDownloadForNumericIdWithoutExplicitFormat() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":321,"source":"GUTENBERG","title":"Numeric gutenberg"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "gutenberg:321")
        XCTAssertEqual(results[0].source, "gutenberg")
        XCTAssertEqual(results[0].format, .epub)
        XCTAssertEqual(results[0].downloadUrl, "https://books-api.guaka.org/api/books/321/download")
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponsePrefersUppercaseExtensionOverFormat() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"ext-upper","title":"Uppercase extension","format":"mobi","extension":"PDF","url":"https://example.org/read.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.epub")
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseUsesReadUrlBeforeUrlWhenBothAreProvided() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"readurl","source":"archive","title":"ReadUrl precedence","format":"mobi","readUrl":"https://example.org/reader.PDF","url":"https://example.org/reader.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/reader.PDF")
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseInfersPdfFromQueryAndFragment() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"query-frag","source":"archive","title":"Query fragment","format":"mobi","url":"https://example.org/story.PDF?download=1#page=2"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:query-frag")
        XCTAssertEqual(results[0].format, .pdf)
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/story.PDF?download=1#page=2")
        XCTAssertTrue(results[0].isReadable)
    }

    func testParseSearchResponseStopsAfterLimitOnBooksArrayWithMalformedRows() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"books":[
                  true,
                  {"id":"book-1","title":"Primary","url":"https://example.org/one.epub"},
                  {"id":"book-2","title":"Secondary","url":"https://example.org/two.epub"}
                ],
                "results":[{"id":"ignored","title":"Ignored","url":"https://example.org/ignored.epub"}]}
                """.utf8
            ),
            limit: 1,
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:book-1")
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/one.epub")
        XCTAssertEqual(results[0].format, .epub)
    }

    func testParseSearchResponseFallsBackToResultsWhenBooksPayloadIsNotAnArray() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"books":{"id":"ignored","title":"Ignored"}, "results":[
                  {"id":"fallback","title":"Used","url":"https://example.org/read.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:fallback")
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/read.epub")
    }

    func testParseSearchResponseLimitCountsUnreadableItemsTowardLimit() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"unread","title":"No url","format":"mobi"},
                  {"id":"read","title":"Readable","url":"https://example.org/read.epub"},
                  {"id":"later","title":"Later","url":"https://example.org/later.epub"}
                ]}
                """#.utf8
            ),
            limit: 2
        )

        XCTAssertEqual(results.count, 2)
        XCTAssertEqual(results[0].id, "all.books.party:read")
        XCTAssertTrue(results[0].isReadable)
        XCTAssertEqual(results[1].id, "all.books.party:unread")
        XCTAssertFalse(results[1].isReadable)
    }

    func testParseSearchResponseReturnsEmptyForPrimitivePayload() {
        let results = CatalogRepository.parseSearchResponse(Data("false".utf8))

        XCTAssertTrue(results.isEmpty)
    }

    func testParseSearchResponsePreservesNumericRatingAndEditionCount() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"rating-metadata","source":"archive","title":"Metadata stats","url":"https://example.org/read.epub","avg_rating":4.7,"edition_count":21}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].rating, 4.7, accuracy: 0.0001)
        XCTAssertEqual(results[0].editionCount, 21)
    }

    func testParseSearchResponsePrefersAvgRatingOverLegacyRatingField() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"rating-precedence","title":"Rating precedence","readUrl":"https://example.org/read.epub","avg_rating":3.2,"rating":4.9}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].rating, 3.2, accuracy: 0.0001)
    }

    func testParseSearchResponseDefaultsRatingAndEditionCountWhenMetadataIsMalformed() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  {"id":"bad-metadata","source":"archive","title":"Bad metadata","url":"https://example.org/read.epub","avg_rating":"n/a","rating":"bad","edition_count":"na"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].rating, 0.0)
        XCTAssertEqual(results[0].editionCount, 0)
    }

    func testParseSearchResponseFallsBackToResultsWhenBooksPayloadIsStringArray() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"books":["ignored"], "results":[
                  {"id":"fallback","source":"archive","title":"Used","url":"https://example.org/fallback.epub"}
                ]}
                """#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "archive:fallback")
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/fallback.epub")
        XCTAssertEqual(results[0].format, .epub)
    }

    func testParseSearchResponseConsumesMalformedRowsTowardsLimitOnResultsPayload() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"results":[
                  "ignored",
                  {"id":"first","source":"archive","title":"First","url":"https://example.org/first.epub"},
                  {"id":"second","source":"archive","title":"Second","url":"https://example.org/second.epub"},
                  {"id":"third","source":"archive","title":"Third","url":"https://example.org/third.epub"}
                ]}
                """#.utf8
            ),
            limit: 2,
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:first")
    }

    func testParseSearchResponseConsumesMalformedRowsTowardsLimitOnBooksPayload() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"books":[
                  "ignored",
                  {"id":"first","source":"archive","title":"First","url":"https://example.org/first.epub"},
                  {"id":"second","source":"archive","title":"Second","url":"https://example.org/second.epub"}
                ],
                 "results":[{"id":"ignored","title":"Ignored","url":"https://example.org/ignored.epub"}]}
                """#.utf8
            ),
            limit: 2,
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:first")
    }

    func testParseSearchResponsePrefersBooksPayloadOverMalformedResultsPayload() {
        let results = CatalogRepository.parseSearchResponse(
            Data(
                #"""
                {"books":[
                  {"id":"book","source":"archive","title":"From books","url":"https://example.org/from-books.epub"}
                ],
                 "results":[
                  {"id":"ignored","source":"archive","title":"Ignored result","url":"https://example.org/ignored.epub"}
                 ]}"""#.utf8
            )
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].id, "all.books.party:book")
        XCTAssertEqual(results[0].downloadUrl, "https://example.org/from-books.epub")
    }
}
