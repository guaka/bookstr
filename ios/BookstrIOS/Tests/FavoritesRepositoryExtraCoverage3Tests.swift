import XCTest
@testable import BookstrIOS

final class FavoritesRepositoryExtraCoverage3Tests: XCTestCase {
    func testFromExternalFavoriteDefaultsUnknownFormatByUrlToEpub() {
        let md5 = String(repeating: "7", count: 32)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Unknown format favorite",
            author: "Author",
            year: nil,
            url: "https://example.test/read.txt",
            isbn: nil,
            libvaultMd5: nil,
            format: "mystery",
            blossomSha256: nil,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.format, .epub)
        XCTAssertEqual(book?.epubUrl, "https://example.test/read.txt")
        XCTAssertEqual(book?.id, md5)
    }

    func testParseSharedFavoriteTagsKeepsPendingURLAfterInvalidBookURLTag() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"],
            ["book", "url", "://not-a-valid-url", "1700000010"],
            ["i", "isbn:978-0-12-345-6789-7"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/fallback.epub")
    }

    func testFromExternalFavoriteRejectsInvalidFavoriteWithoutMd5OrSha() {
        let favorite = ExternalFavorite(
            key: "legacy-id",
            title: "No identity",
            author: "Author",
            year: nil,
            url: "https://example.test/book.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )
        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testParseSharedFavoriteTagsStandaloneIstagProducesUrlMissingBook() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["i", "isbn:978-0-12-345-6789-7"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertNil(refs[0].url)
    }

    func testIsCollectionIDRejectsUppercaseCollectionIds() {
        XCTAssertFalse(FavoritesParser.isCollectionID("bookstr-collection-" + String(repeating: "A", count: 32)))
    }

    func testFromExternalFavoriteUsesDefaultBlossomHostForNonBlossomExplicitUrl() {
        let sha = String(repeating: "f", count: 64)
        let favorite = ExternalFavorite(
            key: String(repeating: "1", count: 16),
            title: "Blossom fallback",
            author: "Author",
            year: nil,
            url: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "https://cdn.example.com/\(sha)"
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(book?.sourceUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testFromExternalFavoriteLowercasesUppercaseMd5WhenNoBlossomSha() {
        let md5 = "A".repeating(32)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Case key",
            author: "Author",
            year: nil,
            url: "https://example.test/book.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, md5.lowercased())
        XCTAssertEqual(book?.epubUrl, "https://example.test/book.epub")
        XCTAssertEqual(book?.sourceUrl, "https://example.test/book.epub")
    }

    func testFromExternalFavoriteFallsBackToMd5WhenBlossomHashIsInvalid() {
        let md5 = "B".repeating(32)
        let invalidSha = "z".repeating(64)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Invalid blossom fallback",
            author: "Author",
            year: nil,
            url: "https://example.test/book.epub?download=1",
            isbn: nil,
            libvaultMd5: nil,
            format: "pdf",
            blossomSha256: invalidSha,
            blossomUrl: "://bad-url",
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, md5.lowercased())
        XCTAssertEqual(book?.epubUrl, "https://example.test/book.epub?download=1")
        XCTAssertEqual(book?.sourceUrl, "https://example.test/book.epub?download=1")
        XCTAssertEqual(book?.format, .pdf)
    }

    func testIsCollectionIDReturnsExpectedShape() {
        XCTAssertTrue(FavoritesParser.isCollectionID("bookstr-collection-" + String(repeating: "a", count: 32)))
        XCTAssertFalse(FavoritesParser.isCollectionID("bookstr-collection-" + String(repeating: "g", count: 32)))
        XCTAssertFalse(FavoritesParser.isCollectionID("bookstr-collection-short"))
        XCTAssertFalse(FavoritesParser.isCollectionID("not-a-collection"))
    }

    func testMatchSharedFavoritesUsesLibvaultIdBeforeBlossomOrUrlForExternalKey() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(
                    libvaultMd5: String(repeating: "a", count: 32),
                    blossomSha256: String(repeating: "b", count: 64),
                    url: "https://example.org/unmatched.epub",
                    title: "Favorite",
                ),
            ],
            books: [],
        )

        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, String(repeating: "a", count: 32))
        XCTAssertEqual(result.external[0].blossomSha256, String(repeating: "b", count: 64))
        XCTAssertEqual(result.external[0].url, "https://example.org/unmatched.epub")
    }

    func testParseSharedFavoriteTagsHandlesNonStringArrayElementsAndKeepsCurrentRef() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"] as [Any],
            ["book", "url", "https://example.org/base.epub", "1700000010"] as [Any],
            [1, 2, 3] as [Any],
            ["i", "isbn:978-0-12-345-6789-7"] as [Any],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/base.epub")
    }

    func testParseSharedFavoriteTagsReturnsEmptyForObjectWithoutTagsList() {
        let refs = FavoritesParser.parseSharedFavoriteTags("{\"events\":[[\"book\",\"url\",\"https://example.org/book.epub\",\"1700000010\"]]}")

        XCTAssertEqual(refs.count, 0)
    }

    func testFromBlossomFavoriteInfersEpubFromUnknownFormatHint() {
        let sha = String(repeating: "a", count: 64)
        let favorite = ExternalFavorite(
            key: String(repeating: "b", count: 32),
            title: "Unknown format favorite",
            author: "Author",
            year: "2026",
            url: "https://legacy.example.com/book.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: nil,
            blossomSha256: sha,
            blossomUrl: "https://blossom.bfr.ee/\(sha)?download=1#reader"
        )
        let book = CatalogRepository.fromBlossomFavorite(favorite)

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.format, .epub)
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)?download=1#reader")
    }

    func testPublicationIdentityCandidatesDropsWhitespaceAndEmptyValues() {
        let book = CatalogBook(
            id: " Legacy-ID ",
            title: "Title",
            author: "Author",
            epubUrl: "https://example.com/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: "   ",
            format: .epub,
            blossomSha256: nil,
            year: nil
        )
        XCTAssertEqual(
            CatalogRepository.publicationIdentityCandidates(for: book),
            ["legacy-id"]
        )
    }
}
