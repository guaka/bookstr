import XCTest

@testable import BookstrIOS

final class AppContainerTests: XCTestCase {
    @MainActor
    func testLibraryPullDownFilterMatchesBookMetadata() {
        let epub = CatalogBook(
            id: "epub", title: "EPUB", author: "Author", epubUrl: "https://example.org/book.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub,
            blossomSha256: nil, year: nil
        )
        let cbz = CatalogBook(
            id: "cbz", title: "Comic", author: "Artist", epubUrl: "https://example.org/book.cbz",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .cbz,
            blossomSha256: nil, year: nil, language: "ja"
        )
        let external = ExternalFavorite(
            key: "external", title: "External comic", author: "Artist", year: nil,
            url: nil, isbn: nil, libvaultMd5: nil, format: "CBZ",
            blossomSha256: nil, blossomUrl: nil
        )

        XCTAssertEqual(LibraryViewModel.filtered([epub, cbz], by: "comic artist").map(\.id), ["cbz"])
        XCTAssertEqual(LibraryViewModel.filtered([epub, cbz], by: "CBZ").map(\.id), ["cbz"])
        XCTAssertEqual(LibraryViewModel.filtered([epub, cbz], by: "JA").map(\.id), ["cbz"])
        XCTAssertEqual(LibraryViewModel.filtered([epub, cbz], by: "  ").map(\.id), ["epub", "cbz"])
        XCTAssertEqual(LibraryViewModel.filtered([external], by: "external artist").map(\.key), ["external"])
        XCTAssertTrue(LibraryViewModel.filtered([external], by: "PDF").isEmpty)
    }

    func testBootstrapProvidesWordNavigationState() {
        let container = AppContainer.bootstrap()

        XCTAssertNotNil(container.wordNavigation)
    }

    func testBootstrapProvidesReaderPlaybackSession() {
        let container = AppContainer.bootstrap()
        let book = CatalogBook(
            id: "alice", title: "Alice", author: "Carroll", epubUrl: "https://example.org/a.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub,
            blossomSha256: nil, year: nil
        )

        container.readerPlayback.present(book: book)
        container.readerPlayback.updateSpeechState(retained: true, playing: true)
        container.readerPlayback.requestClose()

        XCTAssertEqual(container.readerPlayback.item?.book.id, "alice")
        XCTAssertFalse(container.readerPlayback.isVisible)
        XCTAssertTrue(container.readerPlayback.showsBackgroundSpeechControl)
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

    func testLibraryForegroundLoadPlanAlwaysAppliesCacheAndDefersNetworkWithIdentity() {
        let withIdentity = LibraryForegroundLoadPlan.make(hasNostrIdentity: true)
        XCTAssertTrue(withIdentity.applyCachedFavorites)
        XCTAssertTrue(withIdentity.scheduleBackgroundNostrRefresh)

        let withoutIdentity = LibraryForegroundLoadPlan.make(hasNostrIdentity: false)
        XCTAssertTrue(withoutIdentity.applyCachedFavorites)
        XCTAssertFalse(withoutIdentity.scheduleBackgroundNostrRefresh)
    }

    @MainActor
    func testLibraryLoadReturnsImmediatelyFromCacheWhenNostrIdentityExists() async {
        let suite = "bookstr-library-load-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            return XCTFail("Could not create isolated UserDefaults")
        }
        defaults.removePersistentDomain(forName: suite)
        defer { defaults.removePersistentDomain(forName: suite) }

        let fileStore = JSONFileStore(subdirectory: suite)
        let settings = SettingsRepository(defaults: defaults)
        let pubkey = String(repeating: "d", count: 64)
        settings.authMode = .nsec
        settings.pubkeyHex = pubkey
        settings.relays = []
        settings.lastReadingMetadataSync = Date()
        settings.lastApplicationDataSync = Date()
        let plaintext = FavoritesParser.serializeTags(
            FavoritesParser.collectionHeader(title: "Favorites", updatedAt: 1_700_000_000)
                + FavoritesParser.compactItemTags(
                    refs: [
                        SharedFavoriteRef(
                            bookstrId: "cached-book",
                            libvaultMd5: nil,
                            isbn: nil,
                            url: nil,
                            title: "Cached Book",
                            author: "Author",
                            year: nil,
                            format: "epub",
                            blossomSha256: nil,
                            blossomUrl: nil,
                            addedAt: 1_700_000_000
                        )
                    ],
                    fallbackAddedAt: 1_700_000_000
                )
        )
        settings.cacheNostrFavorites(pubkey: pubkey, plaintext: plaintext, eventId: "evt-cache")

        let progress = ProgressRepository(fileStore: fileStore)
        let words = VocabularyRepository(fileStore: fileStore)
        let snippets = SnippetRepository(fileStore: fileStore)
        let favoriteMetadata = FavoriteMetadataRepository(fileStore: fileStore)
        let nip46 = Nip46Service()
        let signerStore = SignerStore(nip46Service: nip46)
        let sync = NostrSyncService(
            settings: settings,
            progress: progress,
            vocabulary: words,
            snippets: snippets,
            favoriteMetadata: favoriteMetadata,
            client: NostrClient(),
            signerStore: signerStore,
            nip46Service: nip46
        )
        let container = AppContainer(
            settingsRepository: settings,
            progressRepository: progress,
            vocabularyRepository: words,
            snippetRepository: snippets,
            dictionaryRepository: DictionaryRepository(),
            favoriteMetadataRepository: favoriteMetadata,
            catalogRepository: CatalogRepository(
                fileStore: fileStore,
                settings: settings,
                signerStore: signerStore,
                nip46Service: nip46
            ),
            nostrClient: NostrClient(),
            signerStore: signerStore,
            nostrSyncService: sync,
            nip46Service: nip46
        )

        let viewModel = LibraryViewModel()
        viewModel.attach(container)
        let started = Date()
        await viewModel.load()
        let elapsed = Date().timeIntervalSince(started)
        viewModel.cancelPendingNetworkRefresh()

        XCTAssertLessThan(elapsed, 1.5, "Foreground load must not await relay pulls")
        XCTAssertTrue(viewModel.hasNostrIdentity)
        XCTAssertTrue(
            viewModel.debugText.contains("showing cache; nostr refresh scheduled"),
            viewModel.debugText
        )
    }
}
