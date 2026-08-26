import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var container: AppContainer
    @State private var query = ""
    @State private var results: [BookSearchResult] = []
    @State private var searching = false
    @State private var message: String?
    @State private var openedBook: CatalogBook?
    @State private var knownBooks: [CatalogBook] = []
    @State private var favoriteIDs = Set<String>()
    @State private var openingBookID: String?
    @State private var externalFavorites: [ExternalFavorite] = []
    @State private var favoriteBusyID: String?
    @State private var actionMessage: String?

    var body: some View {
        Group {
            if results.isEmpty {
                ContentUnavailableView("Search books", systemImage: "magnifyingglass", description: Text(message ?? "Title, author, ISBN, publisher"))
            } else {
                List(results) { result in
                    HStack(alignment: .top, spacing: 10) {
                        Button { Task { await open(result) } } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.title).font(.headline).foregroundStyle(.primary)
                                Text(result.author).font(.subheadline).foregroundStyle(.secondary)
                                Text(metadata(result)).font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .disabled(!result.isReadable || openingBookID != nil)

                        Button { Task { await toggleFavorite(result) } } label: {
                            if favoriteBusyID == result.id {
                                ProgressView().controlSize(.small)
                            } else {
                                Image(systemName: isFavorite(result) ? "heart.fill" : "heart")
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(favoriteBusyID != nil)
                        .accessibilityLabel(isFavorite(result) ? "Remove from favorites" : "Add to favorites")
                    }
                }
                .listStyle(.plain)
            }
        }
        .bookstrScreenTitle("Search")
        .searchable(text: $query, prompt: "Title, author, ISBN, publisher")
        .onSubmit(of: .search) { Task { await runSearch() } }
        .overlay { if searching || openingBookID != nil { ProgressView() } }
        .safeAreaInset(edge: .bottom) {
            if let actionMessage {
                Text(actionMessage)
                    .font(.footnote)
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 4)
                    .onTapGesture { self.actionMessage = nil }
            }
        }
        .fullScreenCover(item: $openedBook) { ReaderHostView(book: $0) }
        .task {
            knownBooks = container.catalogRepository.downloadedBooks()
            refreshFavoriteIDs()
        }
    }

    private func runSearch() async {
        guard query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else {
            message = "Type at least 2 characters to search."
            return
        }
        searching = true
        defer { searching = false }
        do {
            results = try await container.catalogRepository.search(query)
            message = results.isEmpty ? "No matches. Try a shorter query." : "\(results.count) results"
        } catch {
            results = []
            message = error.localizedDescription
        }
    }

    private func open(_ result: BookSearchResult) async {
        guard openingBookID == nil, let book = result.asCatalogBook() else { return }
        openingBookID = book.id
        defer { openingBookID = nil }
        do {
            let openedBook = try await container.catalogRepository.prepareForOpening(book: book)
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                self.openedBook = openedBook
            }
        } catch {
            message = "Could not open: \(error.localizedDescription)"
        }
    }

    private func isFavorite(_ result: BookSearchResult) -> Bool {
        favoriteIDs.contains(result.id)
            || externalFavorites.contains { SearchFavoriteMatcher.matches(result, favorite: $0) }
            || knownBooks.contains { book in
            favoriteIDs.contains(book.id) && book.title.caseInsensitiveCompare(result.title) == .orderedSame
                && book.author.caseInsensitiveCompare(result.author) == .orderedSame
        }
    }

    private func toggleFavorite(_ result: BookSearchResult) async {
        guard favoriteBusyID == nil else { return }
        let wasFavorite = isFavorite(result)
        favoriteBusyID = result.id
        actionMessage = wasFavorite ? "Removing favorite…" : "Saving favorite…"
        defer { favoriteBusyID = nil }
        let existing = externalFavorites.first { SearchFavoriteMatcher.matches(result, favorite: $0) }
        let book = existing.map(catalogBook(for:)) ?? result.asFavoriteBook()
        container.favoriteMetadataRepository.remember(book: book)
        do {
            let allBooks = Array(Dictionary((knownBooks + [book]).map { ($0.id, $0) },
                                            uniquingKeysWith: { _, latest in latest }).values)
            let updated = try await container.nostrSyncService.setFavorite(
                book: book, favorite: !wasFavorite, books: allBooks
            )
            knownBooks = allBooks
            favoriteIDs = updated.bookIds
            externalFavorites = updated.external
            actionMessage = wasFavorite ? "Removed from Nostr favorites" : "Added to Nostr favorites"
            NotificationCenter.default.post(name: .bookstrIdentityDidChange, object: nil)
        } catch {
            actionMessage = "Could not update favorite: \(error.localizedDescription)"
        }
    }

    private func catalogBook(for favorite: ExternalFavorite) -> CatalogBook {
        CatalogBook(
            id: favorite.key, title: favorite.title, author: favorite.author ?? "Unknown author",
            epubUrl: favorite.blossomUrl ?? favorite.url ?? "", coverUrl: nil,
            sourceUrl: favorite.url, isbn: favorite.isbn, libvaultMd5: favorite.libvaultMd5,
            format: BookFormat.from(format: favorite.format, url: favorite.blossomUrl ?? favorite.url ?? ""),
            blossomSha256: favorite.blossomSha256, year: favorite.year
        )
    }

    private func refreshFavoriteIDs() {
        let shared = container.nostrSyncService.cachedFavorites(seedBooks: knownBooks)
        favoriteIDs = shared.bookIds
        externalFavorites = shared.external
    }

    private func metadata(_ result: BookSearchResult) -> String {
        [result.year, result.publisher, result.format?.rawValue.uppercased()].compactMap { $0 }.joined(separator: " · ")
    }
}
