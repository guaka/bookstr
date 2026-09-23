import Foundation

final class AppContainer: ObservableObject {
    @MainActor static let shared = AppContainer.bootstrap()
    let settingsRepository: SettingsRepository
    let progressRepository: ProgressRepository
    let vocabularyRepository: VocabularyRepository
    let snippetRepository: SnippetRepository
    let wordNavigation: WordNavigationState
    let readerPlayback: ReaderPlaybackSession
    let dictionaryRepository: DictionaryRepository
    let favoriteMetadataRepository: FavoriteMetadataRepository
    let downloads = BookDownloadQueue(fileURL: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("bookstr/downloads.json"))
    let catalogRepository: CatalogRepository
    let coverDiscovery: CoverDiscoveryService
    let nostrClient: NostrClient
    let signerStore: SignerStore
    let nostrSyncService: NostrSyncService
    let nip46Service: Nip46Service

    init(
        settingsRepository: SettingsRepository,
        progressRepository: ProgressRepository,
        vocabularyRepository: VocabularyRepository,
        snippetRepository: SnippetRepository,
        wordNavigation: WordNavigationState = WordNavigationState(),
        readerPlayback: ReaderPlaybackSession = ReaderPlaybackSession(),
        dictionaryRepository: DictionaryRepository,
        favoriteMetadataRepository: FavoriteMetadataRepository,
        catalogRepository: CatalogRepository,
        coverDiscovery: CoverDiscoveryService,
        nostrClient: NostrClient,
        signerStore: SignerStore,
        nostrSyncService: NostrSyncService,
        nip46Service: Nip46Service
    ) {
        self.settingsRepository = settingsRepository
        self.progressRepository = progressRepository
        self.vocabularyRepository = vocabularyRepository
        self.snippetRepository = snippetRepository
        self.wordNavigation = wordNavigation
        self.readerPlayback = readerPlayback
        self.dictionaryRepository = dictionaryRepository
        self.favoriteMetadataRepository = favoriteMetadataRepository
        self.catalogRepository = catalogRepository
        self.coverDiscovery = coverDiscovery
        self.nostrClient = nostrClient
        self.signerStore = signerStore
        self.nostrSyncService = nostrSyncService
        self.nip46Service = nip46Service
    }

    @MainActor static func bootstrap() -> AppContainer {
        let fileStore = JSONFileStore(subdirectory: "bookstr")
        let settings = SettingsRepository()
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-library-fixtures") {
            LibraryUITestFixtures.install(fileStore: fileStore, settings: settings)
        }
#endif
        let progress = ProgressRepository(fileStore: fileStore)
        let words = VocabularyRepository(fileStore: fileStore)
        let snippets = SnippetRepository(fileStore: fileStore)
        let dictionary = DictionaryRepository()
        let favoriteMetadata = FavoriteMetadataRepository(fileStore: fileStore)
        let nostr = NostrClient()
        let nip46 = Nip46Service()
        let signerStore = SignerStore(nip46Service: nip46)
        let catalog: CatalogRepository
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-torrent-fixture") {
            catalog = LibraryUITestFixtures.torrentCatalog(fileStore: fileStore, settings: settings, signerStore: signerStore, nip46: nip46)
        } else {
            catalog = CatalogRepository(fileStore: fileStore, settings: settings, signerStore: signerStore, nip46Service: nip46)
        }
#else
        catalog = CatalogRepository(fileStore: fileStore, settings: settings, signerStore: signerStore, nip46Service: nip46)
#endif
        let sync = NostrSyncService(
            settings: settings,
            progress: progress,
            vocabulary: words,
            snippets: snippets,
            favoriteMetadata: favoriteMetadata,
            client: nostr,
            signerStore: signerStore,
            nip46Service: nip46
        )
        return AppContainer(
            settingsRepository: settings,
            progressRepository: progress,
            vocabularyRepository: words,
            snippetRepository: snippets,
            dictionaryRepository: dictionary,
            favoriteMetadataRepository: favoriteMetadata,
            catalogRepository: catalog,
            coverDiscovery: CoverDiscoveryService(fileStore: fileStore),
            nostrClient: nostr,
            signerStore: signerStore,
            nostrSyncService: sync,
            nip46Service: nip46
        )
    }
}
