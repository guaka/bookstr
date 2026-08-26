import XCTest
@testable import BookstrIOS

final class FavoritesRepositoryCoverageTests: XCTestCase {
    func testFavoritesParserMatchesBySourceUrl() {
        let source = "https://catalog.example.com/books/42"
        let ref = SharedFavoriteRef(
            bookstrId: nil, libvaultMd5: nil, isbn: nil, url: source,
            title: "Read", author: nil, year: nil, format: nil,
            blossomSha256: nil, blossomUrl: nil, addedAt: nil
        )
        let book = CatalogBook(
            id: "book-id",
            title: "Catalog Book",
            author: "Writer",
            epubUrl: "https://cdn.example.com/books/42.epub",
            coverUrl: nil,
            sourceUrl: source,
            isbn: nil,
            libvaultMd5: nil,
            format: .epub,
            blossomSha256: nil,
            year: nil
        )

        XCTAssertTrue(FavoritesParser.matches(ref, book: book))
    }

    func testFromExternalFavoriteFallsBackToBlossomHostWhenExplicitUrlHostMismatches() {
        let sha = String(repeating: "a", count: 64)
        let favorite = ExternalFavorite(
            key: "local-id",
            title: "Remote Book",
            author: "Unknown",
            year: nil,
            url: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "https://example.com/\(sha)"
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(book?.sourceUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testFromExternalFavoriteRequiresStableIdentifierWithoutBlossom() {
        let favorite = ExternalFavorite(
            key: "not-a-hash",
            title: "Not Resolved",
            author: "Unknown",
            year: nil,
            url: "https://example.com/download.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testFromExternalFavoriteUsesRawKeyAsIdWhenKeyIsLibvaultMd5() {
        let md5 = String(repeating: "c", count: 32)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Cached File",
            author: "Unknown",
            year: nil,
            url: "https://lib.b.bfr.ee/api/files/\(md5)",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )

        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, md5)
        XCTAssertEqual(book?.epubUrl, "https://lib.b.bfr.ee/api/files/\(md5)")
        XCTAssertEqual(book?.sourceUrl, "https://lib.b.bfr.ee/api/files/\(md5)")
    }

    func testInvalidCompactURLTagIsSkippedByParser() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", "not-a-valid-url", "1700000000"],
            ["book", "url", "https://example.com/book.epub", "1700000001"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].url, "https://example.com/book.epub")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
    }

    func testFromExternalFavoriteRejectsUnsupportedUrlSchemeWithoutBlossom() {
        let md5 = String(repeating: "d", count: 32)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Legacy Read URL",
            author: "Unknown",
            year: nil,
            url: "ftp://example.com/\(md5).epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testParseSharedFavoriteTagsDeduplicatesDuplicateUrlRefs() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", "https://example.com/book.epub", "1700000005"],
            ["book", "url", "https://example.com/book.epub", "1700000000"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].url, "https://example.com/book.epub")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_000)
    }

    func testPublicationIdentityCandidatesDeduplicatesAndLowercasesValues() {
        let book = CatalogBook(
            id: "Legacy-ID",
            title: "Candidate title",
            author: "Author",
            epubUrl: "https://example.com/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: "9780123456789",
            libvaultMd5: "AA".repeating(16),
            format: .epub,
            blossomSha256: "BB".repeating(32),
            year: nil
        )

        XCTAssertEqual(
            CatalogRepository.publicationIdentityCandidates(for: book),
            ["legacy-id", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        )
    }

    func testPublicationIdentityCandidatesSkipsBlankValuesAndTrimsWhitespace() {
        let book = CatalogBook(
            id: "  Legacy-ID  ",
            title: "Candidate title",
            author: "Author",
            epubUrl: "https://example.com/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: "  ",
            format: .epub,
            blossomSha256: nil,
            year: nil
        )

        XCTAssertEqual(
            CatalogRepository.publicationIdentityCandidates(for: book),
            ["legacy-id"],
        )
    }

    func testFavoritesParserMatchesCatalogByLibvaultMd5BeforeUrlFallback() {
        let md5 = String(repeating: "f", count: 32)
        let ref = SharedFavoriteRef(libvaultMd5: md5, url: "https://example.com/mismatch.epub")
        let book = CatalogBook(
            id: "read-book",
            title: "Match Book",
            author: "Author",
            epubUrl: "https://example.com/match.epub",
            coverUrl: nil,
            sourceUrl: "https://example.com/match.epub",
            isbn: nil,
            libvaultMd5: md5,
            format: .epub,
            blossomSha256: nil,
            year: nil
        )

        XCTAssertTrue(FavoritesParser.matches(ref, book: book))
    }

    func testFavoritesParserMatchesByNormalizedIsbn() {
        let ref = SharedFavoriteRef(isbn: "978-0-12-345-678-9")
        let book = CatalogBook(
            id: "normalized",
            title: "Matched by ISBN",
            author: "Author",
            epubUrl: "https://example.com/normalized.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: "9780123456789",
            libvaultMd5: nil,
            format: .epub,
            blossomSha256: nil,
            year: nil
        )

        XCTAssertTrue(FavoritesParser.matches(ref, book: book))
    }

    func testParseSharedFavoriteTagsUsesPendingRAsFallbackURLForIsbnTag() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"],
            ["i", "isbn:978-0-12-345-6789-X"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789X")
        XCTAssertEqual(refs[0].url, "https://example.org/fallback.epub")
    }

    func testParseSharedFavoriteTagsMergesLibvaultMetadataByMd5() {
        let md5 = String(repeating: "A", count: 32)
        let sha = String(repeating: "b", count: 64)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"],
            ["book", "libvault", md5, "1700000010", "https://example.org/fallback.epub"],
            ["libvault-book", md5, "Merged title", "Merged Author", "epub", "", "", "2001"],
            ["blossom", md5, sha, "https://blossom.test/\(sha).epub", "pdf"],
            ["i", "isbn:978-0-12-345-6789-0"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5.lowercased())
        XCTAssertEqual(refs[0].title, "Merged title")
        XCTAssertEqual(refs[0].author, "Merged Author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2001")
        XCTAssertEqual(refs[0].blossomSha256, sha)
        XCTAssertEqual(refs[0].blossomUrl, "https://blossom.test/\(sha).epub")
        XCTAssertEqual(refs[0].isbn, "9780123456789")
    }

    func testFromExternalFavoriteUsesSha256IdentifierWithoutMd5Key() {
        let sha = String(repeating: "c", count: 64)
        let favorite = ExternalFavorite(
            key: "not-a-hash",
            title: "Bloom cache",
            author: "Collector",
            year: nil,
            url: "https://cdn.example.test/mapped.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "pdf",
            blossomSha256: sha,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.sourceUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testParseSharedFavoriteTagsMergesLibvaultBookMetadataAndKeepsEarliestAddedAt() {
        let md5 = String(repeating: "a", count: 32)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000010", "https://example.com/one"],
            ["libvault-book", md5, "Book title", "Book author", "epub", "", "", "2024"],
            ["libvault-added", md5, "1700000005"],
            ["libvault-book", md5, "", "", "pdf", "", "", "2000"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "Book title")
        XCTAssertEqual(refs[0].author, "Book author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2024")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_005)
    }

    func testFromExternalFavoriteRejectsInvalidBlossomSha256WhenKeyIsMd5() {
        let md5 = String(repeating: "a", count: 32)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Legacy md5 favorite",
            author: "Unknown",
            year: nil,
            url: "https://cdn.example.test/book.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: "not-a-hash",
            blossomUrl: nil
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testFromExternalFavoriteFallsBackToCanonicalBlossomUrlWhenExplicitBlossomUrlIsInvalid() {
        let sha = String(repeating: "d", count: 64)
        let favorite = ExternalFavorite(
            key: "not-a-hash",
            title: "Cached from bloom",
            author: "Collector",
            year: nil,
            url: "https://example.test/download.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "http://blossom.bfr.ee/\(sha)"
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)

        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(book?.sourceUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertNil(book?.title)
    }

    func testFavoritesParserMatchesByLibvaultIdIgnoringCase() {
        let md5 = String(repeating: "A", count: 32)
        let ref = SharedFavoriteRef(libvaultMd5: md5.lowercased())
        let book = CatalogBook(
            id: "local-1",
            title: "Case test",
            author: "Author",
            epubUrl: "https://example.com/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: md5,
            format: .epub,
            blossomSha256: nil,
            year: nil
        )

        XCTAssertTrue(FavoritesParser.matches(ref, book: book))
    }

    func testFavoritesParserMatchesByEpubUrl() {
        let epub = "https://cdn.example.com/reader.epub"
        let ref = SharedFavoriteRef(url: epub)
        let book = CatalogBook(
            id: "book-epub",
            title: "Epub match",
            author: "Author",
            epubUrl: epub,
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

    func testParseSharedFavoriteTagsSkipsInvalidLibvaultAddedRows() {
        let md5 = String(repeating: "B", count: 32)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000010", "https://example.org/base"],
            ["libvault-added", md5, "not-a-number"],
            ["libvault-added", md5, "0"],
            ["libvault-added", md5, "1699999995"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].addedAt, 1_699_999_995)
    }

    func testMatchSharedFavoritesUsesBlossomFallbackTitleWhenNoExplicitTitle() {
        let sha = String(repeating: "D", 64)
        let result = FavoritesParser.matchSharedFavorites([SharedFavoriteRef(blossomSha256: sha)], books: [])

        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, sha)
        XCTAssertEqual(result.external[0].title, "Blossom \(String(sha.prefix(10)))…")
    }

    func testMatchSharedFavoritesMatchesByBlossomSha256() {
        let sha = String(repeating: "c", count: 64)
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(blossomSha256: sha.uppercased())],
            books: [
                CatalogBook(
                    id: "catalog-id",
                    title: "Blossom book",
                    author: "Author",
                    epubUrl: "https://example.com/blossom.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: sha.lowercased(),
                    year: nil
                ),
            ],
        )

        XCTAssertEqual(result.bookIds, Set(["catalog-id"]))
        XCTAssertTrue(result.external.isEmpty)
    }

    func testParseSharedFavoriteTagsUsesPendingRAsFallbackURLForBookstrTag() {
        let ref = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/fallback.epub"],
            ["bookstr", "catalog-id", "Bookstr title", "Bookstr author"],
        ]).first

        XCTAssertEqual(ref?.bookstrId, "catalog-id")
        XCTAssertEqual(ref?.url, "https://example.org/fallback.epub")
        XCTAssertEqual(ref?.title, "Bookstr title")
        XCTAssertEqual(ref?.author, "Bookstr author")
    }

    func testParseSharedFavoriteTagsDropsInvalidBookstrAndBlossomTags() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr", ""],
            ["blossom", "not-a-sha256", "", ""],
            ["book", "url", "https://example.com/book.epub", "1700000000"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].url, "https://example.com/book.epub")
    }

    func testFromExternalFavoriteRejectsUnsupportedSchemeForCanonicalUrl() {
        let favorite = ExternalFavorite(
            key: String(repeating: "a", count: 32),
            title: "Legacy",
            author: "Unknown",
            year: nil,
            url: "ftp://example.test/download.epub",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: "not-a-hash",
            blossomUrl: nil
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testFromExternalFavoriteRejectsLegacyReadEndpointAsSourceUrl() {
        let md5 = String(repeating: "f", count: 32)
        let favorite = ExternalFavorite(
            key: md5,
            title: "Read endpoint",
            author: "Unknown",
            year: nil,
            url: "https://lib.b.bfr.ee/api/read/\(md5)",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )

        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testParseSharedFavoriteTagsIgnoresInvalidBookUrlAndKeepsValidOnes() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", "not a url", "1700000000"],
            ["book", "url", "https://example.com/valid.epub", "1700000001"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].url, "https://example.com/valid.epub")
        XCTAssertEqual(refs[0].addedAt, 1700000001)
    }

    func testParseSharedFavoriteTagsMergesBlossomMetadataWithoutOverridingFormat() {
        let md5 = String(repeating: "f", count: 32)
        let sha = String(repeating: "b", count: 64)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000010", "https://example.com/book.epub"],
            ["blossom", md5, sha, "https://blossom.example/\(sha)", "mobi"],
            ["blossom", md5, sha, "https://blossom.example/\(sha)", "epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].blossomSha256, sha)
    }

    func testParseSharedFavoriteTagsMergesIsbnTagIntoCurrentRef() {
        let md5 = String(repeating: "d", count: 32)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000010", "https://example.com/book.epub"],
            ["i", "isbn:978-0-12-345678-9", "https://example.com/override.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.com/book.epub")
    }

    func testMatchSharedFavoritesUsesLibvaultMd5AsFallbackKeyBeforeURLFallback() {
        let md5 = String(repeating: "A", count: 32)
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(libvaultMd5: md5, url: "https://example.com/mismatch.epub", isbn: "9780000000001")],
            books: [
                CatalogBook(
                    id: "local-id",
                    title: "Different URL Match",
                    author: "Author",
                    epubUrl: "https://example.com/book.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: "9780000000001",
                    libvaultMd5: md5,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
            ],
        )

        XCTAssertEqual(result.bookIds, Set(["local-id"]))
        XCTAssertTrue(result.external.isEmpty)
    }

    func testMatchSharedFavoritesFallsBackToCachedUrlWhenNoStableId() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(url: "https://example.com/book.epub")],
            books: [
                CatalogBook(
                    id: "legacy-id",
                    title: "Cached Match",
                    author: "Author",
                    epubUrl: "https://example.com/book.epub",
                    coverUrl: nil,
                    sourceUrl: "https://example.com/book.epub",
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
            ],
        )

        XCTAssertEqual(result.bookIds, Set(["legacy-id"]))
        XCTAssertTrue(result.external.isEmpty)
    }
}
