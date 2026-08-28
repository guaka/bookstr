import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var container: AppContainer
    @StateObject private var viewModel = LibraryViewModel()
    @State private var selectedBook: CatalogBook?
    @State private var selectedBookURL: URL?
    @State private var openError: String?
    @State private var openingBookID: String?
    @State private var rightsDetails: RightsDetailsItem?

    var body: some View {
        List {
            if let error = viewModel.errorMessage {
                Section {
                    Button(error) {
                        Task { await viewModel.load() }
                    }
                    .foregroundStyle(.red)
                }
            }

            Section("Reading") {
                if viewModel.reading.isEmpty {
                    Text("Books you open will appear here with their progress.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.reading) { book in
                        Button { open(book) } label: {
                            bookRow(book, showProgress: true)
                        }
                        .disabled(openingBookID != nil)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("library-book-\(book.id)")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contextMenu {
                            Button("Rights details") { rightsDetails = details(for: book) }
                        }
                    }
                }
            }

            Section("Favorites") {
                if viewModel.favorites.isEmpty && viewModel.externalFavorites.isEmpty {
                    Text(emptyFavoritesCopy)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.favorites) { book in
                        Button { open(book) } label: {
                            bookRow(book, showProgress: false)
                        }
                        .disabled(openingBookID != nil)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("library-book-\(book.id)")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contextMenu {
                            Button("Rights details") { rightsDetails = details(for: book) }
                        }
                    }
                    ForEach(viewModel.externalFavorites) { favorite in
                        Button {
                            if let book = CatalogRepository.fromExternalFavorite(favorite) {
                                open(book)
                            } else {
                                openError = "This favorite has not been published to Blossom yet."
                            }
                        } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(displayTitle(favorite))
                                        .font(.headline)
                                        .textSelection(.enabled)
                                    if let author = favorite.author, !author.isEmpty {
                                        Text(author).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                    HStack(spacing: 5) {
                                        if let year = favorite.year { Text(year) }
                                        RightsBadge(rights: favorite.rights)
                                        Text("· \(publicationLabel(favorite))")
                                    }
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(openingBookID != nil)
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
        .refreshable { await viewModel.load() }
        .contentMargins(.top, 8, for: .scrollContent)
        .contentMargins(.horizontal, 0, for: .scrollContent)
        .bookstrScreenTitle("Library")
        .fullScreenCover(item: $selectedBook) { book in
            ReaderHostView(book: book, preparedURL: selectedBookURL)
                .id(book.id)
        }
        .alert("Can't open book", isPresented: Binding(
            get: { openError != nil },
            set: { if !$0 { openError = nil } }
        )) {
            Button("OK", role: .cancel) { openError = nil }
        } message: {
            Text(openError ?? "")
        }
        .sheet(item: $rightsDetails) { RightsDetailsView(item: $0) }
        .task {
            viewModel.attach(container)
            await viewModel.load()
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

    private func bookRow(_ book: CatalogBook, showProgress: Bool) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(book.title).font(.headline)
                Text(book.author).font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 5) {
                    if let year = book.year { Text(year) }
                    RightsBadge(rights: book.rights)
                    Text("· \(book.format.rawValue.uppercased())")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if showProgress, let item = viewModel.progress[book.id], item.progression > 0 {
                    ProgressView(value: min(max(item.progression, 0), 1))
                }
            }
            Spacer(minLength: 0)
            if openingBookID == book.id { ProgressView() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func open(_ book: CatalogBook) {
        guard openingBookID == nil else { return }
        let local = container.catalogRepository.localPublication(for: book)
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            selectedBookURL = local?.url
            selectedBook = local?.book ?? book
        }
    }

    private func publicationLabel(_ favorite: ExternalFavorite) -> String {
        let format = favorite.format?.uppercased() ?? "Metadata unavailable"
        let available = favorite.blossomSha256 != nil
        return "\(format) · \(available ? "On Blossom" : "Not on Blossom")"
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
