import XCTest
@testable import BookstrIOS

final class FavoritesRepositoryExtraCoverage2Tests: XCTestCase {
    func testParseSharedFavoriteTagsSetsIsbnURLWhenCurrentRefLacksURL() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr", "catalog-id", "Legacy title", "Legacy author"],
            ["i", "isbn:978-0-12-345-6789-7", "https://example.org/fallback.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "catalog-id")
        XCTAssertEqual(refs[0].title, "Legacy title")
        XCTAssertEqual(refs[0].author, "Legacy author")
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/fallback.epub")
    }

    func testFromExternalFavoriteRejectsMd5KeyWhenSha256IsInvalid() {
        let md5 = String(repeating: "d", count: 32)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Fallback title",
            author: "Author",
            year: nil,
            url: "https://legacy.example.test/read.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: "not-a-valid-sha",
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertNil(book)
    }

    func testMatchSharedFavoritesPrefersTitleProvidedByRefForUnmatchedItem() {
        let refs = [SharedFavoriteRef(bookstrId: "catalog-id", title: "Standalone title", isbn: "9780000000000")]
        let result = FavoritesParser.matchSharedFavorites(refs: refs, books: [])

        XCTAssertEqual(result.bookIds.count, 0)
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].title, "Standalone title")
        XCTAssertEqual(result.external[0].key, "catalog-id")
    }

    func testMatchSharedFavoritesUsesBlossomFallbackForUnmatchedExternalFavorite() {
        let sha = String(repeating: "d", count: 64)
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(blossomSha256: sha)],
            books: [],
        )

        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, sha)
        XCTAssertEqual(result.external[0].title, "Blossom \(String(sha.prefix(10)))…")
        XCTAssertNil(result.external[0].blossomUrl)
        XCTAssertNil(result.external[0].url)
    }

    func testParseSharedFavoriteTagsSetsCurrentUrlFromPendingRefOnStandaloneIstag() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"],
            ["i", "isbn:978-0-12-345-6789-7"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/fallback.epub")
        XCTAssertNil(refs[0].blossomSha256)
    }

    func testParseSharedFavoriteTagsUsesPendingUrlAfterInvalidIstag() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"],
            ["i", "isbn:bad-format"],
            ["i", "isbn:978-0-12-345-6789-7"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/fallback.epub")
    }

    func testParseSharedFavoriteTagsSkipsInvalidLibvaultAndUsesPendingIstagAsStandalone() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"],
            ["book", "libvault", "bad-md5", "1700000010", ""],
            ["i", "isbn:978-0-12-345-6789-7"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/fallback.epub")
        XCTAssertNil(refs[0].libvaultMd5)
    }

    func testFromExternalFavoriteFallsBackToBlossomWhenDownloadUrlIsInvalid() {
        let sha = String(repeating: "d", count: 64)
        let favorite = ExternalFavorite(
            key: "local-id",
            title: "Downloaded",
            author: "Author",
            year: nil,
            url: ":/not-a-url",
            isbn: nil,
            libvaultMd5: nil,
            format: "pdf",
            blossomSha256: sha,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(book?.sourceUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testFromExternalFavoriteUsesBlossomFallbackEvenWithUnsupportedLegacyUrl() {
        let sha = String(repeating: "c", count: 64)
        let favorite = ExternalFavorite(
            key: String(repeating: "a", count: 32),
            title: "Legacy favorite",
            author: "Collector",
            year: nil,
            url: "ftp://example.test/legacy.epub",
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

    func testParseSharedFavoriteTagsSkipsInvalidMetadataIdThenParsesBlossomRef() {
        let libvaultMd5 = String(repeating: "e", count: 32)
        let sha = String(repeating: "d", count: 64)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["libvault", "bad-md5", "1700000010", "https://example.com/invalid.epub"],
            ["blossom", libvaultMd5, sha, "https://blossom.example/\(sha).epub"],
            ["book", "libvault", libvaultMd5, "1700000001", "https://example.com/real.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, libvaultMd5)
        XCTAssertEqual(refs[0].blossomSha256, sha)
        XCTAssertEqual(refs[0].url, "https://example.com/real.epub")
    }

    func testFromExternalFavoriteRejectsInvalidSha256WhenLibvaultMd5IsPresent() {
        let md5 = String(repeating: "a", count: 32)
        let favorite = ExternalFavorite(
            key: String(repeating: "k", count: 16),
            title: "Invalid sha favorite",
            author: "Author",
            year: nil,
            url: "https://example.test/download.epub",
            isbn: nil,
            libvaultMd5: md5,
            format: "epub",
            blossomSha256: "not-a-sha256",
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertNil(book)
    }

    func testParseSharedFavoriteTagsIgnoresUnsupportedLibvaultBookFormatUntilSupportedOneAppears() {
        let md5 = String(repeating: "b", count: 32)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000010", "https://example.org/book.epub"],
            ["libvault-book", md5, "My Title", "My Author", "mobi", "", "", "2024"],
            ["libvault-book", md5, "", "", "epub", "", "", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "My Title")
        XCTAssertEqual(refs[0].author, "My Author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2024")
    }

    func testFromExternalFavoriteAcceptsCaseInsensitiveBlossomHostCanonicalUrl() {
        let sha = String(repeating: "f", count: 64)
        let favorite = ExternalFavorite(
            key: String(repeating: "z", count: 16),
            title: "Case host",
            author: "Author",
            year: "2024",
            url: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "https://Blossom.BFR.ee/\(sha)"
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(book?.sourceUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testFromExternalFavoriteUsesExplicitBlossomUrlWithQueryAndFragment() {
        let sha = String(repeating: "8", count: 64)
        let favorite = ExternalFavorite(
            key: String(repeating: "q", count: 16),
            title: "Query favorite",
            author: "Author",
            year: nil,
            url: "https://legacy.example.org/fallback.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "https://blossom.bfr.ee/\(sha)?download=1#reader"
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)?download=1#reader")
        XCTAssertEqual(book?.sourceUrl, "https://blossom.bfr.ee/\(sha)?download=1#reader")
    }

    func testParseSharedFavoriteTagsKeepsBlossomMetadataWhenFormatIsUnsupported() {
        let md5 = String(repeating: "A", count: 32)
        let sha = String(repeating: "b", count: 64)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["blossom", md5, sha, "https://blossom.example/\(sha)", "mobi"],
            ["book", "libvault", md5, "1700000010", "https://example.org/book.epub"],
            ["libvault-book", md5, "Supported", "Author", "epub", "", "", "2024"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5.lowercased())
        XCTAssertEqual(refs[0].blossomSha256, sha)
        XCTAssertEqual(refs[0].blossomUrl, "https://blossom.example/\(sha)")
        XCTAssertEqual(refs[0].format, "epub")
    }

    func testFavoritesParserMatchesByEpubUrlWhenSourceUrlIsMissing() {
        let ref = SharedFavoriteRef(
            url: "https://files.example.com/book.epub",
            title: "Reader match",
            author: "Author",
            format: "epub"
        )
        let book = CatalogBook(
            id: "local-match",
            title: "Reader match",
            author: "Author",
            epubUrl: "https://files.example.com/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: .epub,
            blossomSha256: nil,
            year: nil
        )

        XCTAssertTrue(FavoritesParser.matches(ref, book: book))
    }

    func testMatchSharedFavoritesIgnoresURLMatchWhenStableIdConflicts() {
        let sharedRef = SharedFavoriteRef(
            libvaultMd5: "a".repeating(32),
            isbn: "9780000000000",
            url: "https://example.org/shared.epub",
        )
        let result = FavoritesParser.matchSharedFavorites(
            refs: [sharedRef],
            books: [
                CatalogBook(
                    id: "different-book",
                    title: "Conflict",
                    author: "Author",
                    epubUrl: "https://example.org/shared.epub",
                    coverUrl: nil,
                    sourceUrl: "https://example.org/shared.epub",
                    isbn: "9780000000000",
                    libvaultMd5: "b".repeating(32),
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
            ],
        )

        XCTAssertEqual(result.bookIds.count, 0)
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, "a".repeating(32))
    }

    func testMatchSharedFavoritesIgnoresISBNMatchWhenStableIdMatchesDifferentBook() {
        let sharedRef = SharedFavoriteRef(
            bookstrId: "stable-id",
            isbn: "9780000000000",
            url: "https://example.org/other.epub",
        )
        let result = FavoritesParser.matchSharedFavorites(
            refs: [sharedRef],
            books: [
                CatalogBook(
                    id: "stable-id",
                    title: "Preferred",
                    author: "Author",
                    epubUrl: "https://example.org/different.epub",
                    coverUrl: nil,
                    sourceUrl: "https://example.org/different.epub",
                    isbn: "9781111111111",
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
            ],
        )

        XCTAssertEqual(result.bookIds.count, 1)
        XCTAssertEqual(result.bookIds.first, "stable-id")
        XCTAssertTrue(result.external.isEmpty)
    }

    func testParseSharedFavoriteTagsKeepsCurrentUrlWhenIstagUsesItsOwnLocator() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", "a".repeating(32), "1700000010", "https://example.org/base.epub"],
            ["i", "isbn:978-0-12-345-6789-7", "https://example.org/override.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "a".repeating(32))
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/base.epub")
    }

    func testParseSharedFavoriteTagsKeepsCurrentUrlWhenCurrentRefIsURLScoped() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", "https://example.org/base.epub", "1700000010", ""],
            ["i", "isbn:978-0-12-345-6789-7", "https://example.org/override.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/base.epub")
    }

    func testParseSharedFavoriteTagsMergesLibvaultAddedToEarliestValue() {
        let md5 = String(repeating: "a", count: 32)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000010", "https://example.org/base.epub"],
            ["libvault-added", md5, "1700000007"],
            ["libvault-added", md5, "1700000005"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].addedAt, 1700000005)
    }

    func testParseSharedFavoriteTagsUsesPendingUrlForLegacyLibvaultRef() {
        let md5 = "A".repeating(32)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"],
            ["libvault", md5],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5.lowercased())
        XCTAssertEqual(refs[0].url, "https://example.org/fallback.epub")
    }

    func testParseSharedFavoriteTagsIgnoresInvalidUrlNamespaceWithoutCurrentRef() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", "not-a-url", "1700000010", ""],
            ["i", "isbn:978-0-12-345-6789-7", "https://example.org/fallback.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertNil(refs[0].url)
        XCTAssertNil(refs[0].libvaultMd5)
    }

    func testMatchSharedFavoritesMatchesByBlossomSha256() {
        let sha = String(repeating: "c", count: 64)
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(blossomSha256: sha, title: "Shared Title")],
            books: [
                CatalogBook(
                    id: "some-book",
                    title: "Remote",
                    author: "Writer",
                    epubUrl: "https://example.test/book.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: sha,
                    year: nil
                )
            ],
        )

        XCTAssertEqual(result.bookIds.count, 1)
        XCTAssertEqual(result.bookIds.first, "some-book")
        XCTAssertTrue(result.external.isEmpty)
    }

    func testFromExternalFavoriteLowercasesUppercaseMd5KeyWithoutBlossom() {
        let md5 = String(repeating: "A", count: 32)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Casey Favorite",
            author: nil,
            year: nil,
            url: "https://lib.b.bfr.ee/api/files/\(md5.lowercased())",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, md5.lowercased())
        XCTAssertEqual(book?.sourceUrl, "https://lib.b.bfr.ee/api/files/\(md5.lowercased())")
    }

    func testFromExternalFavoriteInfersPdfFormatFromUrlWhenFormatIsUnknown() {
        let md5 = String(repeating: "d", count: 32)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Pdf from URL",
            author: "Unknown",
            year: nil,
            url: "https://example.test/read.pdf",
            isbn: nil,
            libvaultMd5: nil,
            format: "mystery",
            blossomSha256: nil,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.format, .pdf)
        XCTAssertEqual(book?.epubUrl, "https://example.test/read.pdf")
    }

    func testParseSharedFavoriteTagsAppliesIstagToMostRecentBookstrRef() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr", "catalog-id", "First title", "First author"],
            ["i", "isbn:978-0-12-345-6789-7"],
            ["bookstr", "standalone-id", "Second title", "Second author", "https://example.org/second.epub"],
        ])

        XCTAssertEqual(refs.count, 2)
        XCTAssertEqual(refs[0].bookstrId, "catalog-id")
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].title, "First title")
        XCTAssertEqual(refs[1].bookstrId, "standalone-id")
        XCTAssertNil(refs[1].isbn)
    }

    func testMatchSharedFavoritesDeduplicatesExternalFavoritesByUrlKey() {
        let url = "https://example.org/duplicate.epub"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(url: url, title: "First"),
                SharedFavoriteRef(url: url, title: "Second"),
            ],
            books: [],
        )

        XCTAssertEqual(result.bookIds.count, 0)
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, url)
        XCTAssertEqual(result.external[0].title, "Second")
    }

    func testMatchSharedFavoritesDeduplicatesExternalFavoritesByBlossomKey() {
        let sha = String(repeating: "f", count: 64)
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(blossomSha256: sha, title: "First"),
                SharedFavoriteRef(blossomSha256: sha, title: "Second", url: "https://example.org/dup.epub"),
            ],
            books: [],
        )

        XCTAssertEqual(result.bookIds.count, 0)
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, sha)
        XCTAssertEqual(result.external[0].title, "Second")
        XCTAssertEqual(result.external[0].url, "https://example.org/dup.epub")
    }
    func testMatchSharedFavoritesDeduplicatesExternalFavoritesByNormalizedIsbnKey() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(
                    isbn: "978-0-12-345-6789-7",
                    title: "First title",
                    addedAt: 1_700_000_001
                ),
                SharedFavoriteRef(
                    isbn: "9780123456789",
                    title: "Second title",
                    url: "https://example.org/updated.epub",
                    addedAt: 1_700_000_002
                ),
            ],
            books: [],
        )

        XCTAssertEqual(result.bookIds.count, 0)
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, "9780123456789")
        XCTAssertEqual(result.external[0].isbn, "9780123456789")
        XCTAssertEqual(result.external[0].title, "Second title")
        XCTAssertEqual(result.external[0].url, "https://example.org/updated.epub")
    }

    func testFromExternalFavoriteFallsBackToBlossomHostWhenBlossomUrlInvalid() {
        let sha = String(repeating: "e", count: 64)
        let book = CatalogRepository.fromExternalFavorite(
            ExternalFavorite(
                key: String(repeating: "a", count: 16),
                title: "Offline",
                author: "Reader",
                year: nil,
                url: "https://legacy.example.test/read.epub",
                isbn: nil,
                libvaultMd5: nil,
                format: "pdf",
                blossomSha256: sha,
                blossomUrl: "http://blossom.bfr.ee/\(sha)",
            )
        )

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(book?.sourceUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testParseSharedFavoriteTagsKeepsPendingUrlAfterUnknownTag() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"],
            ["x", "ignored-entry"],
            ["i", "isbn:978-0-12-345-6789-7", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/fallback.epub")
    }

    func testFromExternalFavoriteRejectsInvalidUrlWhenOnlyMalformedUrlIsAvailable() {
        let favorite = ExternalFavorite(
            key: "not-a-key",
            title: "Malformed",
            author: "Reader",
            year: nil,
            url: "::://not.a.url",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: "not-a-sha",
            blossomUrl: nil
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }
}
