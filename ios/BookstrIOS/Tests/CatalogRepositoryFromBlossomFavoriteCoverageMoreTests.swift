import XCTest
@testable import BookstrIOS

final class CatalogRepositoryFromBlossomFavoriteCoverageMoreTests: XCTestCase {
    func testFromExternalFavoriteUsesRawKeyWhenNoUsableIdentifierExists() {
        let key = String(repeating: "k", count: 10)
        let book = CatalogRepository.fromExternalFavorite(
            ExternalFavorite(
                key: key,
                title: "Key-only identity",
                author: "Author",
                year: nil,
                url: "https://example.org/read.epub",
                isbn: nil,
                libvaultMd5: nil,
                format: "epub",
                blossomSha256: nil,
                blossomUrl: nil
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual(key, book?.id)
        XCTAssertEqual("https://example.org/read.epub", book?.epubUrl)
        XCTAssertEqual("https://example.org/read.epub", book?.sourceUrl)
    }

    func testFromExternalFavoriteRejectsInvalidSchemeWithoutBlossomSha() {
        let book = CatalogRepository.fromExternalFavorite(
            ExternalFavorite(
                key: String(repeating: "a", count: 32),
                title: "Bad scheme",
                author: "Author",
                year: nil,
                url: "ftp://example.org/read.epub",
                isbn: nil,
                libvaultMd5: nil,
                format: "epub",
                blossomSha256: nil,
                blossomUrl: nil
            )
        )

        XCTAssertNil(book)
    }

    func testFromExternalFavoriteTrimsWhitespaceAroundFormatTokens() {
        let id = String(repeating: "c", count: 32)
        let book = CatalogRepository.fromExternalFavorite(
            ExternalFavorite(
                key: id,
                title: "Whitespace format",
                author: "Author",
                year: nil,
                url: "https://example.org/book.epub",
                isbn: nil,
                libvaultMd5: nil,
                format: " epub ",
                blossomSha256: nil,
                blossomUrl: nil
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual("https://example.org/book.epub", book?.epubUrl)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromExternalFavoriteInfersPdfFromUrlWhenFormatIsUnsupported() {
        let sha = String(repeating: "b", count: 64)
        let book = CatalogRepository.fromExternalFavorite(
            ExternalFavorite(
                key: sha,
                title: "Format via URL",
                author: "Author",
                year: nil,
                url: "https://example.org/book.PDF?download=1",
                isbn: nil,
                libvaultMd5: nil,
                format: "mobi",
                blossomSha256: nil,
                blossomUrl: nil
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual("b".repeating(64), book?.id)
        XCTAssertEqual(.pdf, book?.format)
        XCTAssertEqual("https://example.org/book.PDF?download=1", book?.epubUrl)
    }

    func testFromBlossomFavoriteDefaultsToEpubWhenNoPdfSignalInMetadata() {
        let sha = String(repeating: "a", count: 64)
        let book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key: "legacy-key",
                title: "No format signal",
                author: "Author",
                year: nil,
                url: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: "txt",
                blossomSha256: sha,
                blossomUrl: "https://blossom.bfr.ee/\(sha)"
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual(sha, book?.id)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.epubUrl)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromBlossomFavoriteTrimsWhitespaceAroundFormatToken() {
        let sha = String(repeating: "d", count: 64)
        let book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key: "legacy-key",
                title: "Trimmed format",
                author: "Author",
                year: nil,
                url: "https://example.org/book.epub",
                isbn: nil,
                libvaultMd5: nil,
                format: " epub ",
                blossomSha256: sha,
                blossomUrl: "https://blossom.bfr.ee/\(sha)"
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual(sha, book?.id)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromBlossomFavoriteFallsBackToCanonicalUrlWhenBlossomUrlHasWhitespace() {
        let sha = String(repeating: "f", count: 64)
        let book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key: "legacy-key",
                title: "Whitespace URL",
                author: "Author",
                year: nil,
                url: "https://example.org/legacy.epub",
                isbn: nil,
                libvaultMd5: nil,
                format: "epub",
                blossomSha256: sha,
                blossomUrl: "  https://blossom.bfr.ee/\(sha)  "
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual(sha, book?.id)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.epubUrl)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromBlossomFavoriteFallsBackToCanonicalUrlWhenBlossomUrlIsInvalidAndDirectUrlIsMissing() {
        let sha = String(repeating: "g", count: 64)
        let book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key: "legacy-key",
                title: "Fallback without url",
                author: "Author",
                year: nil,
                url: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: "mobi",
                blossomSha256: sha,
                blossomUrl: "ftp://blossom.bfr.ee/\(sha)"
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual(sha, book?.id)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.epubUrl)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.sourceUrl)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromBlossomFavoriteFallsBackToCanonicalUrlWhenBlossomUrlIsInsecureAndDirectUrlIsBroken() {
        let sha = String(repeating: "h", count: 64)
        let book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key: "legacy-key",
                title: "Fallback insecure blossom",
                author: "Author",
                year: nil,
                url: "https://example.org/legacy.PDF",
                isbn: nil,
                libvaultMd5: nil,
                format: "epub",
                blossomSha256: sha,
                blossomUrl: "http://blossom.bfr.ee/\(sha)",
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual(sha, book?.id)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.epubUrl)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.sourceUrl)
        XCTAssertEqual(.epub, book?.format)
    }
}
