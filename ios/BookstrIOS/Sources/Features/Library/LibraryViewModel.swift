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
    private var coverRefreshTask: Task<Void, Never>?

    func attach(_ container: AppContainer) {
        self.container = container
    }

    /// Cancels an in-flight background Nostr refresh (used by tests and teardown).
    func cancelPendingNetworkRefresh() {
        networkRefreshTask?.cancel()
        networkRefreshTask = nil
        coverRefreshTask?.cancel()
        coverRefreshTask = nil
    }

    func deleteFromLibrary(_ book: CatalogBook) async {
        guard let container else { return }
        for id in CatalogRepository.publicationIdentityCandidates(for: book) {
            container.progressRepository.remove(bookId: id)
        }
        container.catalogRepository.removeFromLibrary(book)
        await load()
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

        var localBooks: [CatalogBook]
        if plan.applyCachedFavorites {
            let shared = container.nostrSyncService.cachedFavorites(
                seedBooks: container.catalogRepository.rememberedBooks()
            )
            localBooks = container.catalogRepository.downloadedBooks(externalFavorites: shared.external)
            localBooks.forEach { container.favoriteMetadataRepository.remember(book: $0) }
            debug.append("downloaded books: \(localBooks.count)")
            debug.append("words cached: \(container.vocabularyRepository.all().count)")
            apply(shared: shared, seed: localBooks, container: container)
        } else {
            localBooks = container.catalogRepository.downloadedBooks()
            localBooks.forEach { container.favoriteMetadataRepository.remember(book: $0) }
            debug.append("downloaded books: \(localBooks.count)")
            debug.append("words cached: \(container.vocabularyRepository.all().count)")
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
        scheduleCoverExtraction(seed: localBooks, container: container)
    }

    /// Extracts embedded covers off the foreground load path. Books without a
    /// cover URL row-update when the extraction finishes; every publication is
    /// only scanned once thanks to the covers/ cache.
    private func scheduleCoverExtraction(seed: [CatalogBook], container: AppContainer) {
        coverRefreshTask?.cancel()
        // `nil` = not scanned yet; `""` = scanned with no cover (skip).
        let pending = seed.filter { CatalogRepository.shouldScanEmbeddedCover(for: $0) }
        guard !pending.isEmpty else { return }
        coverRefreshTask = Task { [weak self] in
            let stamped = await container.catalogRepository.ensureEmbeddedCovers(for: pending)
            guard let self, !Task.isCancelled else { return }
            self.applyEmbeddedCovers(stamped)
        }
    }

    private func applyEmbeddedCovers(_ stamped: [CatalogBook]) {
        var covers: [String: String] = [:]
        for book in stamped {
            guard let cover = book.coverUrl else { continue }
            for key in CatalogRepository.publicationIdentityCandidates(for: book) {
                covers[key.lowercased()] = cover
            }
        }
        func restamp(_ book: CatalogBook) -> CatalogBook {
            var updated = book
            for key in CatalogRepository.publicationIdentityCandidates(for: book) {
                if let cover = covers[key.lowercased()], cover != book.coverUrl {
                    updated.coverUrl = cover
                    return updated
                }
            }
            return updated
        }
        reading = reading.map(restamp)
        favorites = favorites.map(restamp)
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
            scheduleCoverExtraction(seed: localBooks, container: container)
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
        // Prefer the record that already has a usable cover when the same
        // publication appears both as a download and as a favorite.
        let books = Self.uniquedPreferringCover(seed + downloadableFavorites)
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

        let downloadedIDs = Set(seed.map(\.id))
        reading = books
            .filter { book in downloadedIDs.contains(book.id) || hasStartedReading(progressMap[book.id]) }
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

    static func filtered(
        _ books: [CatalogBook],
        by query: String,
        facets: BookListFacetFilters = BookListFacetFilters()
    ) -> [CatalogBook] {
        let terms = filterTerms(query)
        return books.filter { book in
            facets.matches(language: book.language, format: book.format.rawValue)
                && (terms.isEmpty || matchesFilter(
                    terms,
                    values: [book.title, book.author, book.isbn, book.year, book.language, book.format.rawValue]
                ))
        }
    }

    static func filtered(
        _ favorites: [ExternalFavorite],
        by query: String,
        facets: BookListFacetFilters = BookListFacetFilters()
    ) -> [ExternalFavorite] {
        let terms = filterTerms(query)
        return favorites.filter { favorite in
            facets.matches(language: nil, format: favorite.format)
                && (terms.isEmpty || matchesFilter(
                    terms,
                    values: [favorite.title, favorite.author, favorite.isbn, favorite.year, favorite.format]
                ))
        }
    }

    private static func filterTerms(_ query: String) -> [String] {
        normalizedFilterText(query)
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
    }

    private static func matchesFilter(_ terms: [String], values: [String?]) -> Bool {
        let searchable = normalizedFilterText(values.compactMap { $0 }.joined(separator: " "))
        return terms.allSatisfy(searchable.contains)
    }

    private static func normalizedFilterText(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
    }

    private func externalMD5(_ favorite: ExternalFavorite) -> String? {
        let candidate = (favorite.libvaultMd5 ?? favorite.key).lowercased()
        guard candidate.count == 32, candidate.allSatisfy(\.isHexDigit) else { return nil }
        return candidate
    }

    /// Dedupes by book id, keeping a copy with a usable cover when one exists.
    static func uniquedPreferringCover(_ books: [CatalogBook]) -> [CatalogBook] {
        var byID: [String: CatalogBook] = [:]
        var order: [String] = []
        for book in books {
            let id = book.id.lowercased()
            if let existing = byID[id] {
                if !CatalogRepository.hasUsableCover(existing), CatalogRepository.hasUsableCover(book) {
                    byID[id] = book
                }
            } else {
                byID[id] = book
                order.append(id)
            }
        }
        return order.compactMap { byID[$0] }
    }
}
