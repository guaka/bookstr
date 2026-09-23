import XCTest
import SherpaOnnx
import UIKit
import SwiftUI

@testable import BookstrIOS

@MainActor
final class AppContainerTests: XCTestCase {
    func testLibraryRedrawDoesNotReloadUnchangedDownloads() async throws {
        let container = AppContainer.bootstrap()
        let model = LibraryViewModel()
        var refreshes = 0
        let observation = model.$reading.dropFirst().sink { _ in refreshes += 1 }
        let host = UIHostingController(rootView: NavigationStack {
            LibraryView(viewModel: model)
        }.environmentObject(container).environmentObject(container.readerPlayback))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            observation.cancel()
            model.cancelPendingNetworkRefresh()
        }
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertGreaterThan(refreshes, 0, "The hosted Library must perform its initial load")
        let initialRefreshes = refreshes
        for index in 0..<10 {
            model.debugText = "Redraw \(index)"
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTAssertEqual(refreshes, initialRefreshes, "Redraws must not restart Library loading")
    }

    func testFavoriteMetadataConcurrentRefreshPreservesNewestEntryAndPersistence() throws {
        let directory = "bookstr-metadata-race-\(UUID().uuidString)"
        let fileStore = JSONFileStore(subdirectory: directory)
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(directory)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = FavoriteMetadataRepository(fileStore: fileStore)
        let md5 = String(repeating: "a", count: 32)
        let lookup = SharedFavoriteRef(libvaultMd5: md5)
        repository.remember(SharedFavoriteRef(bookstrId: "book", libvaultMd5: md5,
                                              title: "Title 0", author: "Author 0"), updatedAt: 0)

        // Distinct keys force dictionary growth while readers and overlapping
        // updates exercise the same cache used by the background favorites pull.
        DispatchQueue.concurrentPerform(iterations: 200) { index in
            repository.remember(SharedFavoriteRef(bookstrId: "book-\(index)",
                                                  title: "Other \(index)"), updatedAt: Int64(index))
            repository.remember(SharedFavoriteRef(bookstrId: "book", libvaultMd5: md5,
                                                  title: "Title \(index)", author: "Author \(index)"),
                                updatedAt: Int64(index))
            let cached = repository.enrich([lookup])[0]
            XCTAssertEqual(cached.title?.replacingOccurrences(of: "Title", with: "Author"), cached.author)
        }

        for cache in [repository, FavoriteMetadataRepository(fileStore: fileStore)] {
            let cached = try XCTUnwrap(cache.enrich([lookup]).first)
            XCTAssertEqual(cached.title, "Title 199")
            XCTAssertEqual(cached.author, "Author 199")
            XCTAssertEqual(cached.bookstrId, "book")
            let others = cache.enrich((0..<200).map { SharedFavoriteRef(bookstrId: "book-\($0)") })
            XCTAssertEqual(others.map(\.title), (0..<200).map { "Other \($0)" })
        }
    }

    func testFavoriteMetadataBatchesBooksAndIgnoresUnchangedRefreshes() throws {
        let directory = "bookstr-metadata-batch-\(UUID().uuidString)"
        let fileStore = JSONFileStore(subdirectory: directory)
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(directory)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = FavoriteMetadataRepository(fileStore: fileStore)
        let books = (0..<70).map { index in
            CatalogBook(
                id: "book-\(index)", title: "Title \(index)", author: "Author \(index)",
                epubUrl: "https://example.test/\(index).epub", coverUrl: nil, sourceUrl: nil,
                isbn: nil, libvaultMd5: nil, format: .epub, year: "2026"
            )
        }

        repository.remember(books: books, updatedAt: 100)
        let metadataURL = root.appendingPathComponent("favorite-metadata.json")
        let originalIdentifier = try metadataURL.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier
        repository.remember(books: books, updatedAt: 200)
        let unchangedIdentifier = try metadataURL.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier
        XCTAssertEqual(String(describing: unchangedIdentifier), String(describing: originalIdentifier))

        let reloaded = FavoriteMetadataRepository(fileStore: fileStore)
        let refs = books.map { SharedFavoriteRef(bookstrId: $0.id) }
        XCTAssertEqual(reloaded.enrich(refs).map(\.title), books.map(\.title))
        XCTAssertEqual(reloaded.enrich(refs).map(\.author), books.map(\.author))
    }

    func testDownloadedDutchAndPortugueseModelsGenerateAudioWhenSwitching() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        SpeechModelCatalog.rootDirectoryOverride = root
        defer {
            SpeechModelCatalog.rootDirectoryOverride = nil
            try? FileManager.default.removeItem(at: root)
        }
        let store = SpeechModelStore()
        for engine in [SpeechEngineID.dutchDii, .portuguesePortugal] {
            await store.install(engine)
            XCTAssertNil(store.errorMessage)
            XCTAssertTrue(store.isInstalled(engine))
        }
        for (engine, text) in [(SpeechEngineID.dutchDii, "Hallo, dit is een Nederlands boek."),
                               (.portuguesePortugal, "Olá, este é um livro em português."),
                               (.dutchDii, "We lezen verder in het Nederlands.")] {
            try autoreleasepool {
                let spec = try XCTUnwrap(SpeechModelCatalog.model(engine))
                guard case .vits(let model) = spec.kind else { return XCTFail("Expected Piper") }
                let vits = sherpaOnnxOfflineTtsVitsModelConfig(
                    model: spec.fileURL(model).path, tokens: spec.tokensURL.path,
                    dataDir: spec.dataDirectory.path
                )
                let modelConfig = sherpaOnnxOfflineTtsModelConfig(vits: vits, numThreads: 2)
                var config = sherpaOnnxOfflineTtsConfig(model: modelConfig, maxNumSentences: 1)
                let synthesizer = SherpaOnnxOfflineTtsWrapper(config: &config)
                let audio = synthesizer.generate(text: text, sid: 0, speed: 1)
                XCTAssertGreaterThan(audio.sampleRate, 0)
                XCTAssertGreaterThan(audio.samples.count, Int(audio.sampleRate))
                XCTAssertTrue(audio.samples.contains { abs($0) > 0.001 })
            }
        }
    }

    @MainActor
    func testComicZoomStartsFittedAndClampsToSupportedRange() {
        let controller = ComicReaderController()
        XCTAssertEqual(controller.zoomScale, ComicReaderController.fitZoom)
        controller.updateZoom(99)
        XCTAssertEqual(controller.zoomScale, ComicReaderController.maximumZoom)
        controller.updateZoom(0)
        XCTAssertEqual(controller.zoomScale, ComicReaderController.minimumZoom)
        controller.fitPage()
        XCTAssertEqual(controller.zoomScale, ComicReaderController.fitZoom)
    }

    @MainActor
    func testLibraryPullDownFilterMatchesBookMetadata() {
        let epub = CatalogBook(
            id: "epub", title: "EPUB", author: "Author", epubUrl: "https://example.org/book.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub, year: nil
        )
        let cbz = CatalogBook(
            id: "cbz", title: "Comic", author: "Artist", epubUrl: "https://example.org/book.cbz",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .cbz, year: nil, language: "ja"
        )
        let external = ExternalFavorite(
            key: "external", title: "External comic", author: "Artist", year: nil,
            url: nil, isbn: nil, libvaultMd5: nil, format: "CBZ"
        )

        XCTAssertEqual(LibraryViewModel.filtered([epub, cbz], by: "comic artist").map(\.id), ["cbz"])
        XCTAssertEqual(LibraryViewModel.filtered([epub, cbz], by: "CBZ").map(\.id), ["cbz"])
        XCTAssertEqual(LibraryViewModel.filtered([epub, cbz], by: "JA").map(\.id), ["cbz"])
        XCTAssertEqual(LibraryViewModel.filtered([epub, cbz], by: "  ").map(\.id), ["epub", "cbz"])
        XCTAssertEqual(LibraryViewModel.filtered([external], by: "external artist").map(\.key), ["external"])
        XCTAssertTrue(LibraryViewModel.filtered([external], by: "PDF").isEmpty)
    }

    func testLibraryDedupesPreferringUsableCover() {
        let withoutCover = CatalogBook(
            id: "book", title: "T", author: "A", epubUrl: "https://example.org/a.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub, year: nil
        )
        let withCover = CatalogBook(
            id: "book", title: "T", author: "A", epubUrl: "https://example.org/a.epub",
            coverUrl: "https://covers.example/a.jpg", sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .epub, year: nil
        )
        let merged = LibraryViewModel.uniquedPreferringCover([withoutCover, withCover])
        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged.first?.coverUrl, "https://covers.example/a.jpg")

        let keepFirst = LibraryViewModel.uniquedPreferringCover([withCover, withoutCover])
        XCTAssertEqual(keepFirst.first?.coverUrl, "https://covers.example/a.jpg")
    }

    func testBootstrapProvidesWordNavigationState() {
        let container = AppContainer.bootstrap()

        XCTAssertNotNil(container.wordNavigation)
    }

    func testBootstrapProvidesReaderPlaybackSession() {
        let container = AppContainer.bootstrap()
        let book = CatalogBook(
            id: "alice", title: "Alice", author: "Carroll", epubUrl: "https://example.org/a.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub, year: nil
        )

        container.readerPlayback.present(book: book)
        container.readerPlayback.updateSpeechState(retained: true, playing: true)
        container.readerPlayback.requestClose()

        XCTAssertEqual(container.readerPlayback.item?.book.id, "alice")
        XCTAssertFalse(container.readerPlayback.isVisible)
        XCTAssertTrue(container.readerPlayback.showsBackgroundSpeechControl)

        let nonce = container.readerPlayback.presentationNonce
        container.readerPlayback.updateSpeechState(retained: false, playing: false)
        container.readerPlayback.present(book: book)
        XCTAssertTrue(container.readerPlayback.isVisible)
        XCTAssertEqual(container.readerPlayback.presentationNonce, nonce)
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
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub, year: nil
        )
        let beta = CatalogBook(
            id: "beta", title: "Beta", author: "Alice", epubUrl: "https://example.org/b.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub, year: nil
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
            libvaultMd5: nil, format: nil, addedAt: 20
        )
        let beta = ExternalFavorite(
            key: "beta", title: "Beta", author: "Alice", year: nil, url: nil, isbn: nil,
            libvaultMd5: nil, format: nil, addedAt: 10
        )

        XCTAssertEqual(LibraryViewModel.sorted([beta, alpha], by: .recent).map(\.id), ["alpha", "beta"])
        XCTAssertEqual(LibraryViewModel.sorted([beta, alpha], by: .title).map(\.id), ["alpha", "beta"])
        XCTAssertEqual(LibraryViewModel.sorted([alpha, beta], by: .author).map(\.id), ["beta", "alpha"])
        XCTAssertEqual(LibraryViewModel.sorted([beta, alpha], by: .progress).map(\.id), ["alpha", "beta"])

        let untimed = [
            ExternalFavorite(
                key: "beta-untimed", title: "Beta", author: nil, year: nil, url: nil, isbn: nil,
                libvaultMd5: nil, format: nil
            ),
            ExternalFavorite(
                key: "alpha-untimed", title: "Alpha", author: nil, year: nil, url: nil, isbn: nil,
                libvaultMd5: nil, format: nil
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

    func testReaderOpeningMessageUsesBookTitle() {
        let titled = CatalogBook(
            id: "a", title: "  Alice  ", author: "Carroll", epubUrl: "https://example.org/a.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub, year: nil
        )
        let blank = CatalogBook(
            id: "b", title: "   ", author: "Author", epubUrl: "https://example.org/b.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .pdf, year: nil
        )
        XCTAssertEqual(ReaderHostView.openingMessage(for: titled), "Opening Alice…")
        XCTAssertEqual(ReaderHostView.openingMessage(for: blank), "Opening book…")
    }

    /// `downloadedBooksLock` is not recursive. Remembering or removing a book
    /// while it is held used to re-enter it and hang the launch path forever,
    /// which showed up as a blank first frame. Time-box it so a regression
    /// fails instead of blocking the suite.
    func testRememberAndRemoveDoNotReenterTheDownloadedBooksLock() throws {
        let subdirectory = "bookstr-lock-reentry-\(UUID().uuidString)"
        let fileStore = JSONFileStore(subdirectory: subdirectory)
        fileStore.ensureBooksDirectory()
        fileStore.ensureCoversDirectory()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: subdirectory))
        defaults.removePersistentDomain(forName: subdirectory)
        let settings = SettingsRepository(defaults: defaults)
        let nip46 = Nip46Service()
        let catalog = CatalogRepository(
            fileStore: fileStore,
            settings: settings,
            signerStore: SignerStore(nip46Service: nip46),
            nip46Service: nip46
        )
        let bookID = String(repeating: "b", count: 64)
        let book = CatalogBook(
            id: bookID, title: "Locked", author: "Author", epubUrl: "",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub, year: nil
        )
        fileStore.save("downloaded-books.json", value: [book])

        let finished = expectation(description: "remember and remove complete")
        DispatchQueue.global().async {
            catalog.removeFromLibrary(book)
            _ = catalog.downloadedBooks()
            finished.fulfill()
        }
        wait(for: [finished], timeout: 5)

        XCTAssertTrue(fileStore.load("downloaded-books.json", as: [CatalogBook].self, fallback: []).isEmpty)
    }

    @MainActor
    func testLibraryDeleteRemovesLocalPublicationAndProgress() async throws {
        let subdirectory = "bookstr-library-delete-\(UUID().uuidString)"
        let fileStore = JSONFileStore(subdirectory: subdirectory)
        fileStore.ensureBooksDirectory()
        fileStore.ensureCoversDirectory()
        let bookID = String(repeating: "a", count: 64)
        let book = CatalogBook(
            id: bookID, title: "Delete Me", author: "Author", epubUrl: "",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .pdf, year: nil
        )
        let publication = fileStore.bookFileURL(bookId: bookID, format: .pdf)
        let pdf = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 300, height: 400)).pdfData { context in
            context.beginPage()
            "Downloaded but unread".draw(at: CGPoint(x: 20, y: 20), withAttributes: nil)
        }
        try pdf.write(to: publication)
        let cover = fileStore.coverFileURL(bookId: bookID, ext: "jpg")
        try Data([0xFF, 0xD8, 0xFF, 0xD9]).write(to: cover)
        fileStore.save("downloaded-books.json", value: [book])

        let defaults = try XCTUnwrap(UserDefaults(suiteName: subdirectory))
        defer { defaults.removePersistentDomain(forName: subdirectory) }
        let settings = SettingsRepository(defaults: defaults)
        let progress = ProgressRepository(fileStore: fileStore)
        progress.save(bookId: bookID, progression: 0.4, cfi: "here")
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
        let catalog = CatalogRepository(
            fileStore: fileStore,
            settings: settings,
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
            catalogRepository: catalog,
            nostrClient: NostrClient(),
            signerStore: signerStore,
            nostrSyncService: sync,
            nip46Service: nip46
        )

        let viewModel = LibraryViewModel()
        viewModel.attach(container)
        // A completed download is visible even before it has any reading progress.
        progress.remove(bookId: bookID)
        await viewModel.load()
        XCTAssertTrue(viewModel.reading.contains { $0.id == bookID })
        XCTAssertTrue(viewModel.favorites.isEmpty)
        await viewModel.deleteFromLibrary(book)
        XCTAssertFalse(viewModel.reading.contains { $0.id == bookID })

        XCTAssertFalse(FileManager.default.fileExists(atPath: publication.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: cover.path))
        XCTAssertTrue(fileStore.load("downloaded-books.json", as: [CatalogBook].self, fallback: []).isEmpty)
        XCTAssertEqual(progress.get(bookId: bookID).cfi, "")
        viewModel.cancelPendingNetworkRefresh()
    }
}
