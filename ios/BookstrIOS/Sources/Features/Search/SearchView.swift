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

    var body: some View {
        Group {
            if results.isEmpty {
                ContentUnavailableView("Search books", systemImage: "magnifyingglass", description: Text(message ?? "Title, author, ISBN, publisher"))
            } else {
                List(results) { result in
                    HStack(alignment: .top, spacing: 10) {
                        Button { openedBook = result.asCatalogBook() } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.title).font(.headline).foregroundStyle(.primary)
                                Text(result.author).font(.subheadline).foregroundStyle(.secondary)
                                Text(metadata(result)).font(.caption).foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .disabled(!result.isReadable)

                        Button { Task { await toggleFavorite(result) } } label: {
                            Image(systemName: isFavorite(result) ? "heart.fill" : "heart")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(isFavorite(result) ? "Remove from favorites" : "Add to favorites")
                    }
                }
                .listStyle(.plain)
            }
        }
        .bookstrScreenTitle("Search")
        .searchable(text: $query, prompt: "Title, author, ISBN, publisher")
        .onSubmit(of: .search) { Task { await runSearch() } }
        .overlay { if searching { ProgressView() } }
        .navigationDestination(item: $openedBook) { ReaderHostView(book: $0) }
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

    private func isFavorite(_ result: BookSearchResult) -> Bool {
        favoriteIDs.contains(result.id) || knownBooks.contains { book in
            favoriteIDs.contains(book.id) && book.title.caseInsensitiveCompare(result.title) == .orderedSame
                && book.author.caseInsensitiveCompare(result.author) == .orderedSame
        }
    }

    private func toggleFavorite(_ result: BookSearchResult) async {
        let book = result.asFavoriteBook()
        do {
            let allBooks = Array(Dictionary((knownBooks + [book]).map { ($0.id, $0) },
                                            uniquingKeysWith: { _, latest in latest }).values)
            let updated = try await container.nostrSyncService.setFavorite(
                book: book, favorite: !isFavorite(result), books: allBooks
            )
            knownBooks = allBooks
            favoriteIDs = updated.bookIds
            message = isFavorite(result) ? "Added to Nostr favorites" : "Removed from Nostr favorites"
            NotificationCenter.default.post(name: .bookstrIdentityDidChange, object: nil)
        } catch {
            message = error.localizedDescription
        }
    }

    private func refreshFavoriteIDs() {
        favoriteIDs = container.nostrSyncService.cachedFavorites(seedBooks: knownBooks).bookIds
    }

    private func metadata(_ result: BookSearchResult) -> String {
        [result.year, result.publisher, result.format?.rawValue.uppercased()].compactMap { $0 }.joined(separator: " · ")
    }
}
