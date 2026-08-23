import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var container: AppContainer
    @StateObject private var viewModel = LibraryViewModel()
    @State private var selectedBook: CatalogBook?
    @State private var openError: String?

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
                        Button { selectedBook = book } label: {
                            bookRow(book, showProgress: true)
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

            Section("Favorites") {
                if viewModel.favorites.isEmpty && viewModel.externalFavorites.isEmpty {
                    Text(emptyFavoritesCopy)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.favorites) { book in
                        Button { selectedBook = book } label: {
                            bookRow(book, showProgress: false)
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    ForEach(viewModel.externalFavorites) { favorite in
                        Button {
                            if let book = CatalogRepository.fromExternalFavorite(favorite) {
                                selectedBook = book
                            } else if (favorite.libvaultMd5 ?? favorite.key).count == 32 {
                                Task { await viewModel.resolveMetadata(for: favorite) }
                            } else {
                                openError = "This favorite does not include a downloadable EPUB or PDF link."
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
                                    Text(publicationLabel(favorite))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                if viewModel.resolvingFavoriteKeys.contains(favorite.key) {
                                    ProgressView()
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .refreshable { await viewModel.load() }
        .contentMargins(.top, 8, for: .scrollContent)
        .contentMargins(.horizontal, 0, for: .scrollContent)
        .bookstrScreenTitle("Library")
        .navigationDestination(item: $selectedBook) { book in
            ReaderHostView(book: book)
                .id(book.id)
        }
        .alert("Can't open favorite", isPresented: Binding(
            get: { openError != nil },
            set: { if !$0 { openError = nil } }
        )) {
            Button("OK", role: .cancel) { openError = nil }
        } message: {
            Text(openError ?? "")
        }
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
        .onReceive(NotificationCenter.default.publisher(for: .bookstrFavoriteMetadataDidChange)) { _ in
            Task { await viewModel.load() }
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
        VStack(alignment: .leading, spacing: 4) {
            Text(book.title).font(.headline)
            Text(book.author).font(.subheadline).foregroundStyle(.secondary)
            if showProgress, let item = viewModel.progress[book.id], item.progression > 0 {
                ProgressView(value: min(max(item.progression, 0), 1))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func publicationLabel(_ favorite: ExternalFavorite) -> String {
        let format = favorite.format?.uppercased() ?? "Metadata unavailable"
        let available = favorite.blossomSha256 != nil && favorite.blossomUrl != nil
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
}

extension Notification.Name {
    static let bookstrFavoriteMetadataDidChange = Notification.Name("bookstrFavoriteMetadataDidChange")
}
