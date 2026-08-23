import Foundation

final class AppContainer: ObservableObject {
    let settingsRepository: SettingsRepository
    let progressRepository: ProgressRepository
    let vocabularyRepository: VocabularyRepository
    let dictionaryRepository: DictionaryRepository
    let catalogRepository: CatalogRepository
    let nostrClient: NostrClient
    let signerStore: SignerStore
    let nostrSyncService: NostrSyncService
    let nip46Service: Nip46Service

    init(
        settingsRepository: SettingsRepository,
        progressRepository: ProgressRepository,
        vocabularyRepository: VocabularyRepository,
        dictionaryRepository: DictionaryRepository,
        catalogRepository: CatalogRepository,
        nostrClient: NostrClient,
        signerStore: SignerStore,
        nostrSyncService: NostrSyncService,
        nip46Service: Nip46Service
    ) {
        self.settingsRepository = settingsRepository
        self.progressRepository = progressRepository
        self.vocabularyRepository = vocabularyRepository
        self.dictionaryRepository = dictionaryRepository
        self.catalogRepository = catalogRepository
        self.nostrClient = nostrClient
        self.signerStore = signerStore
        self.nostrSyncService = nostrSyncService
        self.nip46Service = nip46Service
    }

    static func bootstrap() -> AppContainer {
        let fileStore = JSONFileStore(subdirectory: "bookstr")
        let settings = SettingsRepository()
        let progress = ProgressRepository(fileStore: fileStore)
        let words = VocabularyRepository(fileStore: fileStore)
        let dictionary = DictionaryRepository()
        let nostr = NostrClient()
        let nip46 = Nip46Service()
        let signerStore = SignerStore(nip46Service: nip46)
        let catalog = CatalogRepository(fileStore: fileStore, settings: settings, signerStore: signerStore, nip46Service: nip46)
        let sync = NostrSyncService(
            settings: settings,
            progress: progress,
            vocabulary: words,
            client: nostr,
            signerStore: signerStore,
            nip46Service: nip46
        )
        return AppContainer(
            settingsRepository: settings,
            progressRepository: progress,
            vocabularyRepository: words,
            dictionaryRepository: dictionary,
            catalogRepository: catalog,
            nostrClient: nostr,
            signerStore: signerStore,
            nostrSyncService: sync,
            nip46Service: nip46
        )
    }
}
