import XCTest
@testable import BookstrIOS

final class FavoritesParserTests: XCTestCase {
    func testParsesEncryptedNIP51TagFormat() {
        let sha = String(repeating: "b", count: 64)
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let tags: [Any] = [
            ["r", "https://lib.b.bfr.ee/#book?md5=\(md5)"],
            ["libvault", md5],
            ["libvault-book", md5, "A Book", "An Author", "epub", "1234", "2024"],
            ["blossom", md5, sha, "https://blossom.bfr.ee/\(sha)", "epub"],
            ["i", "isbn:978-0-123456-78-9", "https://lib.b.bfr.ee/#book?md5=\(md5)"],
            ["k", "isbn"]
        ]
        let refs = FavoritesParser.parseSharedFavoriteTags(tags)
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "A Book")
        XCTAssertEqual(refs[0].author, "An Author")
        XCTAssertEqual(refs[0].year, "2024")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].blossomSha256, sha)
        XCTAssertEqual(refs[0].blossomUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://lib.b.bfr.ee/#book?md5=\(md5)")
    }

    func testMatchesPortableISBNsAndKeepsUnmatchedEditions() {
        let tags: [Any] = [
            ["libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
            ["i", "isbn:9780123456789"],
            ["r", "https://lib.b.bfr.ee/#book?md5=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
            ["libvault", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]
        ]
        let refs = FavoritesParser.parseSharedFavoriteTags(tags)
        let result = FavoritesParser.matchSharedFavorites(
            refs: refs,
            books: [
                CatalogBook(
                    id: "book-1",
                    title: "One",
                    author: "Author",
                    epubUrl: "one.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: "978-0-123456-78-9",
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                )
            ]
        )
        XCTAssertEqual(result.bookIds, ["book-1"])
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].libvaultMd5, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    }

    func testBlossomFavoriteBecomesCatalogBook() {
        let sha = String(repeating: "b", count: 64)
        let favorite = ExternalFavorite(
            key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            title: "A Book",
            author: "An Author",
            year: "2024",
            url: nil,
            isbn: "9780123456789",
            libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "https://blossom.bfr.ee/\(sha)"
        )
        let book = CatalogRepository.fromBlossomFavorite(favorite)
        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.title, "A Book")
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testBlossomFavoriteSynthesizesURL() {
        let sha = String(repeating: "c", count: 64)
        let favorite = ExternalFavorite(
            key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            title: "A Book",
            author: "An Author",
            year: nil,
            url: nil,
            isbn: nil,
            libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            format: "epub",
            blossomSha256: sha,
            blossomUrl: nil
        )
        XCTAssertEqual(CatalogRepository.fromBlossomFavorite(favorite)?.epubUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testEncryptedLibVaultDescriptorBecomesFetchableBook() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let favorite = ExternalFavorite(
            key: md5,
            title: "A Resolved Book",
            author: "An Author",
            year: "2024",
            url: nil,
            isbn: nil,
            libvaultMd5: md5,
            format: "pdf",
            blossomSha256: nil,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)
        XCTAssertEqual(book?.id, md5)
        XCTAssertEqual(book?.format, .pdf)
        XCTAssertEqual(book?.epubUrl, "https://lib.b.bfr.ee/api/files/\(md5)")
    }

    func testRegularDownloadFavoriteBecomesCatalogBook() {
        let favorite = ExternalFavorite(
            key: "gutenberg:123",
            title: "A Search Favorite",
            author: "An Author",
            year: "2024",
            url: "https://books-api.guaka.org/api/books/123/download",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)
        XCTAssertEqual(book?.id, "gutenberg:123")
        XCTAssertEqual(book?.format, .epub)
        XCTAssertEqual(book?.epubUrl, favorite.url)
    }

    func testFavoriteWithoutDownloadLocationCannotBecomeCatalogBook() {
        let favorite = ExternalFavorite(
            key: "missing",
            title: "Unavailable",
            author: nil,
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

    func testParsesWrappedTagsObject() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let json = "{\"tags\":[[\"libvault\",\"\(md5)\"],[\"libvault-book\",\"\(md5)\",\"Wrapped\",\"Author\",\"epub\"]]}"
        let refs = FavoritesParser.parseSharedFavoriteTags(json)
        XCTAssertEqual(refs.first?.title, "Wrapped")
    }

    func testRelayEventWithNumericTagsDecodes() {
        let event = NostrEvent.fromRelayObject([
            "id": "abc",
            "pubkey": "def",
            "created_at": 1_700_000_000,
            "kind": 30003,
            "tags": [["d", "libvault-favorites"], ["published_at", 123]],
            "content": "ciphertext",
            "sig": "sig"
        ])
        XCTAssertEqual(event?.kind, 30003)
        XCTAssertEqual(event?.dTag, "libvault-favorites")
        XCTAssertEqual(event?.tags.last, ["published_at", "123"])
    }

    func testReadsChunkManifest() {
        let manifest = FavoritesParser.chunkManifest(from: #"[["libvault-chunks","3","libvault-favorites-chunk"]]"#)
        XCTAssertEqual(manifest?.count, 3)
        XCTAssertEqual(manifest?.prefix, "libvault-favorites-chunk")
        XCTAssertEqual(NostrKinds.favoritesChunkDTag(index: 1), "libvault-favorites-chunk-1")
        XCTAssertNil(FavoritesParser.chunkManifest(from: #"[["libvault","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]]"#))
    }

    func testParsesCompactFavoriteReference() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-collection", "2"],
            ["title", "Favorites"],
            ["book", "libvault", md5, "1700000000"]
        ])
        XCTAssertEqual(refs, [SharedFavoriteRef(libvaultMd5: md5, addedAt: 1_700_000_000)])
    }

    func testSerializesCompactFavoritesWithoutMetadata() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let tags = FavoritesParser.collectionTags(refs: [
            SharedFavoriteRef(libvaultMd5: md5, title: "Not synchronized", author: "Private cache",
                              addedAt: 1_700_000_000)
        ], updatedAt: 1_700_000_100)
        XCTAssertEqual(tags.last, ["book", "libvault", md5, "1700000000"])
        XCTAssertFalse(FavoritesParser.serializeTags(tags).contains("Not synchronized"))
        XCTAssertFalse(FavoritesParser.serializeTags(tags).contains("Private cache"))
    }

    func testSplitsCompactItemsUnderSignerLimit() {
        let refs = (0..<240).map { index in
            SharedFavoriteRef(
                libvaultMd5: String(format: "%032x", index),
                addedAt: Int64(1_700_000_000 + index)
            )
        }
        let chunks = FavoritesParser.splitItemTags(
            FavoritesParser.compactItemTags(refs: refs, fallbackAddedAt: 1_700_000_000)
        )
        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertEqual(chunks.flatMap { $0 }.count, refs.count)
        XCTAssertTrue(chunks.allSatisfy {
            FavoritesParser.serializeTags($0).count <= FavoritesParser.maxChunkPlaintextChars
        })
        let manifest = FavoritesParser.chunkManifest(
            from: #"[["bookstr-chunks","3","bookstr-chunk-generation"]]"#
        )
        XCTAssertEqual(manifest, FavoriteChunkManifest(count: 3, prefix: "bookstr-chunk-generation"))
    }
}
