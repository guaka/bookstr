import SwiftUI

struct BookSearchRequest: Equatable {
    let id = UUID()
    let query: String
}

struct SearchView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var playback: ReaderPlaybackSession
    var requestedQuery: BookSearchRequest?
    var isActive = true
    @State private var query = ""
    @State private var programmaticQuery: String?
    @State private var handledRequestID: UUID?
    @State private var searchPresented = false
    @State private var results: [BookSearchResult] = []
    @State private var searching = false
    @State private var nextOffset: Int?
    @State private var automaticLoadOffset: Int?
    @State private var searchedQuery = ""
    @State private var searchGeneration = UUID()
    @State private var searchTask: Task<Void, Never>?
    @State private var message: String?
    @State private var showingDownloads = false
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
            if results.isEmpty && nextOffset == nil {
                ContentUnavailableView("Search books", systemImage: "magnifyingglass", description: Text(message ?? "Title, author, ISBN, publisher"))
            } else {
                List {
                  if visibleResults.isEmpty {
                      ContentUnavailableView("No matches", systemImage: "line.3.horizontal.decrease.circle",
                                             description: Text("No loaded results match the selected filters."))
                  }
                  ForEach(visibleResults) { result in
                    Button { Task { await open(result) } } label: {
                        BookListDetails(title: result.title, author: result.author, year: result.year,
                                        format: result.format?.rawValue, language: result.language,
                                        publisher: result.publisher, coverURL: result.coverUrl, bookID: result.id,
                                        rights: result.rights)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("search.open.\(result.id)")
                    .contextMenu {
                        Button("Rights details") {
                            rightsDetails = RightsDetailsItem(
                                title: result.title, author: result.author, year: result.year,
                                format: result.format?.rawValue, rights: result.rights,
                                coverURL: result.coverUrl, bookID: result.id
                            )
                        }
                    }
                    .bookstrListRow()
                  }
                  if let nextOffset {
                      HStack(spacing: 8) {
                          if searching { ProgressView() }
                          Text(searching ? "Loading more books…" : "Scroll down for more books")
                              .font(.footnote)
                              .foregroundStyle(.secondary)
                      }
                      .frame(maxWidth: .infinity, minHeight: 44)
                      .accessibilityIdentifier("search-pagination-status")
                      .onAppear(perform: loadMoreIfNeeded)
                      .onDisappear {
                          if !searching { automaticLoadOffset = nil }
                      }
                      .id(nextOffset)
                  }
                }
                .listStyle(.plain)
                .contentMargins(.horizontal, 0, for: .scrollContent)
            }
        }
        .bookstrScreenTitle("Search")
        .searchable(
            text: $query,
            isPresented: $searchPresented,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Title, author, ISBN, publisher"
        )
        .onSubmit(of: .search) {
            searchTask?.cancel()
            searchTask = Task { await runSearch() }
        }
        .onChange(of: query) { _, newValue in
            if newValue == programmaticQuery {
                programmaticQuery = nil
                return
            }
            programmaticQuery = nil
            searchTask?.cancel()
            searchGeneration = UUID()
            searching = false
            nextOffset = nil
            automaticLoadOffset = nil
        }
        .onDisappear { searchTask?.cancel() }
        .onAppear(perform: startRequestedSearchIfReady)
        .onChange(of: requestedQuery?.id) { _, _ in startRequestedSearchIfReady() }
        .onChange(of: isActive) { _, _ in startRequestedSearchIfReady() }
        .overlay { if searching { ProgressView().allowsHitTesting(false) } }
        .toolbar {
            if languageOptions.count > 1 || !selectedLanguage.isEmpty {
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
            if formatOptions.count > 1 || !selectedFormat.isEmpty {
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
    }

    private func loadMoreIfNeeded() {
        guard let offset = nextOffset, !searching, automaticLoadOffset != offset else { return }
        automaticLoadOffset = offset
        searchTask = Task { await runSearch(more: true) }
    }

    private func startRequestedSearchIfReady() {
        guard isActive, let requestedQuery,
              handledRequestID != requestedQuery.id else { return }
        handledRequestID = requestedQuery.id
        programmaticQuery = requestedQuery.query
        query = requestedQuery.query
        searchPresented = false
        searchTask?.cancel()
        searchTask = Task { await runSearch(queryTerm: requestedQuery.query) }
    }

    private func runSearch(more: Bool = false, queryTerm: String? = nil) async {
        let term = more ? searchedQuery : (queryTerm ?? query).trimmingCharacters(in: .whitespacesAndNewlines)
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
            let readable = page.books.filter(\.isReadable)
            results = more ? CatalogSearchPage.merge(results, readable) : readable
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
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        if job.isDismissible {
                            Button("Remove", role: .destructive) {
                                queue.dismiss(job.id)
                            }
                            .accessibilityIdentifier("downloads.dismiss.\(job.id)")
                        }
                    }
                }
            }
            .navigationTitle("Downloads")
            .toolbar {
                Button("Done") { dismiss() }.accessibilityIdentifier("downloads.done")
            }
            .onAppear { queue.pruneCompleted() }
        }
    }
}
