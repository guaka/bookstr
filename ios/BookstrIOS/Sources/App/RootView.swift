import SwiftUI
import Network

final class FavoriteNetworkRecoveryMonitor: ObservableObject {
    @Published private(set) var recoveryToken = 0
    private let monitor: NWPathMonitor
    private let queue = DispatchQueue(label: "app.bookstr.favorite-network-retry")
    private let lock = NSLock()
    private var wasUnavailable = false

    init(startMonitoring: Bool = true) {
        monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            self?.recordConnectivity(path.status == .satisfied)
        }
        if startMonitoring { monitor.start(queue: queue) }
    }

    func recordConnectivity(_ connected: Bool) {
        lock.lock()
        if !connected { wasUnavailable = true }
        let recovered = connected && wasUnavailable
        if recovered { wasUnavailable = false }
        lock.unlock()
        guard recovered else { return }
        DispatchQueue.main.async { [weak self] in self?.recoveryToken += 1 }
    }

    deinit { monitor.cancel() }
}

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var settings: SettingsRepository
    @EnvironmentObject private var playback: ReaderPlaybackSession
    @State private var selectedTab = 2
    @State private var continueError: String?
    @State private var attemptedInitialContinuation = false
    @StateObject private var favoriteNetwork = FavoriteNetworkRecoveryMonitor()

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
        .overlay {
            if let item = playback.item {
                ReaderHostView(
                    book: item.book,
                    preparedURL: item.preparedURL,
                    initialLocator: item.initialLocator,
                    highlightLocator: item.highlightLocator,
                    highlightKind: item.highlightKind,
                    presentationOrigin: item.origin,
                    showsReaderChrome: playback.isVisible,
                    onClose: { playback.requestClose() }
                )
                .id(playback.presentationNonce)
                .environmentObject(container)
                .environmentObject(playback)
                .opacity(playback.isVisible ? 1 : 0)
                .allowsHitTesting(playback.isVisible)
                .accessibilityHidden(!playback.isVisible)
            }
        }
        .task {
            _ = await container.nostrSyncService.retryPendingFavorites()
            guard !attemptedInitialContinuation else { return }
            attemptedInitialContinuation = true
            guard !ProcessInfo.processInfo.arguments.contains("--ui-testing-library-fixtures") else { return }
            openContinuation(reportMissing: false)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { _ = await container.nostrSyncService.retryPendingFavorites() }
        }
        .onReceive(favoriteNetwork.$recoveryToken.dropFirst()) { _ in
            Task { _ = await container.nostrSyncService.retryPendingFavorites() }
        }
        .onReceive(container.wordNavigation.$requestToken) { token in
            guard token > 0 else { return }
            selectedTab = 3
            playback.requestClose()
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
        if let current = playback.item {
            presentWithoutAnimation(
                current.book,
                preparedURL: current.preparedURL,
                initialLocator: current.initialLocator,
                highlightLocator: current.highlightLocator,
                origin: current.origin
            )
            return
        }
        let downloaded = container.catalogRepository.downloadedBooks()
        if let selection = settings.readerSelection(),
           let book = downloaded.first(where: {
               $0.id.caseInsensitiveCompare(selection.bookId) == .orderedSame
                   && $0.format == selection.format
           }) {
            presentWithoutAnimation(book, initialLocator: continuationLocator(for: book))
            return
        }
        let session = settings.readerSession()
        if let recent = ReaderContinuationSelection.preferredLocalProgress(
            than: session,
            progress: container.progressRepository.all(),
            availableBookIDs: Set(downloaded.map(\.id))
        ), let book = downloaded.first(where: { $0.id.caseInsensitiveCompare(recent.bookId) == .orderedSame }) {
            settings.saveReaderSelection(ReaderSelection(bookId: book.id, format: book.format))
            presentWithoutAnimation(book, initialLocator: recent.cfi.isEmpty ? nil : recent.cfi)
            return
        }
        guard let session else {
            if reportMissing { continueError = "No recent book to continue." }
            return
        }
        if let book = downloaded.first(where: { $0.id == session.bookId }) {
            presentWithoutAnimation(book, initialLocator: continuationLocator(for: book))
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
        presentWithoutAnimation(fallback, initialLocator: continuationLocator(for: fallback))
    }

    private func continuationLocator(for book: CatalogBook) -> String? {
        let saved = container.progressRepository.get(bookId: book.id).cfi
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if saved.isEmpty == false { return saved }
        guard let session = container.settingsRepository.readerSession(),
              session.bookId.caseInsensitiveCompare(book.id) == .orderedSame,
              session.format == book.format else { return nil }
        let locator = session.locator?.trimmingCharacters(in: .whitespacesAndNewlines)
        return locator?.isEmpty == false ? locator : nil
    }

    private func presentWithoutAnimation(
        _ book: CatalogBook,
        preparedURL: URL? = nil,
        initialLocator: String? = nil,
        highlightLocator: String? = nil,
        origin: ReaderPresentationOrigin = .continuation
    ) {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            playback.present(
                book: book,
                preparedURL: preparedURL,
                initialLocator: initialLocator,
                highlightLocator: highlightLocator,
                origin: origin
            )
        }
    }
}
