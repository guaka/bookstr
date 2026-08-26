import XCTest
@testable import BookstrIOS

private struct LegacyFavoriteMetadataCacheEntry: Codable {
    let book: CatalogBook
    let fetchedAt: Date
}

final class FavoriteMetadataRepositoryLegacyCoverageTests: XCTestCase {
    func testInitializeFromLegacyFavoriteMetadataSchema() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-legacy-" + UUID().uuidString)
        store.save("favorite-metadata.json", value: [
            "Legacy-BOOK-Entry": LegacyFavoriteMetadataCacheEntry(
                book: CatalogBook(
                    id: "legacy-metadata-book",
                    title: "Legacy title",
                    author: "Legacy author",
                    epubUrl: "https://example.org/legacy.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: "9780123456789",
                    libvaultMd5: String(repeating: "a", count: 32),
                    format: .epub,
                    blossomSha256: nil,
                    year: "2026"
                ),
                fetchedAt: Date(timeIntervalSince1970: 1_700_000_000)
            ),
        ])

        let repository = FavoriteMetadataRepository(fileStore: store)
        let enriched = repository.enrich([
            SharedFavoriteRef(
                bookstrId: nil,
                libvaultMd5: nil,
                isbn: nil,
                url: "https://example.org/fallback.epub",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil
            )
        ])
        XCTAssertEqual("Legacy title", enriched[0].title)
        XCTAssertEqual("Legacy author", enriched[0].author)
        XCTAssertEqual("2026", enriched[0].year)
        XCTAssertEqual("legacy-metadata-book", enriched[0].bookstrId)
        XCTAssertEqual("9780123456789", enriched[0].isbn)
        XCTAssertEqual("epub", enriched[0].format)
    }

    func testInitializeFromLegacyFavoriteMetadataSchemaSupportsIsbnIdentityMatch() {
        let store = JSONFileStore(subdirectory: "bookstr-fav-meta-legacy-isbn-" + UUID().uuidString)
        store.save("favorite-metadata.json", value: [
            "Legacy-ISBN-Entry": LegacyFavoriteMetadataCacheEntry(
                book: CatalogBook(
                    id: "isbn-legacy-book",
                    title: "ISBN Legacy",
                    author: "ISBN Legacy Author",
                    epubUrl: "https://example.org/isbn.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: "9789999999999",
                    libvaultMd5: String(repeating: "f", count: 32),
                    format: .pdf,
                    blossomSha256: nil,
                    year: nil
                ),
                fetchedAt: Date(timeIntervalSince1970: 1_700_000_100)
            ),
        ])

        let repository = FavoriteMetadataRepository(fileStore: store)
        let enriched = repository.enrich([
            SharedFavoriteRef(
                bookstrId: nil,
                libvaultMd5: nil,
                isbn: "9789999999999",
                url: "https://example.org/fallback.pdf",
                title: nil,
                author: nil,
                year: nil,
                format: nil,
                blossomSha256: nil,
                blossomUrl: nil,
                addedAt: nil
            )
        ])
        XCTAssertEqual("ISBN Legacy", enriched[0].title)
        XCTAssertEqual("ISBN Legacy Author", enriched[0].author)
        XCTAssertEqual("isbn-legacy-book", enriched[0].bookstrId)
        XCTAssertEqual("9789999999999", enriched[0].isbn)
        XCTAssertEqual("pdf", enriched[0].format)
    }
}
