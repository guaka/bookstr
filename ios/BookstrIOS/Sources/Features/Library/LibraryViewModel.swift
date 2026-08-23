import Foundation

@MainActor
final class LibraryViewModel: ObservableObject {
    @Published var reading: [CatalogBook] = []
    @Published var favorites: [CatalogBook] = []
    @Published var externalFavorites: [ExternalFavorite] = []
    @Published var progress: [String: BookProgress] = [:]
    @Published var errorMessage: String?
    @Published var hasNostrIdentity = false
    @Published var debugText = "Library debug will appear here after load."
    @Published var resolvingFavoriteKeys = Set<String>()

    private var container: AppContainer?
    private var isLoading = false
    private var pendingReload = false
    private var currentShared = SharedFavorites()
    private var currentSeed: [CatalogBook] = []
    private var hydratedBooks: [CatalogBook] = []

    func attach(_ container: AppContainer) {
        self.container = container
    }

    func load() async {
        if isLoading {
            pendingReload = true
            return
        }
        isLoading = true
        defer { isLoading = false }
        repeat {
            pendingReload = false
            await loadOnce()
        } while pendingReload
    }

    private func loadOnce() async {
        guard let container else { return }
        errorMessage = nil
        hasNostrIdentity = container.settingsRepository.hasNostrIdentity
        debugText = "Fetching favorites… Open Amber if it asks to decrypt."
        var debug: [String] = ["=== library load ==="]

        let localBooks = container.catalogRepository.downloadedBooks()
        currentSeed = localBooks
        debug.append("downloaded books: \(localBooks.count)")
        debug.append("words cached: \(container.vocabularyRepository.all().count)")

        var shared = container.nostrSyncService.cachedFavorites(seedBooks: localBooks)
        currentShared = shared
        apply(shared: shared, seed: localBooks, container: container)
        var hydrated = await container.catalogRepository.resolveLibVaultFavorites(shared.external)
        hydratedBooks = hydrated
        apply(shared: shared, seed: localBooks, hydrated: hydrated, container: container)

        if container.settingsRepository.hasNostrIdentity {
            let pulled = await container.nostrSyncService.pullFavorites(seedBooks: localBooks)
            shared = pulled.favorites
            currentShared = shared
            debug.append("=== favorites pull ===")
            debug.append(pulled.debug)
            hydrated = await container.catalogRepository.resolveLibVaultFavorites(shared.external)
            hydratedBooks = hydrated
            apply(shared: shared, seed: localBooks, hydrated: hydrated, container: container)
            if let pullError = pulled.error {
                errorMessage = pullError
            } else if favorites.isEmpty && externalFavorites.isEmpty {
                errorMessage = "No Bookstr favorites found on relays. Pull to refresh, and approve the decrypt request if asked."
            }
        } else {
            debug.append("skipped favorites pull: no nostr identity")
        }

        debug.append("=== shown ===")
        debug.append("favorites: \(favorites.count)")
        debug.append("external leftover: \(externalFavorites.count)")
        debug.append("metadata hydrated: \(hydrated.count)")
        debug.append("reading: \(reading.count)")
        debugText = debug.joined(separator: "\n")
    }

    func resolveMetadata(for favorite: ExternalFavorite) async {
        guard let container, !resolvingFavoriteKeys.contains(favorite.key) else { return }
        resolvingFavoriteKeys.insert(favorite.key)
        defer { resolvingFavoriteKeys.remove(favorite.key) }
        errorMessage = nil
        guard let book = await container.catalogRepository.resolveLibVaultFavorite(favorite) else {
            errorMessage = "No LibVault metadata was found for \(favorite.libvaultMd5 ?? favorite.key). Tap to try again."
            return
        }
        hydratedBooks = uniqued(hydratedBooks + [book], by: \.id)
        apply(shared: currentShared, seed: currentSeed, hydrated: hydratedBooks, container: container)
    }

    private func apply(
        shared: SharedFavorites,
        seed: [CatalogBook],
        hydrated: [CatalogBook] = [],
        container: AppContainer
    ) {
        let downloadableFavorites = shared.external.compactMap(CatalogRepository.fromExternalFavorite)
        let books = uniqued(seed + downloadableFavorites + hydrated, by: \.id)
        let favoriteIDs = shared.bookIds
            .union(Set(downloadableFavorites.map(\.id)))
            .union(Set(hydrated.map(\.id)))
        let representedMD5s = Set((downloadableFavorites + hydrated).compactMap(\.libvaultMd5))
        let downloadableKeys = Set(shared.external.compactMap { favorite in
            CatalogRepository.fromExternalFavorite(favorite) == nil ? nil : favorite.key
        })

        var progressMap: [String: BookProgress] = [:]
        for book in books {
            progressMap[book.id] = container.progressRepository.get(bookId: book.id)
        }

        reading = books
            .filter { book in hasStartedReading(progressMap[book.id]) }
            .sorted { (progressMap[$0.id]?.updatedAt ?? 0) > (progressMap[$1.id]?.updatedAt ?? 0) }
        favorites = books.filter { favoriteIDs.contains($0.id) }
        externalFavorites = shared.external.filter { favorite in
            if downloadableKeys.contains(favorite.key) { return false }
            guard let md5 = externalMD5(favorite) else { return true }
            return !representedMD5s.contains(md5)
        }
        progress = progressMap
        hasNostrIdentity = container.settingsRepository.hasNostrIdentity
        if !favorites.isEmpty || !externalFavorites.isEmpty {
            errorMessage = nil
        }
    }

    private func hasStartedReading(_ progress: BookProgress?) -> Bool {
        guard let progress else { return false }
        return !progress.cfi.isEmpty || progress.progression > 0
    }

    private func externalMD5(_ favorite: ExternalFavorite) -> String? {
        let candidate = (favorite.libvaultMd5 ?? favorite.key).lowercased()
        guard candidate.count == 32, candidate.allSatisfy(\.isHexDigit) else { return nil }
        return candidate
    }

    private func uniqued(_ books: [CatalogBook], by key: KeyPath<CatalogBook, String>) -> [CatalogBook] {
        var seen = Set<String>()
        return books.filter { seen.insert($0[keyPath: key]).inserted }
    }
}
