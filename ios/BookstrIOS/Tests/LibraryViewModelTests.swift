import Foundation
import XCTest

@testable import BookstrIOS

final class LibraryViewModelTests: XCTestCase {
    @MainActor
    func testLoadDoesNotMarkReadingWithoutProgressOrLocation() async {
        let context = makeContext(withDownloadedBook: true, withProgress: true, progressValue: 0.0, progressLocator: "")
        defer { context.cleanup() }
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertTrue(model.reading.isEmpty)
    }

    @MainActor
    func testLoadMarksReadingWhenCfiExistsWithoutProgress() async {
        let context = makeContext(
            withDownloadedBook: true,
            withProgress: true,
            progressValue: 0.0,
            progressLocator: "epubcfi(/6/8)"
        )
        defer { context.cleanup() }
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertEqual(model.reading.map(\.id), [context.book.id])
    }

    @MainActor
    func testLoadMarksReadingWhenProgressIsPositiveWithoutCfi() async {
        let context = makeContext(
            withDownloadedBook: true,
            withProgress: true,
            progressValue: 0.42,
            progressLocator: ""
        )
        defer { context.cleanup() }
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertEqual(model.reading.map(\.id), [context.book.id])
    }

    @MainActor
    func testLoadDeduplicatesFavoritesById() async {
        let md5 = "cccccccccccccccccccccccccccccccc"
        let context = makeContext(withDownloadedBook: true, withNostrIdentity: true, bookMd5: md5)
        defer { context.cleanup() }
        context.settingsRepository.cacheNostrFavorites(
            pubkey: context.settingsRepository.pubkeyHex!,
            plaintext: FavoritesParser.serializeTags([
                ["book", "bookstr", context.book.id, "1700000000", context.book.epubUrl],
                ["book", "bookstr", context.book.id, "1700000001", context.book.epubUrl],
            ])
        )
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertEqual(model.favorites.count, 1)
        XCTAssertEqual(model.favorites.map(\.id), [context.book.id])
        XCTAssertTrue(model.externalFavorites.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    @MainActor
    func testLoadSortsReadingByUpdatedAtDescending() async {
        let newerBook = CatalogBook(
            id: String(repeating: "2", count: 64),
            title: "Newest Book",
            author: "Unit Author",
            epubUrl: "https://example.org/newest.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: .epub,
            blossomSha256: nil,
            year: "2025"
        )
        let context = makeContext(withDownloadedBook: true, additionalDownloadedBooks: [newerBook], withProgress: false)
        defer { context.cleanup() }
        context.progressRepository.save(bookId: context.book.id, progression: 0.2, cfi: "epubcfi(/6/1)")
        try? await Task.sleep(nanoseconds: 1_200_000_000)
        context.progressRepository.save(bookId: newerBook.id, progression: 0.6, cfi: "epubcfi(/7/1)")

        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertEqual(model.reading.map(\.id), [newerBook.id, context.book.id])
    }

    @MainActor
    func testLoadDropsExternalFavoriteWhenDownloadableEquivalentExists() async {
        let blossomSha256 = String(repeating: "a", count: 64)
        let context = makeContext(
            withDownloadedBook: true,
            withNostrIdentity: true,
            bookBlossomSha256: blossomSha256
        )
        defer { context.cleanup() }
        context.settingsRepository.cacheNostrFavorites(
            pubkey: context.settingsRepository.pubkeyHex!,
            plaintext: FavoritesParser.serializeTags([
                ["book", "blossom", blossomSha256, "1700000000", "https://blossom.bfr.ee/\(blossomSha256)"]
            ])
        )
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertEqual(model.favorites.map(\.id), [context.book.id])
        XCTAssertTrue(model.externalFavorites.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    @MainActor
    func testLoadKeepsUnmatchedExternalFavoriteWhenNoDownloadAvailable() async {
        let context = makeContext(withNostrIdentity: true)
        defer { context.cleanup() }
        context.settingsRepository.cacheNostrFavorites(
            pubkey: context.settingsRepository.pubkeyHex!,
            plaintext: FavoritesParser.serializeTags([
                ["book", "bookstr", "orphan-bookstr-id", "1700000000"]
            ])
        )
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertTrue(model.favorites.isEmpty)
        XCTAssertEqual(model.externalFavorites.map(\.id), ["orphan-bookstr-id"])
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.reading.isEmpty)
        XCTAssertTrue(model.hasNostrIdentity)
    }

    @MainActor
    func testLoadHydratesFavoriteFromCachedExternalWithoutIdentity() async {
        let context = makeContext(withDownloadedBook: true, bookId: "remote-book")
        defer { context.cleanup() }
        context.settingsRepository.pubkeyHex = String(repeating: "aa", count: 64)
        context.settingsRepository.cacheNostrFavorites(
            pubkey: context.settingsRepository.pubkeyHex!,
            plaintext: FavoritesParser.serializeTags([
                ["book", "bookstr", "remote-book", "1700000000", "https://example.org/read.epub"]
            ])
        )
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertFalse(model.hasNostrIdentity)
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.favorites.map(\.id), ["remote-book"])
        XCTAssertTrue(model.externalFavorites.isEmpty)
        XCTAssertTrue(model.reading.isEmpty)
    }

    @MainActor
    func testLoadKeepsUnmatchedExternalFavoriteWhenIdentityIsMissing() async {
        let context = makeContext()
        defer { context.cleanup() }
        context.settingsRepository.pubkeyHex = String(repeating: "cc", count: 64)
        context.settingsRepository.cacheNostrFavorites(
            pubkey: context.settingsRepository.pubkeyHex!,
            plaintext: FavoritesParser.serializeTags([
                ["book", "bookstr", "legacy-book", "1700000000"]
            ])
        )
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertFalse(model.hasNostrIdentity)
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.favorites.isEmpty)
        XCTAssertEqual(model.externalFavorites.map(\.id), ["legacy-book"])
        XCTAssertTrue(model.reading.isEmpty)
    }

    @MainActor
    func testLoadSetsNoFavoritesMessageWhenIdentityHasNoFavorites() async {
        let context = makeContext(withNostrIdentity: true)
        defer { context.cleanup() }
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertEqual(
            model.errorMessage,
            "No Bookstr favorites found on relays. Pull to refresh, and approve the decrypt request if asked."
        )
        XCTAssertTrue(model.reading.isEmpty)
        XCTAssertTrue(model.favorites.isEmpty)
        XCTAssertTrue(model.externalFavorites.isEmpty)
    }

    @MainActor
    func testLoadShowsNoFavoritesMessageWhenCachedFavoritesAreInvalidJSON() async {
        let context = makeContext(withNostrIdentity: true)
        defer { context.cleanup() }
        context.settingsRepository.cacheNostrFavorites(
            pubkey: context.settingsRepository.pubkeyHex!,
            plaintext: "not-json"
        )
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertEqual(
            model.errorMessage,
            "No Bookstr favorites found on relays. Pull to refresh, and approve the decrypt request if asked."
        )
        XCTAssertTrue(model.favorites.isEmpty)
        XCTAssertTrue(model.externalFavorites.isEmpty)
    }

    @MainActor
    func testLoadMarksNostrIdentityStateAndSkipsFavoritesPullWithoutIdentity() async {
        let context = makeContext(withDownloadedBook: true, withProgress: true, progressValue: 0.17, progressLocator: "epubcfi(/6/4)")
        defer { context.cleanup() }
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertFalse(model.hasNostrIdentity)
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.debugText.contains("skipped favorites pull: no nostr identity"))
        XCTAssertEqual(model.reading.map(\.id), [context.book.id])
    }

    @MainActor
    func testLoadSkipsFavoritesWarningWhenIdentityIsNotConfigured() async {
        let context = makeContext(withDownloadedBook: true, withProgress: true, progressValue: 0.33, progressLocator: "epubcfi(/6/1)")
        defer { context.cleanup() }
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.reading.map(\.id), [context.book.id])
        XCTAssertTrue(model.favorites.isEmpty)
        XCTAssertTrue(model.externalFavorites.isEmpty)
    }

    @MainActor
    func testLoadStoresProgressForDownloadedBook() async {
        let context = makeContext(withDownloadedBook: true, withProgress: true, progressValue: 0.63, progressLocator: "epubcfi(/6/8)")
        defer { context.cleanup() }
        let model = LibraryViewModel()
        model.attach(context.container)

        await model.load()

        let trackedProgress = model.progress[context.book.id]
        XCTAssertEqual(trackedProgress?.progression, 0.63, accuracy: 0.0001)
        XCTAssertEqual(trackedProgress?.cfi, "epubcfi(/6/8)")
    }

    private func makeContext(
        withDownloadedBook: Bool = false,
        withProgress: Bool = false,
        progressValue: Double = 0.42,
        progressLocator: String = "epubcfi(/6/2)",
        bookId: String = String(repeating: "1", count: 64),
        bookMd5: String? = nil,
        bookBlossomSha256: String? = nil,
        additionalDownloadedBooks: [CatalogBook] = [],
        withNostrIdentity: Bool = false
    ) -> TestContext {
        let suite = "bookstr-library-viewmodel-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let settings = SettingsRepository(defaults: defaults)
        if withNostrIdentity {
            settings.authMode = .nsec
            settings.pubkeyHex = String(repeating: "aa", count: 64)
            settings.relays = ["%%%"]
        }
        let fileStoreSubdirectory = "bookstr-library-viewmodel-" + UUID().uuidString
        let fileStore = JSONFileStore(subdirectory: fileStoreSubdirectory)
        let progress = ProgressRepository(fileStore: fileStore)
        let vocabulary = VocabularyRepository(fileStore: fileStore)
        let dictionary = DictionaryRepository()
        let favoriteMetadata = FavoriteMetadataRepository(fileStore: fileStore)
        let nip46Service = Nip46Service()
        let signerStore = SignerStore(nip46Service: nip46Service)
        let catalog = CatalogRepository(
            fileStore: fileStore,
            settings: settings,
            signerStore: signerStore,
            nip46Service: nip46Service
        )
        let nostrClient = NostrClient()
        let sync = NostrSyncService(
            settings: settings,
            progress: progress,
            vocabulary: vocabulary,
            favoriteMetadata: favoriteMetadata,
            client: nostrClient,
            signerStore: signerStore,
            nip46Service: nip46Service
        )
        let container = AppContainer(
            settingsRepository: settings,
            progressRepository: progress,
            vocabularyRepository: vocabulary,
            dictionaryRepository: dictionary,
            favoriteMetadataRepository: favoriteMetadata,
            catalogRepository: catalog,
            nostrClient: nostrClient,
            signerStore: signerStore,
            nostrSyncService: sync,
            nip46Service: nip46Service
        )
        let book: CatalogBook = CatalogBook(
            id: bookId,
            title: "Test Book",
            author: "Unit Author",
            epubUrl: "https://example.org/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: bookMd5,
            format: .epub,
            blossomSha256: bookBlossomSha256,
            year: "2025"
        )

        if withDownloadedBook {
            var downloadedBooks = [book] + additionalDownloadedBooks
            fileStore.save("downloaded-books.json", value: downloadedBooks)
            fileStore.ensureBooksDirectory()
            for downloadedBook in downloadedBooks {
                let file = fileStore.bookFileURL(bookId: downloadedBook.id, format: downloadedBook.format)
                FileManager.default.createFile(atPath: file.path, contents: Data([0x50, 0x4b, 0x03, 0x04]))
            }

            if withProgress {
                progress.save(bookId: book.id, progression: progressValue, cfi: progressLocator)
            }
        }

        let rootDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let storeRoot = rootDirectory.appendingPathComponent(fileStoreSubdirectory, isDirectory: true)
        let cleanup: () -> Void = {
            try? FileManager.default.removeItem(at: storeRoot)
            defaults.removePersistentDomain(forName: suite)
        }
        return TestContext(
            container: container,
            settingsRepository: settings,
            book: book,
            progressRepository: progress,
            fileStore: fileStore,
            cleanup: cleanup
        )
    }

    private struct TestContext {
        let container: AppContainer
        let settingsRepository: SettingsRepository
        let book: CatalogBook
        let progressRepository: ProgressRepository
        let fileStore: JSONFileStore
        let cleanup: () -> Void
    }
}
