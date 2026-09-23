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
    @State private var selectedTab = AppPane.library
    @State private var requestedSearch: BookSearchRequest?
    @State private var continueError: String?
    @State private var pendingCatalog: CatalogConnection?
    @State private var attemptedInitialContinuation = false
    @StateObject private var favoriteNetwork = FavoriteNetworkRecoveryMonitor()

    var body: some View {
        ZStack(alignment: .topLeading) {
            TabView(selection: $selectedTab) {
                NavigationStack {
                    LibraryView()
                }
                .toolbarTitleDisplayMode(.inline)
                .tabItem {
                    Image(systemName: "book.fill")
                        .accessibilityLabel("Library")
                }
                .tag(AppPane.library)

                NavigationStack {
                    SearchView(requestedQuery: requestedSearch,
                               isActive: selectedTab == .search && !playback.isVisible)
                }
                .toolbarTitleDisplayMode(.inline)
                .tabItem {
                    Image(systemName: "magnifyingglass")
                        .accessibilityLabel("Search")
                }
                .tag(AppPane.search)

                NavigationStack {
                    WordsView()
                }
                .toolbarTitleDisplayMode(.inline)
                .tabItem {
                    Image("SpellcheckTab")
                        .accessibilityLabel("Words")
                }
                .tag(AppPane.words)

                NavigationStack {
                    SettingsView()
                }
                .toolbarTitleDisplayMode(.inline)
                .tabItem {
                    Image(systemName: "gearshape.fill")
                        .accessibilityLabel("Settings")
                }
                .tag(AppPane.settings)
            }
            .tint(settings.theme.primary)
            .background(settings.theme.background.ignoresSafeArea())

            if let item = playback.item {
                ReaderHostView(
                    book: item.book,
                    preparedURL: item.preparedURL,
                    initialLocator: item.initialLocator,
                    highlightLocator: item.highlightLocator,
                    highlightKind: item.highlightKind,
                    presentationOrigin: item.origin,
                    showsReaderChrome: playback.isVisible,
                    onClose: { playback.requestClose() },
                    onOpenSpeechSettings: {
                        playback.requestClose()
                        selectedTab = .settings
                    },
                    onSelectPane: { pane in
                        playback.requestClose()
                        selectedTab = pane
                    },
                    onSearchAuthor: { author in
                        playback.requestClose()
                        requestedSearch = BookSearchRequest(query: author)
                        selectedTab = .search
                    }
                )
                .id(playback.presentationNonce)
                .environmentObject(container)
                .environmentObject(playback)
                .opacity(playback.isVisible ? 1 : 0)
                .allowsHitTesting(playback.isVisible)
                .accessibilityHidden(!playback.isVisible)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .preferredColorScheme(settings.theme.colorScheme)
        .overlay(alignment: .top) {
            // Custom island clock + battery; system status bar stays hidden.
            GeometryReader { proxy in
                let orientation: ReaderLayoutOrientation = proxy.size.height >= proxy.size.width
                    ? .portrait : .landscapeLeft
                let metrics = ReaderChromeMetrics(
                    width: proxy.size.width,
                    height: proxy.size.height,
                    safeTop: proxy.safeAreaInsets.top,
                    safeLeading: proxy.safeAreaInsets.leading,
                    safeBottom: proxy.safeAreaInsets.bottom,
                    safeTrailing: proxy.safeAreaInsets.trailing,
                    orientation: orientation
                )
                ReaderClockLabel()
                    .foregroundStyle(
                        playback.isVisible
                            ? settings.theme.background
                            : settings.theme.primary
                    )
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, metrics.clockTopPadding)
                    // Root content begins below the status safe area. Translate
                    // back into the physical top strip above the island.
                    .offset(y: -proxy.safeAreaInsets.top)
                    .allowsHitTesting(false)
            }
        }
        .task {
            // Favorites retry can wait on relays/Amber — never block first paint or continuation.
            Task { _ = await container.nostrSyncService.retryPendingFavorites() }
            guard !attemptedInitialContinuation else { return }
            attemptedInitialContinuation = true
            let arguments = ProcessInfo.processInfo.arguments
            guard !arguments.contains("--ui-testing-library-fixtures")
                    || arguments.contains("--ui-testing-open-continuation") else { return }
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
            selectedTab = .words
            playback.requestClose()
        }
        .onOpenURL { url in
            guard let connection = CatalogConnection(url: url, decodeNPub: NostrIdentity.hexPublicKey(from:)) else { return }
            guard settings.catalogConnection != connection else { return }
            pendingCatalog = connection
        }
        .sheet(item: $pendingCatalog) { connection in
            NavigationStack {
                Form {
                    Text(connection.name).accessibilityIdentifier("catalog-invitation-name")
                    Text(connection.npub).textSelection(.enabled).accessibilityIdentifier("catalog-invitation-npub")
                    ForEach(connection.relays, id: \.self) { Text($0) }
                }
                .navigationTitle("Connect catalog")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { pendingCatalog = nil }.accessibilityIdentifier("catalog-invitation-cancel")
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add catalog") {
                            settings.catalogConnection = connection
                            pendingCatalog = nil
                            selectedTab = .search
                        }.accessibilityIdentifier("catalog-invitation-confirm")
                    }
                }
            }
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
            presentLocalIfAvailable(
                current.book,
                preparedURL: current.preparedURL,
                initialLocator: current.initialLocator,
                highlightLocator: current.highlightLocator,
                origin: current.origin,
                reportMissing: reportMissing
            )
            return
        }
        let downloaded = container.catalogRepository.downloadedBooks()
        if let selection = settings.readerSelection(),
           let book = downloaded.first(where: {
               $0.id.caseInsensitiveCompare(selection.bookId) == .orderedSame
                   && $0.format == selection.format
           }) {
            presentLocalIfAvailable(
                book,
                initialLocator: continuationLocator(for: book),
                reportMissing: reportMissing
            )
            return
        }
        let session = settings.readerSession()
        if let recent = ReaderContinuationSelection.preferredLocalProgress(
            than: session,
            progress: container.progressRepository.all(),
            availableBookIDs: Set(downloaded.map(\.id))
        ), let book = downloaded.first(where: { $0.id.caseInsensitiveCompare(recent.bookId) == .orderedSame }) {
            settings.saveReaderSelection(ReaderSelection(bookId: book.id, format: book.format))
            presentLocalIfAvailable(
                book,
                initialLocator: recent.cfi.isEmpty ? nil : recent.cfi,
                reportMissing: reportMissing
            )
            return
        }
        guard let session else {
            if reportMissing { continueError = "No recent book to continue." }
            return
        }
        if let book = downloaded.first(where: { $0.id == session.bookId }) {
            presentLocalIfAvailable(
                book,
                initialLocator: continuationLocator(for: book),
                reportMissing: reportMissing
            )
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
            year: session.year
        )
        presentLocalIfAvailable(
            fallback,
            initialLocator: continuationLocator(for: fallback),
            reportMissing: reportMissing,
            missingMessage: "The recent book is no longer downloaded."
        )
    }

    /// Cold-start continuation must never cover the shell with a reader that still
    /// needs network/signer work — that path looks like a stuck black screen.
    private func presentLocalIfAvailable(
        _ book: CatalogBook,
        preparedURL: URL? = nil,
        initialLocator: String? = nil,
        highlightLocator: String? = nil,
        origin: ReaderPresentationOrigin = .continuation,
        reportMissing: Bool,
        missingMessage: String = "The recent book is no longer downloaded."
    ) {
        if let preparedURL {
            presentWithoutAnimation(
                book,
                preparedURL: preparedURL,
                initialLocator: initialLocator,
                highlightLocator: highlightLocator,
                origin: origin
            )
            return
        }
        guard let local = container.catalogRepository.localPublication(for: book) else {
            if reportMissing { continueError = missingMessage }
            return
        }
        presentWithoutAnimation(
            local.book,
            preparedURL: local.url,
            initialLocator: initialLocator,
            highlightLocator: highlightLocator,
            origin: origin
        )
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
