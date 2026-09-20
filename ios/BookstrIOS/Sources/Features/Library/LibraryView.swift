import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var playback: ReaderPlaybackSession
    @StateObject private var viewModel = LibraryViewModel()
    @State private var openError: String?
    @State private var openingBookID: String?
    @State private var rightsDetails: RightsDetailsItem?
    @State private var libraryFilter = ""
    @State private var pendingDeletion: CatalogBook?
    @AppStorage("library_sort") private var selectedSort = LibrarySort.recent
    @AppStorage("library_filter_language") private var selectedLanguage = ""
    @AppStorage("library_filter_format") private var selectedFormat = ""

    var body: some View {
        let languageOptions = BookListFacetFilters.languages(
            from: viewModel.reading.map(\.language) + viewModel.favorites.map(\.language)
        )
        let formatOptions = BookListFacetFilters.formats(
            from: viewModel.reading.map { $0.format.rawValue }
                + viewModel.favorites.map { $0.format.rawValue }
                + viewModel.externalFavorites.map(\.format)
        )
        var facets = BookListFacetFilters(language: selectedLanguage, format: selectedFormat)
        facets.sanitize(languages: languageOptions, formats: formatOptions)
        let activeFacets = facets

        let filteredReading = LibraryViewModel.filtered(
            viewModel.reading, by: libraryFilter, facets: activeFacets
        )
        let filteredFavorites = LibraryViewModel.filtered(
            viewModel.favorites, by: libraryFilter, facets: activeFacets
        )
        let filteredExternalFavorites = LibraryViewModel.filtered(
            viewModel.externalFavorites, by: libraryFilter, facets: activeFacets
        )
        let sortedReading = LibraryViewModel.sorted(
            filteredReading, by: selectedSort, progress: viewModel.progress
        )
        let sortedFavorites = LibraryViewModel.sorted(
            filteredFavorites, by: selectedSort, progress: viewModel.progress
        )
        let sortedExternalFavorites = LibraryViewModel.sorted(
            filteredExternalFavorites, by: selectedSort
        )

        return List {
            if let error = viewModel.errorMessage {
                Section {
                    Button(error) {
                        Task { await viewModel.load() }
                    }
                    .foregroundStyle(.red)
                }
            }

            Section("Books") {
                if sortedReading.isEmpty {
                    Text(viewModel.reading.isEmpty
                         ? "Downloaded books will appear here."
                         : "No books match your filter.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(sortedReading) { book in
                        Button { open(book) } label: {
                            bookRow(book, showProgress: true)
                        }
                        .disabled(openingBookID != nil)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("library-book-\(book.id)")
                        .bookstrListRow()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("Delete", role: .destructive) {
                                pendingDeletion = book
                            }
                            .accessibilityIdentifier("library-delete-\(book.id)")
                        }
                        .contextMenu {
                            Button("Rights details") { rightsDetails = details(for: book) }
                            Button("Delete", role: .destructive) { pendingDeletion = book }
                        }
                    }
                }
            }

            Section("Favorites") {
                if sortedFavorites.isEmpty && sortedExternalFavorites.isEmpty {
                    Text(viewModel.favorites.isEmpty && viewModel.externalFavorites.isEmpty
                         ? emptyFavoritesCopy
                         : "No favorite books match your filter.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(sortedFavorites) { book in
                        Button { open(book) } label: {
                            bookRow(book, showProgress: false)
                        }
                        .disabled(openingBookID != nil)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("library-book-\(book.id)")
                        .bookstrListRow()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("Delete", role: .destructive) {
                                pendingDeletion = book
                            }
                            .accessibilityIdentifier("library-delete-\(book.id)")
                        }
                        .contextMenu {
                            Button("Rights details") { rightsDetails = details(for: book) }
                            Button("Delete", role: .destructive) { pendingDeletion = book }
                        }
                    }
                    ForEach(sortedExternalFavorites) { favorite in
                        Button {
                            if let book = CatalogRepository.fromExternalFavorite(favorite) {
                                open(book)
                            } else {
                                openError = "This favorite has not been published to Blossom yet."
                            }
                        } label: {
                            BookListDetails(title: displayTitle(favorite), author: favorite.author ?? "Unknown author",
                                            year: favorite.year, format: favorite.format, language: nil,
                                            publisher: favorite.blossomSha256 != nil ? "On Blossom" : "Not on Blossom",
                                            coverURL: favorite.coverUrl,
                                            rights: favorite.rights)
                                .textSelection(.enabled)

                        }
                        .buttonStyle(.plain)
                        .disabled(openingBookID != nil)
                        .bookstrListRow()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contextMenu {
                            Button("Rights details") {
                                rightsDetails = RightsDetailsItem(
                                    title: favorite.title, author: favorite.author, year: favorite.year,
                                    format: favorite.format, rights: favorite.rights
                                )
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .refreshable { await viewModel.load() }
        .contentMargins(.top, 8, for: .scrollContent)
        .contentMargins(.horizontal, 0, for: .scrollContent)
        .bookstrScreenTitle("Library")
        .searchable(
            text: $libraryFilter,
            placement: .navigationBarDrawer(displayMode: .automatic),
            prompt: "Filter books"
        )
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
                    .accessibilityIdentifier("library-language-filter")
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
                    .accessibilityIdentifier("library-format-filter")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort books", selection: $selectedSort) {
                        ForEach(LibrarySort.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
                .accessibilityLabel("Sort books")
                .accessibilityIdentifier("library-sort")
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
        .onChange(of: playback.isVisible) { _, visible in
            if !visible { Task { await viewModel.load() } }
        }
        .alert("Can't open book", isPresented: Binding(
            get: { openError != nil },
            set: { if !$0 { openError = nil } }
        )) {
            Button("OK", role: .cancel) { openError = nil }
        } message: {
            Text(openError ?? "")
        }
        .confirmationDialog(
            "Remove from this device?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let book = pendingDeletion {
                    pendingDeletion = nil
                    Task { await viewModel.deleteFromLibrary(book) }
                }
            }
            .accessibilityIdentifier("library-delete-confirm")
            Button("Cancel", role: .cancel) { pendingDeletion = nil }
        } message: {
            Text(deletionMessage)
        }
        .sheet(item: $rightsDetails) { RightsDetailsView(item: $0) }
        .task {
            viewModel.attach(container)
            await viewModel.load()
        }
        .onReceive(container.downloads.$jobs
            .map { Set($0.compactMap { $0.book?.id }) }
            .removeDuplicates()) { _ in
            Task {
                viewModel.attach(container)
                await viewModel.load()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .bookstrIdentityDidChange)) { _ in
            Task {
                viewModel.attach(container)
                await viewModel.load()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .bookstrAmberAuth)) { _ in
            viewModel.debugText = "Approve the request in Amber, then return here."
        }
    }

    private var emptyFavoritesCopy: String {
        viewModel.hasNostrIdentity
            ? "Heart a book to keep it here."
            : "Connect Nostr in Settings to sync favorites."
    }

    private var deletionMessage: String {
        let title = pendingDeletion?.title.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if title.isEmpty { return "Removes the download from this device." }
        return "Removes \"\(title)\" from this device."
    }

    private func bookRow(_ book: CatalogBook, showProgress: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                BookListDetails(title: book.title, author: book.author, year: book.year,
                                format: book.format.rawValue, language: book.language,
                                coverURL: book.coverUrl, rights: book.rights)
                if openingBookID == book.id { ProgressView() }
            }
            if showProgress, let item = viewModel.progress[book.id], item.progression > 0 {
                ProgressView(value: min(max(item.progression, 0), 1))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func open(_ book: CatalogBook) {
        guard openingBookID == nil else { return }
        let local = container.catalogRepository.localPublication(for: book)
        playback.present(book: local?.book ?? book, preparedURL: local?.url)
    }

    private func displayTitle(_ favorite: ExternalFavorite) -> String {
        let title = favorite.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty, title.localizedCaseInsensitiveCompare("Book favorite") != .orderedSame {
            return title
        }
        let candidate = (favorite.libvaultMd5 ?? favorite.key).lowercased()
        return candidate.count == 32 ? candidate : (title.isEmpty ? favorite.key : title)
    }

    private func details(for book: CatalogBook) -> RightsDetailsItem {
        RightsDetailsItem(
            title: book.title, author: book.author, year: book.year,
            format: book.format.rawValue, rights: book.rights
        )
    }
}
