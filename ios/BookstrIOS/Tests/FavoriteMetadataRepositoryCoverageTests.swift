import XCTest
@testable import BookstrIOS

final class FavoriteMetadataRepositoryCoverageTests: XCTestCase {
    func testRememberSkipsEntriesWithPlaceholderTitle() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.remember(
            SharedFavoriteRef(
                bookstrId: "book-1",
                libvaultMd5: String(repeating: "A", count: 32),
                isbn: "978-0-12-345-678-9",
                url: "https://example.org/book.epub",
                title: "Book favorite",
                author: "Alice",
                year: "2026",
                format: "epub",
                blossomSha256: String(repeating: "b", count: 64),
                blossomUrl: nil,
                addedAt: nil,
            )
        )

        let restored = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "book-1",
                libvaultMd5: String(repeating: "a", count: 32),
                isbn: "9780123456789",
                url: "https://example.org/book.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertNil(restored[0].title)
        XCTAssertNil(restored[0].author)
    }

    func testRememberAndEnrichFillsMissingCatalogMetadataFromStoredBookEntry() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.remember(
            book: CatalogBook(
                id: "book-2",
                title: "Saved title",
                author: "Saved author",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: "https://source.example.org/book.epub",
                isbn: "9780123456789",
                libvaultMd5: String(repeating: "b", count: 32),
                format: .pdf,
                blossomSha256: String(repeating: "c", count: 64),
                year: "2024"
            )
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "book-2",
                libvaultMd5: nil,
                isbn: nil,
                url: "https://source.example.org/book.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("Saved title", enriched[0].title)
        XCTAssertEqual("Saved author", enriched[0].author)
        XCTAssertEqual("2024", enriched[0].year)
        XCTAssertEqual("pdf", enriched[0].format)
        XCTAssertEqual("9780123456789", enriched[0].isbn)
        XCTAssertEqual("book-2", enriched[0].bookstrId)
    }

    func testRememberUsesLatestUpdatedTimestampAcrossSameIdentityKeys() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.remember(
            SharedFavoriteRef(
                bookstrId: "book-3",
                libvaultMd5: String(repeating: "c", count: 32),
                isbn: nil,
                url: "https://example.org/legacy.epub",
                title: "Older title",
                author: "Older author",
                year: nil,
                format: "epub",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
            updatedAt: 1,
        )
        repo.remember(
            SharedFavoriteRef(
                bookstrId: "book-3",
                libvaultMd5: String(repeating: "c", count: 32),
                isbn: nil,
                url: "https://example.org/legacy.epub",
                title: "Newest title",
                author: "Newest author",
                year: "2026",
                format: "pdf",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
            updatedAt: 2,
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "book-3",
                libvaultMd5: String(repeating: "C", count: 32),
                isbn: nil,
                url: "https://example.org/legacy.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("Newest title", enriched[0].title)
        XCTAssertEqual("Newest author", enriched[0].author)
        XCTAssertEqual("2026", enriched[0].year)
        XCTAssertEqual("pdf", enriched[0].format)
    }

    func testOlderMetadataDoesNotOverwriteFresherStoredEntry() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.remember(
            SharedFavoriteRef(
                bookstrId: "book-4",
                libvaultMd5: String(repeating: "d", count: 32),
                isbn: nil,
                url: "https://example.org/legacy.epub",
                title: "Newest title",
                author: "Newest author",
                year: "2026",
                format: "pdf",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
            updatedAt: 5,
        )
        repo.remember(
            SharedFavoriteRef(
                bookstrId: "book-4",
                libvaultMd5: String(repeating: "d", count: 32),
                isbn: nil,
                url: "https://example.org/legacy.epub",
                title: "Older title",
                author: "Older author",
                year: nil,
                format: "epub",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
            updatedAt: 1,
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "book-4",
                libvaultMd5: String(repeating: "D", count: 32),
                isbn: nil,
                url: "https://example.org/legacy.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("Newest title", enriched[0].title)
        XCTAssertEqual("Newest author", enriched[0].author)
        XCTAssertEqual("2026", enriched[0].year)
        XCTAssertEqual("pdf", enriched[0].format)
    }

    func testRememberProgressStoresMd5IndexedEntryForFutureEnrichment() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.rememberProgress(
            bookId: String(repeating: "E", 32),
            title: "Progress Title",
            author: "Progress Author",
            updatedAt: 1,
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "book-progress",
                libvaultMd5: String(repeating: "e", 32),
                isbn: nil,
                url: "https://example.org/progress.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("Progress Title", enriched[0].title)
        XCTAssertEqual("Progress Author", enriched[0].author)
    }

    func testRememberProgressStoresBookIdEntryWhenNotMd5() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.rememberProgress(
            bookId: "legacy-book-id",
            title: "Legacy Title",
            author: nil,
            updatedAt: 2,
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "legacy-book-id",
                libvaultMd5: nil,
                isbn: nil,
                url: "https://example.org/legacy.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("Legacy Title", enriched[0].title)
        XCTAssertNil(enriched[0].author)
    }

    func testRememberStoresEntriesUnderLowercasedIdentityKeys() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)
        let uppercaseMd5 = String(repeating: "A", count: 32)
        let lowercaseMd5 = String(repeating: "a", count: 32)

        repo.remember(
            SharedFavoriteRef(
                bookstrId: "BOOK-LOWERCASE",
                libvaultMd5: uppercaseMd5,
                isbn: "9780123456789",
                url: "https://example.org/lower.epub",
                title: "Cached Title",
                author: "Cached Author",
                year: "2025",
                format: "epub",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
            updatedAt: 1,
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "book-lowercase",
                libvaultMd5: lowercaseMd5,
                isbn: nil,
                url: "https://example.org/lower.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("Cached Title", enriched[0].title)
        XCTAssertEqual("Cached Author", enriched[0].author)
    }

    func testRememberProgressDoesNotOverwriteMoreRecentMetadata() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)
        let md5 = String(repeating: "f", count: 32)

        repo.rememberProgress(bookId: md5, title: "Fresh Metadata", author: "Fresh Author", updatedAt: 10)
        repo.remember(
            SharedFavoriteRef(
                bookstrId: "book-progress-older",
                libvaultMd5: md5,
                isbn: nil,
                url: "https://example.org/progress.epub",
                title: "Older Metadata",
                author: "Older Author",
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
            updatedAt: 3,
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: nil,
                libvaultMd5: md5,
                isbn: nil,
                url: "https://example.org/progress.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("Fresh Metadata", enriched[0].title)
        XCTAssertEqual("Fresh Author", enriched[0].author)
    }

    func testEnrichFillsMissingFieldsOnlyAndKeepsExistingValues() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.remember(
            SharedFavoriteRef(
                bookstrId: "book-existing-values",
                libvaultMd5: String(repeating: "a", count: 32),
                isbn: "9780123456789",
                url: "https://example.org/metadata.epub",
                title: "Cached Title",
                author: "Cached Author",
                year: "2020",
                format: "epub",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "book-existing-values",
                libvaultMd5: nil,
                isbn: nil,
                url: "https://example.org/metadata.epub",
                title: "Provided title should stay",
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
        ])

        XCTAssertEqual("Provided title should stay", enriched[0].title)
        XCTAssertEqual("Cached Author", enriched[0].author)
        XCTAssertEqual("2020", enriched[0].year)
        XCTAssertEqual("epub", enriched[0].format)
    }

    func testRememberProgressIndexesByLowercasedBookstrIdForNonMd5Input() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.rememberProgress(
            bookId: "NonMd5-BOOK-ID",
            title: "Uppercase Identity",
            author: "Progress User",
            updatedAt: 1,
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "nonmd5-book-id",
                libvaultMd5: nil,
                isbn: nil,
                url: "https://example.org/progress.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("Uppercase Identity", enriched[0].title)
        XCTAssertEqual("Progress User", enriched[0].author)
    }

    func testEnrichUsesIsbnIdentityWhenBookstrIdAndMd5AreMissing() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.remember(
            book: CatalogBook(
                id: "isbn-book",
                title: "ISBN Cached Title",
                author: "ISBN Cached Author",
                epubUrl: "https://example.org/isbn.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: "978-0-123456-78-9",
                libvaultMd5: nil,
                format: .pdf,
                blossomSha256: nil,
                year: "2026"
            )
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: nil,
                libvaultMd5: nil,
                isbn: "978-0-123456-78-9",
                url: "https://example.org/isbn.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("ISBN Cached Title", enriched[0].title)
        XCTAssertEqual("ISBN Cached Author", enriched[0].author)
        XCTAssertEqual("pdf", enriched[0].format)
    }

    func testEnrichSelectsNewestMetadataAcrossMultipleIdentityKeys() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)
        let md5 = String(repeating: "e", count: 32)

        repo.remember(
            SharedFavoriteRef(
                bookstrId: "shared-id",
                libvaultMd5: nil,
                isbn: nil,
                url: "https://example.org/multi.epub",
                title: "By Book Id",
                author: "Author A",
                year: nil,
                format: "epub",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
            updatedAt: 1,
        )
        repo.remember(
            SharedFavoriteRef(
                bookstrId: nil,
                libvaultMd5: md5,
                isbn: nil,
                url: "https://example.org/multi.epub",
                title: "By Md5",
                author: "Author B",
                year: "2026",
                format: "pdf",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
            updatedAt: 5,
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "shared-id",
                libvaultMd5: md5,
                isbn: nil,
                url: "https://example.org/multi.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("By Md5", enriched[0].title)
        XCTAssertEqual("Author B", enriched[0].author)
        XCTAssertEqual("2026", enriched[0].year)
        XCTAssertEqual("pdf", enriched[0].format)
    }

    func testRememberSkipsRefWithoutAnyIdentityKeys() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.remember(
            SharedFavoriteRef(
                bookstrId: nil,
                libvaultMd5: nil,
                isbn: nil,
                url: "https://example.org/identity-less.epub",
                title: "Identity-less",
                author: "No id",
                year: "2026",
                format: "epub",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            ),
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: nil,
                libvaultMd5: nil,
                isbn: nil,
                url: "https://example.org/identity-less.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertNil(enriched[0].bookstrId)
        XCTAssertNil(enriched[0].title)
        XCTAssertNil(enriched[0].author)
        XCTAssertNil(enriched[0].isbn)
        XCTAssertNil(enriched[0].format)
    }

    func testEnrichFillsMissingIsbnFromCachedMetadata() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)

        repo.remember(
            SharedFavoriteRef(
                bookstrId: "book-isbn-cache",
                libvaultMd5: String(repeating: "b", count: 32),
                isbn: "978-0-12-345-678-9",
                url: "https://example.org/isbn-cache.epub",
                title: "ISBN title",
                author: "ISBN author",
                year: "2025",
                format: "pdf",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: "book-isbn-cache",
                libvaultMd5: nil,
                isbn: nil,
                url: "https://example.org/isbn-cache.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("978-0-12-345-678-9", enriched[0].isbn)
        XCTAssertEqual("ISBN title", enriched[0].title)
    }

    func testEnrichFillsMissingBookstrIdFromCachedMetadata() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-" + UUID().uuidString)
        let repo = FavoriteMetadataRepository(fileStore: store)
        let md5 = String(repeating: "f", count: 32)

        repo.remember(
            SharedFavoriteRef(
                bookstrId: "cached-book-id",
                libvaultMd5: md5,
                isbn: nil,
                url: "https://example.org/bridge.epub",
                title: "Bridge title",
                author: "Bridge author",
                year: nil,
                format: "epub",
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        )

        let enriched = repo.enrich([
            SharedFavoriteRef(
                bookstrId: nil,
                libvaultMd5: md5,
                isbn: nil,
                url: "https://example.org/bridge.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil,
            )
        ])

        XCTAssertEqual("cached-book-id", enriched[0].bookstrId)
        XCTAssertEqual("Bridge title", enriched[0].title)
    }
}
