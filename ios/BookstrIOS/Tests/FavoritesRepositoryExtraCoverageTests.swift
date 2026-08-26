import XCTest
@testable import BookstrIOS

final class FavoritesRepositoryExtraCoverageTests: XCTestCase {
    func testFromExternalFavoriteFallsBackToBlossomHostWithInvalidSourceUrl() {
        let sha = String(repeating: "a", count: 64)
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Invalid source",
            author: "Author",
            year: nil,
            url: "ftp://example.org/invalid.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(book?.sourceUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testFromExternalFavoriteRejectsMismatchedExplicitBlossomHostAndUsesBlossomGateway() {
        let sha = String(repeating: "b", count: 64)
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Mismatched blossom",
            author: "Author",
            year: nil,
            url: "https://example.org/legacy",
            isbn: nil,
            libvaultMd5: nil,
            format: "pdf",
            blossomSha256: sha,
            blossomUrl: "https://example.net/\(sha)"
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testFavoritesParserMergesIsolatedLibvaultMetadataBeforeBaseTag() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-book", "catalog-id", "Metadata title", "Metadata author", "epub", "", "2024"],
            ["book", "bookstr", "catalog-id", "1700000010", "https://example.org/book.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "catalog-id")
        XCTAssertEqual(refs[0].title, "Metadata title")
        XCTAssertEqual(refs[0].author, "Metadata author")
        XCTAssertEqual(refs[0].year, "2024")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].url, "https://example.org/book.epub")
    }
}
