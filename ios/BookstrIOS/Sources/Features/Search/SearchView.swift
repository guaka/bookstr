import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var playback: ReaderPlaybackSession
    @State private var query = ""
    @State private var searchPresented = false
    @State private var results: [BookSearchResult] = []
    @State private var searching = false
    @State private var nextOffset: Int?
    @State private var searchedQuery = ""
    @State private var searchGeneration = UUID()
    @State private var searchTask: Task<Void, Never>?
    @State private var message: String?
    @State private var knownBooks: [CatalogBook] = []
    @State private var favoriteIDs = Set<String>()
    @State private var showingDownloads = false
    @State private var externalFavorites: [ExternalFavorite] = []
    @State private var favoriteBusyID: String?
    @State private var actionMessage: String?
    @State private var rightsDetails: RightsDetailsItem?
    @AppStorage("search_filter_language") private var selectedLanguage = ""
    @AppStorage("search_filter_format") private var selectedFormat = ""

    var body: some View {
        let languageOptions = BookListFacetFilters.languages(from: results.map(\.language))
        let formatOptions = BookListFacetFilters.formats(from: results.map { $0.format?.rawValue })
        var facets = BookListFacetFilters(language: selectedLanguage, format: selectedFormat)
        facets.sanitize(languages: languageOptions, formats: formatOptions)
        let visibleResults = results.filter {
            facets.matches(language: $0.language, format: $0.format?.rawValue)
        }

        return Group {
            if results.isEmpty {
                ContentUnavailableView("Search books", systemImage: "magnifyingglass", description: Text(message ?? "Title, author, ISBN, publisher"))
            } else if visibleResults.isEmpty {
                ContentUnavailableView("No matches", systemImage: "line.3.horizontal.decrease.circle", description: Text("No results match the selected filters."))
            } else {
                List {
                  ForEach(visibleResults) { result in
                    HStack(alignment: .top, spacing: 10) {
                        Button { Task { await open(result) } } label: {
                            BookListDetails(title: result.title, author: result.author, year: result.year,
                                            format: result.format?.rawValue, language: result.language,
                                            publisher: result.publisher, coverURL: result.coverUrl,
                                            rights: result.rights)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("search.open.\(result.id)")
                        .disabled(!result.isReadable)
                        .contextMenu {
                            Button("Rights details") {
                                rightsDetails = RightsDetailsItem(
                                    title: result.title, author: result.author, year: result.year,
                                    format: result.format?.rawValue, rights: result.rights
                                )
                            }
                        }

                        Button { Task { await toggleFavorite(result) } } label: {
                            if favoriteBusyID == result.id {
                                ProgressView().controlSize(.small)
                            } else {
                                Image(systemName: isFavorite(result) ? "heart.fill" : "heart")
                            }
                        }
                        .buttonStyle(.plain)
                        .frame(width: 32, height: 44)
                        .disabled(favoriteBusyID != nil)
                        .accessibilityLabel(isFavorite(result) ? "Remove from favorites" : "Add to favorites")
                    }
                    .bookstrListRow()
                  }
                  if nextOffset != nil {
                      Button { searchTask = Task { await runSearch(more: true) } } label: { Image(systemName: "arrow.down") }
                          .accessibilityLabel("Load more catalog results")
                          .accessibilityIdentifier("search.load-more")
                          .disabled(searching)
                  }
                }
                .listStyle(.plain)
                .contentMargins(.horizontal, 0, for: .scrollContent)
            }
        }
        .bookstrScreenTitle("Search")
        .searchable(text: $query, isPresented: $searchPresented, prompt: "Title, author, ISBN, publisher")
        .onSubmit(of: .search) {
            searchTask?.cancel()
            searchTask = Task { await runSearch() }
        }
        .onChange(of: query) { _, _ in
            searchTask?.cancel()
            searchGeneration = UUID()
            searching = false
            nextOffset = nil
        }
        .onDisappear { searchTask?.cancel() }
        .overlay { if searching { ProgressView().allowsHitTesting(false) } }
        .toolbar {
            if languageOptions.count > 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Language", selection: $selectedLanguage) {
                            Text("All languages").tag("")
                            ForEach(languageOptions, id: \.self) { language in
                                Text(BookListFacetFilters.displayLabel(for: language)).tag(language)
                            }
                        }
                    } label: {
                        Image(systemName: selectedLanguage.isEmpty ? "globe" : "globe.badge.chevron.backward")
                    }
                    .accessibilityLabel("Filter by language")
                    .accessibilityIdentifier("search-language-filter")
                }
            }
            if formatOptions.count > 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Format", selection: $selectedFormat) {
                            Text("All formats").tag("")
                            ForEach(formatOptions, id: \.self) { format in
                                Text(BookListFacetFilters.displayLabel(for: format)).tag(format)
                            }
                        }
                    } label: {
                        Image(systemName: selectedFormat.isEmpty ? "doc" : "doc.badge.ellipsis")
                    }
                    .accessibilityLabel("Filter by format")
                    .accessibilityIdentifier("search-format-filter")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingDownloads = true } label: { Image(systemName: "arrow.down.circle") }
                    .accessibilityLabel("Downloads")
                    .accessibilityIdentifier("search.downloads")
            }
        }
        .onChange(of: languageOptions) { _, options in
            if !selectedLanguage.isEmpty, !options.contains(selectedLanguage) {
                selectedLanguage = ""
            }
        }
        .onChange(of: formatOptions) { _, options in
            if !selectedFormat.isEmpty, !options.contains(selectedFormat) {
                selectedFormat = ""
            }
        }
        .sheet(isPresented: $showingDownloads) {
            DownloadsPane(queue: container.downloads)
        }
        .safeAreaInset(edge: .bottom) {
            if let actionMessage {
                Text(actionMessage)
                    .accessibilityIdentifier("search.download-status")
                    .font(.footnote)
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 4)
                    .onTapGesture { self.actionMessage = nil }
            }
        }
        .sheet(item: $rightsDetails) { RightsDetailsView(item: $0) }
        .task {
            knownBooks = container.catalogRepository.downloadedBooks()
            refreshFavoriteIDs()
        }
    }

    private func runSearch(more: Bool = false) async {
        let term = more ? searchedQuery : query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard term.count >= 2 else {
            message = "Type at least 2 characters to search."
            return
        }
        let generation = UUID()
        searchGeneration = generation
        let offset = more ? (nextOffset ?? 0) : 0
        if !more { nextOffset = nil }
        searching = true
        defer { if searchGeneration == generation { searching = false } }
        do {
            let page = try await container.catalogRepository.searchPage(term, offset: offset)
            guard searchGeneration == generation, !Task.isCancelled else { return }
            results = more ? CatalogSearchPage.merge(results, page.books) : page.books
            nextOffset = page.nextOffset
            searchedQuery = term
            message = results.isEmpty ? "No matches. Try a shorter query." : "\(results.count) results"
            actionMessage = page.warning
        } catch {
            guard searchGeneration == generation, !Task.isCancelled else { return }
            if !more { results = [] }
            message = error.localizedDescription
            actionMessage = error.localizedDescription
        }
    }

    private func open(_ result: BookSearchResult) async {
        guard result.isReadable else { return }
        if let book = result.asCatalogBook(), container.catalogRepository.localPublication(for: book) != nil {
            do { playback.present(book: try await container.catalogRepository.prepareForOpening(result: result)) }
            catch { actionMessage = error.localizedDescription }
        } else {
            container.downloads.enqueue(result, prepare: container.catalogRepository.prepareForOpening)
            searchPresented = false
            showingDownloads = true
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
            epubUrl: favorite.blossomUrl ?? favorite.url ?? "", coverUrl: favorite.coverUrl,
            sourceUrl: favorite.url, isbn: favorite.isbn, libvaultMd5: favorite.libvaultMd5,
            format: BookFormat.from(format: favorite.format, url: favorite.blossomUrl ?? favorite.url ?? ""),
            blossomSha256: favorite.blossomSha256, year: favorite.year,
            rightsStatus: favorite.rightsStatus, license: favorite.license,
            licenseUrl: favorite.licenseUrl, rightsSource: favorite.rightsSource
        )
    }

    private func refreshFavoriteIDs() {
        let shared = container.nostrSyncService.cachedFavorites(seedBooks: knownBooks)
        favoriteIDs = shared.bookIds
        externalFavorites = shared.external
    }


}

struct DownloadsPane: View {
    @ObservedObject var queue: BookDownloadQueue
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var playback: ReaderPlaybackSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if let error = queue.persistenceError { Text(error).foregroundStyle(.red) }
                ForEach(queue.jobs) { job in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(job.result.title).font(.subheadline.weight(.semibold)).accessibilityIdentifier("downloads.book.\(job.id)")
                        Text(job.result.author).font(.footnote).foregroundStyle(.secondary)
                        Text(job.status).font(.caption).accessibilityIdentifier("downloads.status.\(job.id)")
                        if let book = job.book {
                            Button("Open") { dismiss(); playback.present(book: book) }
                                .accessibilityIdentifier("downloads.open.\(job.id)")
                        } else if job.failed {
                            Button("Retry") { queue.enqueue(job.result, prepare: container.catalogRepository.prepareForOpening) }
                                .accessibilityIdentifier("downloads.retry.\(job.id)")
                        }
                    }
                }
            }
            .navigationTitle("Downloads")
            .toolbar {
                Button("Done") { dismiss() }.accessibilityIdentifier("downloads.done")
            }
        }
    }
}
