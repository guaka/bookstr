import XCTest
@testable import BookstrIOS

final class CatalogRepositoryPublicationIdentityCandidatesCoverageTests: XCTestCase {
    func testPublicationIdentityCandidatesNormalizesDeduplicatesAcrossIdentifierSources() {
        let book = CatalogBook(
            id: " " + String(repeating: "A", count: 64) + " ",
            title: "Normalized identity",
            author: "Author",
            epubUrl: "https://example.org/book.epub",
            coverUrl: nil,
            sourceUrl: "https://example.org/book.epub",
            isbn: nil,
            libvaultMd5: "  " + String(repeating: "C", count: 32) + "  ",
            format: .epub,
            blossomSha256: "  " + String(repeating: "B", count: 64) + "  ",
            year: nil
        )

        let candidates = CatalogRepository.publicationIdentityCandidates(for: book)

        XCTAssertEqual(candidates, [String(repeating: "a", count: 64), String(repeating: "b", count: 64), String(repeating: "c", count: 32)])
    }

    func testPublicationIdentityCandidatesFiltersBlankIdentifiers() {
        let book = CatalogBook(
            id: "   ",
            title: "No identifiers",
            author: "Author",
            epubUrl: "https://example.org/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: .epub,
            blossomSha256: "\t",
            year: nil
        )

        let candidates = CatalogRepository.publicationIdentityCandidates(for: book)

        XCTAssertTrue(candidates.isEmpty)
    }

    func testPublicationIdentityCandidatesSkipsMissingIdAndPreservesStableOrder() {
        let book = CatalogBook(
            id: "   ",
            title: "No main id",
            author: "Author",
            epubUrl: "https://example.org/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: "   " + String(repeating: "B", count: 32) + "   ",
            format: .epub,
            blossomSha256: "   " + String(repeating: "A", count: 64) + "   ",
            year: nil
        )

        let candidates = CatalogRepository.publicationIdentityCandidates(for: book)

        XCTAssertEqual(candidates, [String(repeating: "b", count: 32), String(repeating: "a", count: 64)])
    }

    func testPublicationIdentityCandidatesDeduplicatesMixedCaseDuplicates() {
        let book = CatalogBook(
            id: "A".repeating(32),
            title: "Mixed case",
            author: "Author",
            epubUrl: "https://example.org/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: String(repeating: "a", count: 32),
            format: .epub,
            blossomSha256: nil,
            year: nil
        )

        let candidates = CatalogRepository.publicationIdentityCandidates(for: book)

        XCTAssertEqual(candidates, [String(repeating: "a", count: 32)])
    }
}
