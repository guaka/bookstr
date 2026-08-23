import SwiftUI

struct RootView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var settings: SettingsRepository
    @State private var selectedTab = 2
    @State private var continuation: CatalogBook?
    @State private var continueError: String?
    @State private var attemptedInitialContinuation = false

    var body: some View {
        TabView(selection: Binding(
            get: { selectedTab },
            set: { tab in
                if tab == 0 {
                    openContinuation(reportMissing: true)
                } else {
                    selectedTab = tab
                }
            }
        )) {
            Color.clear
                .tabItem {
                    Image(systemName: "book.pages.fill")
                        .accessibilityLabel("Continue reading")
                }
                .tag(0)

            NavigationStack {
                SearchView()
            }
            .toolbarTitleDisplayMode(.inline)
            .tabItem {
                Image(systemName: "magnifyingglass")
                    .accessibilityLabel("Search")
            }
            .tag(1)

            NavigationStack {
                LibraryView()
            }
            .toolbarTitleDisplayMode(.inline)
            .tabItem {
                Image(systemName: "book.fill")
                    .accessibilityLabel("Library")
            }
            .tag(2)

            NavigationStack {
                WordsView()
            }
            .toolbarTitleDisplayMode(.inline)
            .tabItem {
                Image("SpellcheckTab")
                    .accessibilityLabel("Words")
            }
            .tag(3)

            NavigationStack {
                SettingsView()
            }
            .toolbarTitleDisplayMode(.inline)
            .tabItem {
                Image(systemName: "gearshape.fill")
                    .accessibilityLabel("Settings")
            }
            .tag(4)
        }
        .tint(settings.theme.primary)
        .preferredColorScheme(settings.theme.colorScheme)
        .background(settings.theme.background.ignoresSafeArea())
        .task {
            guard !attemptedInitialContinuation else { return }
            attemptedInitialContinuation = true
            Task(priority: .utility) {
                let downloaded = container.catalogRepository.downloadedBooks()
                let favorites = container.nostrSyncService.cachedFavorites(seedBooks: downloaded)
                _ = await container.catalogRepository.resolveLibVaultFavorites(favorites.external)
                NotificationCenter.default.post(name: .bookstrFavoriteMetadataDidChange, object: nil)
            }
            openContinuation(reportMissing: false)
        }
        .fullScreenCover(item: $continuation) { book in
            ReaderHostView(book: book)
                .environmentObject(container)
        }
        .alert("Continue reading", isPresented: Binding(
            get: { continueError != nil },
            set: { if !$0 { continueError = nil } }
        )) {
            Button("OK", role: .cancel) { continueError = nil }
        } message: {
            Text(continueError ?? "")
        }
    }

    private func openContinuation(reportMissing: Bool) {
        guard let session = settings.readerSession() else {
            if reportMissing { continueError = "No recent book to continue." }
            return
        }
        let downloaded = container.catalogRepository.downloadedBooks()
        if let book = downloaded.first(where: { $0.id == session.bookId }) {
            presentWithoutAnimation(book)
            return
        }
        let fallback = CatalogBook(
            id: session.bookId,
            title: session.bookTitle,
            author: session.author ?? "Unknown author",
            epubUrl: "",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: session.format,
            blossomSha256: nil,
            year: session.year
        )
        let file = container.catalogRepository.publicationFile(book: fallback)
        guard FileManager.default.fileExists(atPath: file.path) else {
            if reportMissing { continueError = "The recent book is no longer downloaded." }
            return
        }
        presentWithoutAnimation(fallback)
    }

    private func presentWithoutAnimation(_ book: CatalogBook) {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            continuation = book
        }
    }
}
