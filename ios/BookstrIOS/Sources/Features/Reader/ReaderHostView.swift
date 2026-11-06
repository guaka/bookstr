import SwiftUI
import Foundation
import UIKit

struct ReaderHostView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var playback: ReaderPlaybackSession
    @Environment(\.dismiss) private var dismiss
    let book: CatalogBook
    var preparedURL: URL? = nil
    var initialLocator: String? = nil
    var highlightLocator: String? = nil
    var highlightKind: ReaderHighlightKind? = nil
    var presentationOrigin: ReaderPresentationOrigin = .user
    var showsReaderChrome: Bool = true
    var onClose: (() -> Void)? = nil
    var onOpenSpeechSettings: (() -> Void)? = nil
    var onSelectPane: ((AppPane) -> Void)? = nil
    var onSearchAuthor: ((String) -> Void)? = nil
    @State private var localURL: URL?
    @State private var resolvedFormat: BookFormat?
    // The host must render a concrete view on its first frame. Starting with
    // an empty conditional Group can prevent SwiftUI from mounting this view,
    // so its opening task never runs and a full-screen cover stays black.
    @State private var loading = true
    @State private var error: String?
    @State private var showSections = false
    @State private var showRightsDetails = false
    @State private var pdfSelection: PDFTextSelection?
    @State private var showSearch = false
    @State private var searchQuery = ""
    @State private var speechControlsExpanded = false
    @State private var layoutOrientation: ReaderLayoutOrientation = .portrait
    @State private var epubRecovery = EPUBStartupRecovery()
    @State private var epubViewGeneration = 0
    @State private var chromeMetrics = ReaderChromeMetrics(
        width: 393, height: 852,
        safeTop: 59, safeLeading: 0, safeBottom: 34, safeTrailing: 0,
        orientation: .portrait
    )
    @StateObject private var epubController = EPUBReaderController()
    @StateObject private var pdfController = PDFReaderController()
    @StateObject private var comicController = ComicReaderController()
    @StateObject private var chromeVisibility = ReaderChromeVisibilityController()

    private var activeFormat: BookFormat { resolvedFormat ?? book.format }

    var body: some View {
        ZStack {
            readerBody(metrics: chromeMetrics)
        }
        // Rebuild the layout subtree when the interface rotates. UIKit updates
        // the window geometry before every embedded reader reports its new
        // viewport, while SwiftUI can otherwise retain the portrait proposal
        // for this full-screen overlay.
        .id(layoutOrientation)
        .frame(width: chromeMetrics.width, height: chromeMetrics.height)
        .accessibilityAction(.escape) { closeReader() }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            deviceOrientationDidChange()
        }
    }

    private func readerBody(metrics: ReaderChromeMetrics) -> some View {
        readerSettingsObservers(metrics: metrics)
    }

    @ViewBuilder
    private func readerBaseContent(metrics: ReaderChromeMetrics) -> some View {
        Group {
            if loading {
                ProgressView(Self.openingMessage(for: book))
            } else if let error {
                VStack(spacing: 12) {
                    Text(error).foregroundStyle(.red)
                    Button("Retry") { Task { await openBook() } }
                }
            } else if let localURL {
                if activeFormat == .pdf {
                    PDFReaderView(
                        book: book,
                        fileURL: localURL,
                        textSelection: $pdfSelection,
                        controller: pdfController
                    )
                    .padding(.top, metrics.contentTopInset)
                } else if activeFormat == .cbr || activeFormat == .cbz {
                    ComicReaderView(
                        book: book,
                        format: activeFormat,
                        fileURL: localURL,
                        controller: comicController,
                        initialLocator: initialLocator,
                        onProgress: { progression, locator in
                            persistProgress(progression, locator: locator, format: activeFormat)
                        }
                    )
                    .padding(.top, metrics.contentTopInset)
                    .padding(.bottom, 5)
                } else {
                    EPUBReaderView(book: book, fileURL: localURL, controller: epubController,
                                   initialCFI: EPUBStartupRecovery.locator(
                                       attempt: epubViewGeneration,
                                       requested: initialLocator,
                                       saved: container.progressRepository.get(bookId: book.id).cfi
                                   ),
                                   highlightCFI: highlightLocator, highlightKind: highlightKind,
                                   startupAttempt: epubViewGeneration)
                        .id(epubViewGeneration)
                        .padding(.top, metrics.contentTopInset)
                        .padding(.bottom, 5)
                }
            } else {
                ProgressView(Self.openingMessage(for: book))
            }
        }
        .background(container.settingsRepository.theme.background)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .toolbar(showsReaderChrome ? .hidden : .automatic, for: .navigationBar)
        .toolbar(showsReaderChrome ? .hidden : .automatic, for: .tabBar)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
    }

    private func readerStatusOverlays(metrics: ReaderChromeMetrics) -> some View {
        readerBaseContent(metrics: metrics)
        .overlay {
            if activeFormat == .epub, let readerError = epubController.errorMessage {
                VStack(spacing: 12) {
                    Text(readerError).foregroundStyle(.red).multilineTextAlignment(.center)
                    Button("Try again", action: restartEPUBReader)
                        .accessibilityIdentifier("reader-retry-epub")
                    Button("Back to Library", action: closeReader)
                }
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding()
            }
        }
        .overlay(alignment: .bottom) {
            if activeFormat == .epub, let speechStatus = epubController.speechStatusMessage {
                HStack(alignment: .top, spacing: 12) {
                    Text(speechStatus)
                        .font(.subheadline)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("Dismiss") {
                        epubController.dismissSpeechStatus()
                    }
                    .font(.subheadline.weight(.semibold))
                }
                .padding(14)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 16)
                .padding(.bottom, showsReaderChrome ? 72 : 24)
                .accessibilityIdentifier("reader-speech-status")
            }
        }
        .overlay {
            if activeFormat == .epub, localURL != nil, !epubController.ready, epubController.errorMessage == nil {
                ProgressView(Self.openingMessage(for: book))
                    .padding(16)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func readerChromeOverlays(metrics: ReaderChromeMetrics) -> some View {
        readerStatusOverlays(metrics: metrics)
        .overlay {
            if (activeFormat == .cbr || activeFormat == .cbz), let readerError = comicController.errorMessage {
                VStack(spacing: 12) {
                    Text(readerError).foregroundStyle(.red).multilineTextAlignment(.center)
                    Button("Back to Library", action: closeReader)
                }
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding()
            }
        }
        .overlay {
            if (activeFormat == .cbr || activeFormat == .cbz), localURL != nil,
               !comicController.ready, comicController.errorMessage == nil {
                ProgressView(Self.openingMessage(for: book))
                    .padding(16)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .overlay {
            if chromeVisibility.isButtonIslandVisible {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture(perform: chromeVisibility.hide)
                    .accessibilityHidden(true)
            }
        }
        .overlay(alignment: .top) {
            readerTopBar(metrics: metrics)
        }
        .overlay(alignment: .topTrailing) {
            if speechControlsExpanded && (activeFormat == .epub) {
                speechControlIsland
                    .padding(.top, metrics.headerHeight + 4)
                    .padding(.trailing, max(8, metrics.safeTrailing + 8))
            }
        }
        .overlay(alignment: .bottom) { readerBottomBar(metrics: metrics) }
        .overlay(alignment: .bottom) { buttonIslandLayer(metrics: metrics) }
        .ignoresSafeArea(.all, edges: .all)
    }

    private func readerPresentation(metrics: ReaderChromeMetrics) -> some View {
        readerChromeOverlays(metrics: metrics)
        .sheet(isPresented: $showSections) { readerContentsSheet }
        .sheet(isPresented: $showRightsDetails) {
            RightsDetailsView(item: RightsDetailsItem(
                title: book.title, author: book.author, year: book.year,
                format: activeFormat.rawValue,
                rights: activeFormat == .epub ? epubController.rights : book.rights,
                coverURL: book.coverUrl, bookID: book.id,
                preferDiscoveredCover: true
            ))
        }
        .sheet(isPresented: $showSearch) { readerSearchSheet }
        .task { await openBook() }
        .onAppear(perform: readerDidAppear)
        .onDisappear {
            chromeVisibility.cancel()
            UIApplication.shared.isIdleTimerDisabled = false
            if epubController.isSpeechRetained { epubController.stopSpeechCompletely() }
            epubController.endNowPlaying()
        }
    }

    private func readerPlaybackObservers(metrics: ReaderChromeMetrics) -> some View {
        readerPresentation(metrics: metrics)
        .onChange(of: showsReaderChrome) { _, _ in updateIdleTimer() }
        .onChange(of: epubController.isSpeechRetained) { _, _ in syncPlaybackSpeech() }
        .onChange(of: epubController.isSpeaking) { _, _ in syncPlaybackSpeech() }
        .onChange(of: activeSpeechState) { previous, current in
            if previous != .idle && current == .idle { speechControlsExpanded = false }
        }
    }

    private func readerSettingsObservers(metrics: ReaderChromeMetrics) -> some View {
        readerPlaybackObservers(metrics: metrics)
        .onChange(of: playback.speechToggleToken) { _, _ in
            toggleActiveSpeech()
        }
        .onChange(of: epubController.ready) { _, _ in startCarPlaySpeechIfReady() }
        .onChange(of: epubController.errorMessage) { _, message in
            guard let message, epubRecovery.shouldRetry(message: message, readerWasReady: epubController.ready) else { return }
            restartEPUBReader()
        }
        .onChange(of: playback.carPlayStartToken) { _, _ in startCarPlaySpeechIfReady() }
        .onReceive(container.coverDiscovery.$cachedURLs) { _ in
            if activeFormat == .epub {
                epubController.refreshNowPlayingArtwork(book: book)
            }
        }
        .onChange(of: container.settingsRepository.theme) { _, theme in
            epubController.apply(theme: theme)
        }
        .onChange(of: container.settingsRepository.readerFont) { _, _ in
            epubController.applyTypography(
                font: container.settingsRepository.readerFont,
                alignment: container.settingsRepository.readerAlignment
            )
        }
        .onChange(of: container.settingsRepository.readerAlignment) { _, _ in
            epubController.applyTypography(
                font: container.settingsRepository.readerFont,
                alignment: container.settingsRepository.readerAlignment
            )
        }
    }

    private var readerContentsSheet: some View {
        NavigationStack {
            readerContentsList
                .navigationTitle("Contents")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { showSections = false }
                    }
                }
        }
        .preferredColorScheme(container.settingsRepository.theme.colorScheme)
    }

    @ViewBuilder
    private var readerContentsList: some View {
        if !hasTableOfContents {
            ContentUnavailableView(
                "No contents",
                systemImage: "list.bullet",
                description: Text("This book does not provide a table of contents.")
            )
        } else if activeFormat == .epub {
            List(epubController.sections) { section in
                Button {
                    showSections = false
                    epubController.display(section)
                } label: {
                    HStack {
                        Text(section.label).foregroundStyle(.primary)
                        Spacer()
                        if section.index == epubController.sectionIndex {
                            Image(systemName: "checkmark")
                                .foregroundStyle(container.settingsRepository.theme.primary)
                        }
                    }
                }
            }
        } else {
            List(pdfController.tableOfContents) { section in
                Button {
                    showSections = false
                    pdfController.display(section)
                } label: {
                    HStack {
                        Text(section.label)
                            .foregroundStyle(.primary)
                            .padding(.leading, CGFloat(section.depth) * 14)
                        Spacer()
                        Text("\(section.pageIndex + 1)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func readerDidAppear() {
        dismissKeyboard()
        updateIdleTimer()
        syncPlaybackSpeech()
        updateLayoutOrientation(UIDevice.current.orientation)
        refreshChromeMetrics()
    }

    private func deviceOrientationDidChange() {
        updateLayoutOrientation(UIDevice.current.orientation)
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(100))
            refreshChromeMetrics()
        }
    }

    private func refreshChromeMetrics() {
        let metrics = ReaderDeviceGeometry.metrics(fallback: layoutOrientation)
        chromeMetrics = metrics
    }

    @ViewBuilder
    private func readerTopBar(metrics: ReaderChromeMetrics) -> some View {
        VStack(spacing: 0) {
            if metrics.dynamicIslandEdge == .top {
                let shoulderWidth = ReaderTopBarLayout.shoulderWidth(
                    containerWidth: metrics.width,
                    horizontalInset: metrics.horizontalControlInset
                )
                HStack(spacing: 0) {
                    readerTitleLinks
                        .frame(width: shoulderWidth, height: 44, alignment: .leading)
                    Spacer(minLength: 0)
                    readerActionButtons(buttonWidth: shoulderWidth / 3)
                }
                .padding(.horizontal, metrics.horizontalControlInset)
                .padding(.top, metrics.islandControlsTopInset)
                .frame(height: metrics.headerHeight, alignment: .top)
            } else {
                HStack(spacing: 0) {
                    readerTitleLinks
                        .frame(maxWidth: .infinity, alignment: .leading)
                    readerActionButtons(buttonWidth: 44)
                }
                .padding(.horizontal, metrics.horizontalControlInset)
                .padding(.top, metrics.controlsTopInset)
                .frame(height: metrics.headerHeight, alignment: .top)
            }
        }
        .foregroundStyle(container.settingsRepository.theme.background)
        .frame(height: metrics.headerHeight, alignment: .top)
        .background {
            ReaderHeaderBackground(
                metrics: metrics,
                color: container.settingsRepository.theme.primary.opacity(0.98)
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("reader-top-header")
    }

    private var readerTitleLinks: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: openBookDetails) {
                Text(book.title)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, minHeight: readerByline.isEmpty ? 44 : 23, alignment: .leading)
                    .contentShape(Rectangle())
                    .accessibilityIdentifier("reader-title")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Book details for \(book.title)")
            .accessibilityIdentifier("reader-book-details")
            if !readerByline.isEmpty {
                Button { openAuthorSearch() } label: {
                    Text(readerByline)
                        .font(.system(size: 9))
                        .lineLimit(1)
                        .opacity(0.82)
                        .frame(maxWidth: .infinity, minHeight: 21, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Search books by \(readerByline)")
                .accessibilityIdentifier("reader-author-search")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func readerActionButtons(buttonWidth: CGFloat) -> some View {
        HStack(spacing: 0) {
            if activeFormat == .epub {
                Button {
                    toggleActiveSpeech()
                    withAnimation(.snappy(duration: 0.2)) { speechControlsExpanded = true }
                } label: {
                    Image(systemName: activeSpeechState == .playing ? "pause.fill" : "play.fill")
                        .frame(width: buttonWidth, height: 44)
                }
                .accessibilityLabel(activeSpeechState == .playing || activeSpeechState == .preparing
                    ? "Pause reading aloud" : "Read aloud")
                .accessibilityIdentifier("reader-speech-toggle")
                .accessibilityValue(speechControlsExpanded ? "expanded" : "collapsed")
            }

            if hasTableOfContents {
                Button { showSections = true } label: {
                    Image(systemName: "list.bullet")
                        .frame(width: buttonWidth, height: 44)
                }
                .accessibilityLabel("Table of contents")
                .accessibilityIdentifier("reader-contents")
            }

            if activeFormat == .epub || activeFormat == .pdf {
                searchButton(buttonWidth: buttonWidth)
            }

            if activeFormat == .cbr || activeFormat == .cbz {
                Menu {
                    Button("Zoom In", systemImage: "plus.magnifyingglass") { comicController.zoomIn() }
                        .disabled(comicController.zoomScale >= ComicReaderController.maximumZoom)
                    Button("Fit Page", systemImage: "arrow.down.right.and.arrow.up.left") { comicController.fitPage() }
                    Button("Zoom Out", systemImage: "minus.magnifyingglass") { comicController.zoomOut() }
                        .disabled(comicController.zoomScale <= ComicReaderController.minimumZoom)
                } label: {
                    Image(systemName: "magnifyingglass")
                        .frame(width: buttonWidth, height: 44)
                }
                .accessibilityLabel("Comic zoom, \(Int(round(comicController.zoomScale * 100))) percent")
                .accessibilityIdentifier("reader-comic-zoom")
            }
        }
        .font(.system(size: 17, weight: .medium))
    }

    private var hasTableOfContents: Bool {
        if activeFormat == .epub { return epubController.hasTableOfContents }
        if activeFormat == .pdf { return !pdfController.tableOfContents.isEmpty }
        return false
    }

    private var activeSpeechState: ReaderSpeechState {
        activeSpeech?.state ?? .idle
    }

    private var activeSpeechChoice: SpeechPlaybackChoice {
        container.settingsRepository.speechChoice(for: book.language ?? "en")
    }

    private var activeSpeech: ReaderSpeechAdapter? {
        switch activeFormat {
        case .epub:
            return ReaderSpeechAdapter(epub: epubController)
        case .pdf, .cbr, .cbz:
            return nil
        }
    }

    private var speechControlIsland: some View {
        ReaderSpeechControls(
            expanded: $speechControlsExpanded,
            rate: Binding(
                get: { container.settingsRepository.speechRate },
                set: { container.settingsRepository.speechRate = $0 }
            ),
            state: activeSpeechState,
            choice: activeSpeechChoice,
            languageOverride: container.settingsRepository.speechLanguageOverride,
            tint: container.settingsRepository.theme.primary,
            onToggle: toggleActiveSpeech,
            onLanguageChange: changeSpeechLanguage,
            onEngineChange: changeSpeechEngine,
            onRateCommit: updateActiveSpeechRate,
            onStop: stopActiveSpeech,
            onOpenSettings: openSpeechSettings
        )
    }

    private func changeSpeechLanguage(_ language: String) {
        container.settingsRepository.speechLanguageOverride = language
        restartActiveSpeech()
    }

    private func changeSpeechEngine(_ engine: SpeechEngineID) {
        let language = activeSpeechChoice.languageTag
        container.settingsRepository.setSpeechVoice(
            engine == .system ? SpeechVoiceID.systemDefault : engine.rawValue,
            for: language
        )
        restartActiveSpeech()
    }

    private func restartActiveSpeech() {
        activeSpeech?.restart()
    }

    private func updateActiveSpeechRate() {
        activeSpeech?.updateRate(container.settingsRepository.speechRate)
    }

    private func stopActiveSpeech() {
        activeSpeech?.stop()
        withAnimation(.snappy(duration: 0.2)) { speechControlsExpanded = false }
        syncPlaybackSpeech()
    }

    private func openSpeechSettings() {
        onOpenSpeechSettings?()
    }

    private func searchButton(buttonWidth: CGFloat) -> some View {
        Button {
            showSearch = true
        } label: {
            Image(systemName: "magnifyingglass")
                .frame(width: buttonWidth, height: 44)
        }
        .accessibilityLabel("Search inside book")
        .accessibilityIdentifier("reader-search")
    }

    private func openBookDetails() {
        showRightsDetails = true
        container.coverDiscovery.prioritize(book, localPublicationURL: localURL)
    }

    private func openAuthorSearch() {
        let author = readerByline.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !author.isEmpty else { return }
        if let onSearchAuthor { onSearchAuthor(author) }
    }

    private func closeReader() {
        if let onClose {
            onClose()
        } else {
            dismiss()
        }
    }

    /// User-facing open copy: the book title, not archive/decode/layout stages.
    static func openingMessage(for book: CatalogBook) -> String {
        let title = book.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return "Opening book…" }
        return "Opening \(title)…"
    }

    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = showsReaderChrome
    }

    private func syncPlaybackSpeech() {
        playback.updateSpeechState(
            retained: activeSpeech?.isRetained ?? false,
            playing: activeSpeech?.isPlaying ?? false
        )
    }

    private func toggleActiveSpeech() {
        activeSpeech?.toggle()
        syncPlaybackSpeech()
    }

    private func startCarPlaySpeechIfReady() {
        guard (activeFormat == .epub && epubController.ready),
              playback.consumeCarPlayAutoplay(for: book.id) else { return }
        if activeSpeechState != .playing && activeSpeechState != .preparing { toggleActiveSpeech() }
    }

    private var readerSearchSheet: some View {
        NavigationStack {
            VStack(spacing: 12) {
                HStack {
                    TextField("Word or phrase", text: $searchQuery)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("reader-search-query")
                        .submitLabel(.search)
                        .onSubmit(performSearch)
                    Button("Search", action: performSearch)
                        .disabled(searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                        .accessibilityIdentifier("reader-search-submit")
                }
                .padding(.horizontal)

                if isSearching {
                    ProgressView("Searching…")
                    Spacer()
                } else if searchResultCount == 0 {
                    ContentUnavailableView(
                        "Search this book",
                        systemImage: "text.magnifyingglass",
                        description: Text("Every section of “\(book.title)”")
                    )
                } else {
                    searchResultsList
                }
            }
            .padding(.top, 8)
            .navigationTitle("Search inside book")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showSearch = false }
                }
            }
        }
        .preferredColorScheme(container.settingsRepository.theme.colorScheme)
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }

    @ViewBuilder
    private var searchResultsList: some View {
        if activeFormat == .epub {
            List(epubController.searchResults) { result in
                Button {
                    showSearch = false
                    epubController.display(result)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(epubSectionLabel(result.sectionIndex)).font(.caption).foregroundStyle(.secondary)
                        Text(result.excerpt).foregroundStyle(.primary).lineLimit(3)
                    }
                }
                .accessibilityIdentifier("reader-search-result-epub-\(result.sectionIndex)")
            }
        } else {
            List(pdfController.searchResults) { result in
                Button {
                    showSearch = false
                    pdfController.display(result)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Page \(result.pageIndex + 1)").font(.caption).foregroundStyle(.secondary)
                        Text(result.excerpt).foregroundStyle(.primary).lineLimit(3)
                    }
                }
                .accessibilityIdentifier("reader-search-result-pdf-\(result.pageIndex)")
            }
        }
    }

    private var isSearching: Bool {
        if activeFormat == .epub { return epubController.searching }
        return pdfController.searching
    }

    private var searchResultCount: Int {
        if activeFormat == .epub { return epubController.searchResults.count }
        return pdfController.searchResults.count
    }

    private func performSearch() {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return }
        if activeFormat == .epub { epubController.search(query) }
        else { pdfController.search(query) }
    }

    private func epubSectionLabel(_ index: Int) -> String {
        epubController.sections.first(where: { $0.index == index })?.label ?? "Section \(index + 1)"
    }

    @ViewBuilder
    private func readerBottomBar(metrics: ReaderChromeMetrics) -> some View {
        let progress = activeFormat == .epub ? epubController.progression :
            ((activeFormat == .cbr || activeFormat == .cbz) ? comicController.progression : pdfController.progression)
        let furthest = activeFormat == .epub ? epubController.furthestProgression :
            ((activeFormat == .cbr || activeFormat == .cbz) ? comicController.furthestProgression : pdfController.furthestProgression)
        if (activeFormat == .epub && epubController.ready) || (activeFormat == .pdf && localURL != nil) ||
            ((activeFormat == .cbr || activeFormat == .cbz) && comicController.ready) {
            CurvedReaderProgress(
                progress: progress,
                furthest: furthest,
                theme: container.settingsRepository.theme,
                cornerRadius: metrics.bottomCornerRadius
            )
            .frame(height: metrics.progressHeight)
            .contentShape(Rectangle())
            .onTapGesture {
                if hasTableOfContents { showSections = true }
            }
            .accessibilityElement()
            .accessibilityLabel("Reading progress")
            .accessibilityValue(
                "\(Int(round(100 * progress))) percent"
            )
            .accessibilityIdentifier("reader-progress-\(activeFormat.rawValue)")
        }
    }

    @ViewBuilder
    private func buttonIslandLayer(metrics: ReaderChromeMetrics) -> some View {
        ZStack(alignment: .bottom) {
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: metrics.activationZoneHeight)
                .contentShape(Rectangle())
                .onTapGesture(perform: chromeVisibility.reveal)
                .accessibilityHidden(true)

            if chromeVisibility.isButtonIslandVisible {
                readerButtonIsland
                    .padding(.horizontal, max(12, max(metrics.safeLeading, metrics.safeTrailing)))
                    .padding(.bottom, max(8, metrics.safeBottom))
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.22), value: chromeVisibility.isButtonIslandVisible)
    }

    private var readerButtonIsland: some View {
        HStack(spacing: 2) {
            readerPaneButton(pane: .library, label: "Library", identifier: "library", systemImage: "book.fill")
            readerPaneButton(pane: .search, label: "Search", identifier: "search", systemImage: "magnifyingglass")
            Button {
                selectPane(.words)
            } label: {
                Image("SpellcheckTab")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 20, height: 20)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .accessibilityLabel("Words")
            .accessibilityIdentifier("reader-pane-words")
            readerPaneButton(pane: .settings, label: "Settings", identifier: "settings", systemImage: "gearshape.fill")
        }
        .foregroundStyle(container.settingsRepository.theme.primary)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .frame(maxWidth: 360)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(container.settingsRepository.theme.primary.opacity(0.18), lineWidth: 1))
        .shadow(color: .black.opacity(0.22), radius: 16, y: 7)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("reader-button-island")
    }

    private func readerPaneButton(pane: AppPane, label: String, identifier: String, systemImage: String) -> some View {
        Button {
            selectPane(pane)
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .accessibilityLabel(label)
        .accessibilityIdentifier("reader-pane-\(identifier)")
    }

    private func selectPane(_ pane: AppPane) {
        chromeVisibility.scheduleDismissal()
        if let onSelectPane {
            onSelectPane(pane)
        } else {
            closeReader()
        }
    }

    private func updateLayoutOrientation(_ deviceOrientation: UIDeviceOrientation) {
        switch deviceOrientation {
        case .portrait, .portraitUpsideDown:
            layoutOrientation = .portrait
        case .landscapeLeft:
            layoutOrientation = .landscapeLeft
        case .landscapeRight:
            layoutOrientation = .landscapeRight
        default:
            break
        }
    }

    private var readerByline: String {
        book.author
    }

    private func restartEPUBReader() {
        epubController.ready = false
        epubController.errorMessage = nil
        epubController.loadingStage = "Retrying book"
        epubViewGeneration += 1
    }

    private func openBook() async {
        loading = true
        error = nil
        do {
            let openedURL = if let preparedURL {
                preparedURL
            } else {
                try await container.catalogRepository.ensureDownloaded(book: book)
            }
            let saved = container.progressRepository.get(bookId: book.id)
            let format = CatalogRepository.detectedFormat(fileURL: openedURL) ?? book.format
            resolvedFormat = format
            if presentationOrigin == .user {
                container.settingsRepository.saveReaderSelection(
                    ReaderSelection(bookId: book.id, format: format)
                )
            }
            epubController.furthestProgression = saved.progression
            comicController.furthestProgression = saved.progression
            saveReaderSession(
                format: format,
                locator: saved.cfi.isEmpty ? initialLocator : saved.cfi
            )
            localURL = openedURL
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func persistProgress(_ progression: Double, locator: String, format: BookFormat) {
        ReaderProgressRecorder.record(
            book: book,
            format: format,
            progression: progression,
            locator: locator,
            progressRepository: container.progressRepository,
            settingsRepository: container.settingsRepository
        )
    }

    private func saveReaderSession(format: BookFormat, locator: String?) {
        container.settingsRepository.saveReaderSession(
            ReaderProgressRecorder.session(book: book, format: format, locator: locator)
        )
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
    }
}

private struct CurvedReaderProgress: View {
    let progress: Double
    let furthest: Double
    let theme: ReaderTheme
    let cornerRadius: CGFloat

    var body: some View {
        let foreground = theme == .night
            ? Color(red: 232 / 255, green: 228 / 255, blue: 220 / 255)
            : Color(red: 28 / 255, green: 25 / 255, blue: 22 / 255)
        ZStack {
            BottomScreenCurve(cornerRadius: cornerRadius)
                .stroke(foreground.opacity(0.32), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            BottomScreenCurve(cornerRadius: cornerRadius)
                .trim(from: 0, to: min(max(furthest, 0), 1))
                .stroke(theme.primary.opacity(0.55), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            BottomScreenCurve(cornerRadius: cornerRadius)
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(theme.primary, style: StrokeStyle(lineWidth: 3, lineCap: .round))
        }
        .padding(.horizontal, 3)
        .padding(.bottom, 1)
    }
}

private struct BottomScreenCurve: Shape {
    let cornerRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let curve = min(cornerRadius, rect.width / 5)
        path.move(to: CGPoint(x: 0, y: 0))
        path.addQuadCurve(
            to: CGPoint(x: curve, y: rect.maxY - 1),
            control: CGPoint(x: 0, y: rect.maxY - 1)
        )
        path.addLine(to: CGPoint(x: rect.maxX - curve, y: rect.maxY - 1))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: 0),
            control: CGPoint(x: rect.maxX, y: rect.maxY - 1)
        )
        return path
    }
}

private struct ReaderHeaderBackground: View {
    let metrics: ReaderChromeMetrics
    let color: Color

    var body: some View {
        ZStack(alignment: .top) {
            Rectangle().fill(color)
            if metrics.dynamicIslandEdge == .top {
                ReaderTopIslandCutout(topInset: metrics.islandTopInset)
                    .fill(.black)
                    .accessibilityHidden(true)
            }
        }
    }
}

/// The central pill is surrounded by shallow, symmetric stepped shoulders so
/// the reader header visually flows around the physical Dynamic Island.
private struct ReaderTopIslandCutout: Shape {
    let topInset: CGFloat

    func path(in rect: CGRect) -> Path {
        let center = rect.midX
        let pillHalfWidth: CGFloat = min(63, rect.width * 0.18)
        let shoulderHalfWidth = pillHalfWidth + 17
        let top = min(max(0, topInset), rect.maxY)
        let pillBottom = min(rect.maxY, top + 37)
        let shoulderBottom = min(rect.maxY, pillBottom + 10)
        let radius = min(18.5, (pillBottom - top) / 2)
        var path = Path()
        path.move(to: CGPoint(x: center - pillHalfWidth + radius, y: top))
        path.addLine(to: CGPoint(x: center + pillHalfWidth - radius, y: top))
        path.addQuadCurve(
            to: CGPoint(x: center + pillHalfWidth, y: top + radius),
            control: CGPoint(x: center + pillHalfWidth, y: top)
        )
        path.addLine(to: CGPoint(x: center + pillHalfWidth, y: pillBottom - 8))
        path.addCurve(
            to: CGPoint(x: center + shoulderHalfWidth, y: pillBottom + 2),
            control1: CGPoint(x: center + pillHalfWidth + 1, y: pillBottom - 2),
            control2: CGPoint(x: center + shoulderHalfWidth - 4, y: pillBottom - 2)
        )
        path.addQuadCurve(
            to: CGPoint(x: center + pillHalfWidth + 7, y: shoulderBottom),
            control: CGPoint(x: center + shoulderHalfWidth, y: shoulderBottom)
        )
        path.addLine(to: CGPoint(x: center - pillHalfWidth - 7, y: shoulderBottom))
        path.addQuadCurve(
            to: CGPoint(x: center - shoulderHalfWidth, y: pillBottom + 2),
            control: CGPoint(x: center - shoulderHalfWidth, y: shoulderBottom)
        )
        path.addCurve(
            to: CGPoint(x: center - pillHalfWidth, y: pillBottom - 8),
            control1: CGPoint(x: center - shoulderHalfWidth + 4, y: pillBottom - 2),
            control2: CGPoint(x: center - pillHalfWidth - 1, y: pillBottom - 2)
        )
        path.addLine(to: CGPoint(x: center - pillHalfWidth, y: top + radius))
        path.addQuadCurve(
            to: CGPoint(x: center - pillHalfWidth + radius, y: top),
            control: CGPoint(x: center - pillHalfWidth, y: top)
        )
        path.closeSubpath()
        return path
    }
}

enum ReaderTopBarLayout {
    static func shoulderWidth(containerWidth: CGFloat, horizontalInset: CGFloat) -> CGFloat {
        let pillHalfWidth = min(63, containerWidth * 0.18)
        let blackShoulderHalfWidth = pillHalfWidth + 17
        return max(44, (containerWidth - 2 * blackShoulderHalfWidth) / 2 - 2 * horizontalInset)
    }
}

enum ReaderDeviceGeometry {
    @MainActor
    static func metrics(fallback: ReaderLayoutOrientation = .portrait) -> ReaderChromeMetrics {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene?.windows.first(where: \.isKeyWindow) ?? scene?.windows.first
        let bounds = window?.bounds ?? CGRect(x: 0, y: 0, width: 393, height: 852)
        let safeArea = window?.safeAreaInsets ?? .zero
        let orientation: ReaderLayoutOrientation
        switch scene?.interfaceOrientation {
        case .landscapeLeft: orientation = .landscapeLeft
        case .landscapeRight: orientation = .landscapeRight
        case .portrait, .portraitUpsideDown: orientation = .portrait
        default: orientation = fallback
        }
        return ReaderChromeMetrics(
            width: bounds.width, height: bounds.height,
            safeTop: safeArea.top, safeLeading: safeArea.left,
            safeBottom: safeArea.bottom, safeTrailing: safeArea.right,
            orientation: orientation
        )
    }
}

struct ReaderClockLabel: View {

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let battery = Self.batterySnapshot()
            HStack(spacing: 4) {
                Text(Self.formattedTime(context.date))
                if let percent = battery.percent {
                    HStack(spacing: 2) {
                        if battery.charging {
                            Image(systemName: "bolt.fill")
                                .font(.system(size: 7, weight: .semibold))
                        }
                        Text("\(percent)%")
                    }
                }
            }
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .opacity(0.78)
            .padding(.horizontal, 2)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.labelText(
                for: context.date,
                batteryPercent: battery.percent,
                charging: battery.charging
            ))
            .accessibilityIdentifier("reader-clock")
        }
    }

    static func labelText(for date: Date, batteryPercent: Int?, charging: Bool) -> String {
        let time = formattedTime(date)
        guard let batteryPercent else { return time }
        if charging {
            return "\(time) \(batteryPercent)% charging"
        }
        return "\(time) \(batteryPercent)%"
    }

    static func formattedTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    static func batterySnapshot() -> (percent: Int?, charging: Bool) {
        let device = UIDevice.current
        let level = device.batteryLevel
        let percent = level >= 0 ? Int((level * 100).rounded()) : nil
        let charging = device.batteryState == .charging || device.batteryState == .full
        return (percent, charging)
    }
}
