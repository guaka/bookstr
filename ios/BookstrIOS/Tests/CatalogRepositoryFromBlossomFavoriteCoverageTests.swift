import XCTest
@testable import BookstrIOS

final class CatalogRepositoryFromBlossomFavoriteCoverageTests: XCTestCase {
    func testFromBlossomFavoriteFallsBackToConstructedBlossomUrlWhenExplicitUrlIsInvalid() {
        let sha = "f".repeating(64)
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Fallback url",
            author: "Author",
            year: "2026",
            url: "https://library.example.org/legacy.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "mobi",
            blossomSha256: sha,
            blossomUrl: "not-a-valid-url"
        )
        let book = CatalogRepository.fromBlossomFavorite(favorite)

        XCTAssertNotNil(book)
        XCTAssertEqual(sha, book?.id)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.epubUrl)
        XCTAssertEqual("Author", book?.author)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.sourceUrl)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromExternalFavoriteFallsBackToMd5KeyWhenBlossomSha256IsMissing() {
        let key = "f".repeating(32)
        let favorite = ExternalFavorite(
            key: key,
            title: "Fallback to key",
            author: "Author",
            year: "2026",
            url: "https://example.org/book.PDF",
            isbn: nil,
            libvaultMd5: nil,
            format: "pdf",
            blossomSha256: nil,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertNotNil(book)
        XCTAssertEqual(key, book?.id)
        XCTAssertEqual("https://example.org/book.PDF", book?.epubUrl)
        XCTAssertEqual(.pdf, book?.format)
        XCTAssertEqual("https://example.org/book.PDF", book?.sourceUrl)
        XCTAssertEqual("Author", book?.author)
    }

    func testFromExternalFavoriteRejectsInvalidUrlWithoutUsableIdentity() {
        let favorite = ExternalFavorite(
            key: "not-an-md5",
            title: "No identity",
            author: "Author",
            year: nil,
            url: "://bad-url",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testFromExternalFavoriteUsesExplicitBlossomUrlWhenValid() {
        let sha = String(repeating: "f", count: 64)
        let explicit = "https://blossom.bfr.ee/files/\(sha)?download=1"
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Explicit blossom url",
            author: "Author",
            year: nil,
            url: "https://example.org/fallback.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: explicit
        )

        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertNotNil(book)
        XCTAssertEqual(sha, book?.id)
        XCTAssertEqual(explicit, book?.epubUrl)
        XCTAssertEqual(explicit, book?.sourceUrl)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromBlossomFavoriteRejectsMissingBlossomSha256() {
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Missing hash",
            author: nil,
            year: nil,
            url: "https://example.org/book.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: "https://blossom.bfr.ee/abc"
        )

        XCTAssertNil(CatalogRepository.fromBlossomFavorite(favorite))
    }

    func testFromExternalFavoriteUsesKeyWhenMd5PresentAndBlossomShaIsMissing() {
        let favorite = ExternalFavorite(
            key: "F".repeating(64),
            title: "MD5 fallback",
            author: "Author",
            year: nil,
            url: "https://example.org/book.PDF",
            isbn: nil,
            libvaultMd5: nil,
            format: "mobi",
            blossomSha256: nil,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertNotNil(book)
        XCTAssertEqual("f".repeating(64), book?.id)
        XCTAssertEqual("https://example.org/book.PDF", book?.epubUrl)
        XCTAssertEqual(.pdf, book?.format)
        XCTAssertEqual("Author", book?.author)
    }

    func testFromExternalFavoriteRejectsMissingIdentityAndUrl() {
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "No identity",
            author: "Author",
            year: nil,
            url: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testFromBlossomFavoriteFallsBackToBlossomBaseWhenExplicitUrlIsNotHttpOrHttps() {
        let sha = String(repeating: "a", count: 64)
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Fallback scheme",
            author: "Author",
            year: nil,
            url: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "ftp://cdn.example.com/\(sha)"
        )

        let book = CatalogRepository.fromBlossomFavorite(favorite)

        XCTAssertNotNil(book)
        XCTAssertEqual(sha, book?.id)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.epubUrl)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.sourceUrl)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromExternalFavoriteUsesLibvaultMd5WhenKeyIsNotValidMD5() {
        let libvaultMd5 = String(repeating: "b", count: 32)
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Libvault identity",
            author: "Author",
            year: nil,
            url: "https://example.org/legacy.pdf",
            isbn: nil,
            libvaultMd5: libvaultMd5,
            format: "pdf",
            blossomSha256: nil,
            blossomUrl: nil
        )

        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertNotNil(book)
        XCTAssertEqual(libvaultMd5, book?.id)
        XCTAssertEqual("https://example.org/legacy.pdf", book?.epubUrl)
        XCTAssertEqual(.pdf, book?.format)
        XCTAssertEqual("https://example.org/legacy.pdf", book?.sourceUrl)
    }

    func testFromExternalFavoriteRejectsWhenIdentityAndUrlAreBothMissing() {
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "No identity",
            author: "Author",
            year: nil,
            url: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testFromExternalFavoriteRejectsInvalidBlossomShaWhenMd5IdentityIsPresent() {
        let invalidSha = String(repeating: "z", count: 64)
        let validMd5 = String(repeating: "0", count: 32)
        let favorite = ExternalFavorite(
            key: validMd5,
            title: "Invalid blossom sha",
            author: "Author",
            year: nil,
            url: "https://example.org/legacy.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: invalidSha,
            blossomUrl: "https://blossom.bfr.ee/\(invalidSha)"
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testFromExternalFavoriteFallsBackToBlossomBaseWhenExplicitBlossomUrlIsInvalid() {
        let sha = String(repeating: "c", count: 64)
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Fallback invalid blossom URL",
            author: "Author",
            year: nil,
            url: "https://example.org/read.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "mobi",
            blossomSha256: sha,
            blossomUrl: "ftp://blossom.bfr.ee/\(sha)"
        )

        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertNotNil(book)
        XCTAssertEqual(sha, book?.id)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.epubUrl)
        XCTAssertEqual("https://blossom.bfr.ee/\(sha)", book?.sourceUrl)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromBlossomFavoriteRejectsSubdomainHostInBlossomUrl() {
        let sha = String(repeating: "d", count: 64)
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Subdomain host",
            author: "Author",
            year: nil,
            url: "https://example.org/read.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "https://cdn.blossom.bfr.ee/\(sha)"
        )

        XCTAssertNil(CatalogRepository.fromBlossomFavorite(favorite))
    }

    func testFromBlossomFavoriteRejectsInvalidSha256EvenWithValidBlossomUrl() {
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Invalid sha",
            author: "Author",
            year: nil,
            url: "https://example.org/read.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: String(repeating: "z", count: 64),
            blossomUrl: "https://blossom.bfr.ee/" + String(repeating: "f", count: 64)
        )

        XCTAssertNil(CatalogRepository.fromBlossomFavorite(favorite))
    }

    func testFromExternalFavoriteRejectsInvalidBlossomUrlAndInvalidDirectUrlWithoutSha() {
        let sha = String(repeating: "9", count: 64)
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "No valid link",
            author: "Author",
            year: nil,
            url: "ht!tp://bad url",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "ftp://cdn.example.com/\(sha)"
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testFromBlossomFavoriteAcceptsUppercaseHostAndSha() {
        let sha = String(repeating: "F", count: 64)
        let lowercasedSha = sha.lowercased()
        let favorite = ExternalFavorite(
            key: "legacy-key",
            title: "Uppercase host and hash",
            author: "Author",
            year: nil,
            url: "https://example.org/legacy.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "pdf",
            blossomSha256: sha,
            blossomUrl: "HTTPS://BLOSSOM.BFR.EE/\(sha)"
        )

        let book = CatalogRepository.fromBlossomFavorite(favorite)

        XCTAssertNotNil(book)
        XCTAssertEqual(lowercasedSha, book?.id)
        XCTAssertEqual("https://blossom.bfr.ee/\(lowercasedSha)", book?.epubUrl)
        XCTAssertEqual("https://blossom.bfr.ee/\(lowercasedSha)", book?.sourceUrl)
        XCTAssertEqual(.pdf, book?.format)
    }

    func testFromExternalFavoriteLowercasesUppercaseMd5Identity() {
        let key = String(repeating: "A", count: 32)
        let book = CatalogRepository.fromExternalFavorite(
            ExternalFavorite(
                key: key,
                title: "Uppercase md5 key",
                author: "Author",
                year: nil,
                url: "https://example.org/legacy.epub",
                isbn: nil,
                libvaultMd5: nil,
                format: "mobi",
                blossomSha256: nil,
                blossomUrl: nil
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual(String(repeating: "a", count: 32), book?.id)
        XCTAssertEqual(.epub, book?.format)
    }

    func testFromExternalFavoriteUsesLibvaultMd5WhenKeyIsNotValidHex() {
        let libvaultMd5 = String(repeating: "F", count: 32)
        let book = CatalogRepository.fromExternalFavorite(
            ExternalFavorite(
                key: "legacy-key",
                title: "Fallback to libvault hash",
                author: nil,
                year: "2024",
                url: "https://example.org/book.epub",
                isbn: nil,
                libvaultMd5: libvaultMd5,
                format: "pdf",
                blossomSha256: nil,
                blossomUrl: nil
            )
        )

        XCTAssertNotNil(book)
        XCTAssertEqual(libvaultMd5.lowercased(), book?.id)
        XCTAssertEqual("https://example.org/book.epub", book?.epubUrl)
        XCTAssertEqual(.pdf, book?.format)
    }
}
