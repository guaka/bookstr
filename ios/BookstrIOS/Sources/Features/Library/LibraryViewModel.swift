import Foundation

enum LibrarySort: String, CaseIterable, Identifiable {
    case recent
    case title
    case author
    case progress

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

/// Cache-first Library load: never block the foreground path on relay/Amber work.
struct LibraryForegroundLoadPlan: Equatable {
    var applyCachedFavorites: Bool
    var scheduleBackgroundNostrRefresh: Bool

    static func make(hasNostrIdentity: Bool) -> Self {
        Self(
            applyCachedFavorites: true,
            scheduleBackgroundNostrRefresh: hasNostrIdentity
        )
    }
}

@MainActor
final class LibraryViewModel: ObservableObject {
    @Published var reading: [CatalogBook] = []
    @Published var favorites: [CatalogBook] = []
    @Published var externalFavorites: [ExternalFavorite] = []
    @Published var progress: [String: BookProgress] = [:]
    @Published var errorMessage: String?
    @Published var hasNostrIdentity = false
    @Published var debugText = "Library debug will appear here after load."

    private var container: AppContainer?
    private var isLoading = false
    private var pendingReload = false
    private var networkRefreshTask: Task<Void, Never>?

    func attach(_ container: AppContainer) {
        self.container = container
    }

    /// Cancels an in-flight background Nostr refresh (used by tests and teardown).
    func cancelPendingNetworkRefresh() {
        networkRefreshTask?.cancel()
        networkRefreshTask = nil
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
        let plan = LibraryForegroundLoadPlan.make(hasNostrIdentity: hasNostrIdentity)
        var debug: [String] = ["=== library load ==="]

        var localBooks = container.catalogRepository.downloadedBooks()
        localBooks.forEach { container.favoriteMetadataRepository.remember(book: $0) }
        debug.append("downloaded books: \(localBooks.count)")
        debug.append("words cached: \(container.vocabularyRepository.all().count)")

        if plan.applyCachedFavorites {
            let shared = container.nostrSyncService.cachedFavorites(seedBooks: localBooks)
            localBooks = container.catalogRepository.downloadedBooks(externalFavorites: shared.external)
            apply(shared: shared, seed: localBooks, container: container)
        }

        if plan.scheduleBackgroundNostrRefresh {
            debug.append("showing cache; nostr refresh scheduled")
            debugText = debug.joined(separator: "\n")
            scheduleNetworkRefresh(seedBooks: localBooks, container: container)
        } else {
            debug.append("skipped favorites pull: no nostr identity")
            debug.append("=== shown ===")
            debug.append("favorites: \(favorites.count)")
            debug.append("external leftover: \(externalFavorites.count)")
            debug.append("reading: \(reading.count)")
            debugText = debug.joined(separator: "\n")
        }
    }

    /// Relay pulls and Amber decrypt must not sit on the foreground load path.
    /// Cache is already applied; network results merge when they arrive.
    private func scheduleNetworkRefresh(seedBooks: [CatalogBook], container: AppContainer) {
        networkRefreshTask?.cancel()
        networkRefreshTask = Task { [weak self] in
            guard let self else { return }
            var debug: [String] = [
                "=== library load ===",
                "downloaded books: \(seedBooks.count)",
                "=== nostr refresh ==="
            ]
            debugText = "Fetching favorites… Open Amber if it asks to decrypt."

            let readingMetadata = await container.nostrSyncService.pullReadingMetadata()
            guard !Task.isCancelled else { return }
            debug.append("reading metadata cached: \(readingMetadata)")

            let pulled = await container.nostrSyncService.pullFavorites(seedBooks: seedBooks)
            guard !Task.isCancelled else { return }

            let localBooks = container.catalogRepository.downloadedBooks(externalFavorites: pulled.favorites.external)
            debug.append("=== favorites pull ===")
            debug.append(pulled.debug)
            apply(shared: pulled.favorites, seed: localBooks, container: container)
            if let pullError = pulled.error {
                errorMessage = pullError
            } else if favorites.isEmpty && externalFavorites.isEmpty {
                errorMessage = "No Bookstr favorites found on relays. Pull to refresh, and approve the decrypt request if asked."
            }

            debug.append("=== shown ===")
            debug.append("favorites: \(favorites.count)")
            debug.append("external leftover: \(externalFavorites.count)")
            debug.append("reading: \(reading.count)")
            debugText = debug.joined(separator: "\n")
        }
    }

    private func apply(
        shared: SharedFavorites,
        seed: [CatalogBook],
        container: AppContainer
    ) {
        let downloadableFavorites = shared.external.compactMap(CatalogRepository.fromExternalFavorite)
        let books = uniqued(seed + downloadableFavorites, by: \.id)
        let favoriteIDs = shared.bookIds
            .union(Set(downloadableFavorites.map(\.id)))
        let representedMD5s = Set(downloadableFavorites.compactMap(\.libvaultMd5))
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

    static func sorted(
        _ books: [CatalogBook],
        by sort: LibrarySort,
        progress: [String: BookProgress]
    ) -> [CatalogBook] {
        books.sorted { lhs, rhs in
            let lhsProgress = progress[lhs.id]
            let rhsProgress = progress[rhs.id]
            switch sort {
            case .recent:
                let lhsDate = lhsProgress?.updatedAt ?? 0
                let rhsDate = rhsProgress?.updatedAt ?? 0
                if lhsDate != rhsDate { return lhsDate > rhsDate }
            case .title:
                break
            case .author:
                let authors = lhs.author.localizedCaseInsensitiveCompare(rhs.author)
                if authors != .orderedSame { return authors == .orderedAscending }
            case .progress:
                let lhsValue = lhsProgress?.progression ?? 0
                let rhsValue = rhsProgress?.progression ?? 0
                if lhsValue != rhsValue { return lhsValue > rhsValue }
            }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    static func sorted(_ favorites: [ExternalFavorite], by sort: LibrarySort) -> [ExternalFavorite] {
        favorites.sorted { lhs, rhs in
            switch sort {
            case .recent, .progress:
                let lhsDate = lhs.addedAt ?? 0
                let rhsDate = rhs.addedAt ?? 0
                if lhsDate != rhsDate { return lhsDate > rhsDate }
            case .author:
                let authors = (lhs.author ?? "").localizedCaseInsensitiveCompare(rhs.author ?? "")
                if authors != .orderedSame { return authors == .orderedAscending }
            case .title:
                break
            }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
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
