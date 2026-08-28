import XCTest

@testable import BookstrIOS

final class AppContainerTests: XCTestCase {
    func testBootstrapProvidesWordNavigationState() {
        let container = AppContainer.bootstrap()

        XCTAssertNotNil(container.wordNavigation)
    }

    func testWordNavigationStateCanBeUsedFromContainer() {
        let container = AppContainer.bootstrap()

        container.wordNavigation.request(word: "  known-word  ")

        XCTAssertEqual(container.wordNavigation.requestedWord, "known-word")
        XCTAssertEqual(container.wordNavigation.requestToken, 1)
    }

    @MainActor
    func testLibrarySortsCatalogBooksByEveryOptionAndUsesTitleAsTieBreaker() {
        XCTAssertEqual(LibrarySort.allCases.map(\.id), ["recent", "title", "author", "progress"])
        XCTAssertEqual(LibrarySort.allCases.map(\.label), ["Recent", "Title", "Author", "Progress"])

        let alpha = CatalogBook(
            id: "alpha", title: "Alpha", author: "Zulu", epubUrl: "https://example.org/a.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub,
            blossomSha256: nil, year: nil
        )
        let beta = CatalogBook(
            id: "beta", title: "Beta", author: "Alice", epubUrl: "https://example.org/b.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub,
            blossomSha256: nil, year: nil
        )
        let progress = [
            alpha.id: BookProgress(bookId: alpha.id, progression: 0.2, cfi: "a", updatedAt: 20),
            beta.id: BookProgress(bookId: beta.id, progression: 0.8, cfi: "b", updatedAt: 10),
        ]

        XCTAssertEqual(LibraryViewModel.sorted([beta, alpha], by: .recent, progress: progress).map(\.id), ["alpha", "beta"])
        XCTAssertEqual(LibraryViewModel.sorted([beta, alpha], by: .title, progress: progress).map(\.id), ["alpha", "beta"])
        XCTAssertEqual(LibraryViewModel.sorted([alpha, beta], by: .author, progress: progress).map(\.id), ["beta", "alpha"])
        XCTAssertEqual(LibraryViewModel.sorted([alpha, beta], by: .progress, progress: progress).map(\.id), ["beta", "alpha"])
        XCTAssertEqual(LibraryViewModel.sorted([beta, alpha], by: .recent, progress: [:]).map(\.id), ["alpha", "beta"])
    }

    @MainActor
    func testLibrarySortsExternalFavoritesByEveryOptionAndUsesTitleAsTieBreaker() {
        let alpha = ExternalFavorite(
            key: "alpha", title: "Alpha", author: "Zulu", year: nil, url: nil, isbn: nil,
            libvaultMd5: nil, format: nil, blossomSha256: nil, blossomUrl: nil, addedAt: 20
        )
        let beta = ExternalFavorite(
            key: "beta", title: "Beta", author: "Alice", year: nil, url: nil, isbn: nil,
            libvaultMd5: nil, format: nil, blossomSha256: nil, blossomUrl: nil, addedAt: 10
        )

        XCTAssertEqual(LibraryViewModel.sorted([beta, alpha], by: .recent).map(\.id), ["alpha", "beta"])
        XCTAssertEqual(LibraryViewModel.sorted([beta, alpha], by: .title).map(\.id), ["alpha", "beta"])
        XCTAssertEqual(LibraryViewModel.sorted([alpha, beta], by: .author).map(\.id), ["beta", "alpha"])
        XCTAssertEqual(LibraryViewModel.sorted([beta, alpha], by: .progress).map(\.id), ["alpha", "beta"])

        let untimed = [
            ExternalFavorite(
                key: "beta-untimed", title: "Beta", author: nil, year: nil, url: nil, isbn: nil,
                libvaultMd5: nil, format: nil, blossomSha256: nil, blossomUrl: nil
            ),
            ExternalFavorite(
                key: "alpha-untimed", title: "Alpha", author: nil, year: nil, url: nil, isbn: nil,
                libvaultMd5: nil, format: nil, blossomSha256: nil, blossomUrl: nil
            ),
        ]
        XCTAssertEqual(LibraryViewModel.sorted(untimed, by: .recent).map(\.id), ["alpha-untimed", "beta-untimed"])
        XCTAssertEqual(LibraryViewModel.sorted(untimed, by: .author).map(\.id), ["alpha-untimed", "beta-untimed"])
    }
}
