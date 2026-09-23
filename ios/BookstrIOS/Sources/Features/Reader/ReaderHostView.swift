import SwiftUI
import Foundation
import AVFoundation
import MediaPlayer
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
    @State private var chromeMetrics = ReaderChromeMetrics(
        width: 393, height: 852,
        safeTop: 59, safeLeading: 0, safeBottom: 34, safeTrailing: 0,
        orientation: .portrait
    )
    @StateObject private var epubController = EPUBReaderController()
    @StateObject private var pdfController = PDFReaderController()
    @StateObject private var fb2Controller = FB2ReaderController()
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
            updateLayoutOrientation(UIDevice.current.orientation)
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(100))
                chromeMetrics = ReaderDeviceGeometry.metrics(fallback: layoutOrientation)
            }
        }
    }

    @ViewBuilder
    private func readerBody(metrics: ReaderChromeMetrics) -> some View {
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
                } else if activeFormat == .fb2 {
                    FB2ReaderView(
                        book: book,
                        fileURL: localURL,
                        controller: fb2Controller,
                        initialLocator: initialLocator,
                        onProgress: { progression, locator in
                            persistProgress(progression, locator: locator, format: .fb2)
                        }
                    )
                    .padding(.top, metrics.contentTopInset)
                    .padding(.bottom, 5)
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
                                   initialCFI: initialLocator, highlightCFI: highlightLocator,
                                   highlightKind: highlightKind)
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
        .overlay {
            if activeFormat == .epub, let readerError = epubController.errorMessage {
                VStack(spacing: 12) {
                    Text(readerError).foregroundStyle(.red).multilineTextAlignment(.center)
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
            if speechControlsExpanded && (activeFormat == .epub || activeFormat == .fb2) {
                speechControlIsland
                    .padding(.top, metrics.headerHeight + 4)
                    .padding(.trailing, max(8, metrics.safeTrailing + 8))
            }
        }
        .overlay(alignment: .bottom) { readerBottomBar(metrics: metrics) }
        .overlay(alignment: .bottom) { buttonIslandLayer(metrics: metrics) }
        .ignoresSafeArea(.all, edges: .all)
        .sheet(isPresented: $showSections) {
            NavigationStack {
                Group {
                    if !hasTableOfContents {
                        ContentUnavailableView("No contents", systemImage: "list.bullet",
                                               description: Text("This book does not provide a table of contents."))
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
                                        Image(systemName: "checkmark").foregroundStyle(container.settingsRepository.theme.primary)
                                    }
                                }
                            }
                        }
                    } else if activeFormat == .fb2 {
                        List(fb2Controller.sections) { section in
                            Button {
                                showSections = false
                                fb2Controller.requestedSectionID = section.id
                            } label: {
                                HStack {
                                    Text(section.title.isEmpty ? "Section \(section.index + 1)" : section.title)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if section.index == fb2Controller.sectionIndex {
                                        Image(systemName: "checkmark").foregroundStyle(container.settingsRepository.theme.primary)
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
                .navigationTitle("Contents")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { showSections = false }
                    }
                }
            }
            .preferredColorScheme(container.settingsRepository.theme.colorScheme)
        }
        .sheet(isPresented: $showRightsDetails) {
            RightsDetailsView(item: RightsDetailsItem(
                title: book.title, author: book.author, year: book.year,
                format: activeFormat.rawValue,
                rights: activeFormat == .epub ? epubController.rights : book.rights,
                coverURL: book.coverUrl, bookID: book.id
            ))
        }
        .sheet(isPresented: $showSearch) { readerSearchSheet }
        .task { await openBook() }
        .onAppear {
            dismissKeyboard()
            updateIdleTimer()
            syncPlaybackSpeech()
            updateLayoutOrientation(UIDevice.current.orientation)
            chromeMetrics = ReaderDeviceGeometry.metrics(fallback: layoutOrientation)
        }
        .onDisappear {
            chromeVisibility.cancel()
            UIApplication.shared.isIdleTimerDisabled = false
            if epubController.isSpeechRetained { epubController.stopSpeechCompletely() }
            if fb2Controller.isSpeechRetained { fb2Controller.stopSpeechCompletely() }
            epubController.endNowPlaying()
            fb2Controller.endNowPlaying()
        }
        .onChange(of: showsReaderChrome) { _, _ in updateIdleTimer() }
        .onChange(of: epubController.isSpeechRetained) { _, _ in syncPlaybackSpeech() }
        .onChange(of: epubController.isSpeaking) { _, _ in syncPlaybackSpeech() }
        .onChange(of: fb2Controller.isSpeechRetained) { _, _ in syncPlaybackSpeech() }
        .onChange(of: fb2Controller.isSpeaking) { _, _ in syncPlaybackSpeech() }
        .onChange(of: activeSpeechState) { previous, current in
            if previous != .idle && current == .idle { speechControlsExpanded = false }
        }
        .onChange(of: fb2Controller.speechLocator) { _, locator in
            guard let locator else { return }
            persistProgress(fb2Controller.progression, locator: locator, format: .fb2)
        }
        .onChange(of: playback.speechToggleToken) { _, _ in
            toggleActiveSpeech()
        }
        .onChange(of: epubController.ready) { _, _ in startCarPlaySpeechIfReady() }
        .onChange(of: fb2Controller.ready) { _, _ in startCarPlaySpeechIfReady() }
        .onChange(of: playback.carPlayStartToken) { _, _ in startCarPlaySpeechIfReady() }
        .onReceive(container.coverDiscovery.$cachedURLs) { _ in
            if activeFormat == .epub {
                epubController.refreshNowPlayingArtwork(book: book)
            } else if activeFormat == .fb2 {
                fb2Controller.refreshNowPlayingArtwork(book: book)
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

    @ViewBuilder
    private func readerTopBar(metrics: ReaderChromeMetrics) -> some View {
        VStack(spacing: 0) {
            if metrics.dynamicIslandEdge == .top {
                let shoulderWidth = ReaderTopBarLayout.shoulderWidth(
                    containerWidth: metrics.width,
                    horizontalInset: metrics.horizontalControlInset
                )
                HStack(alignment: .top, spacing: 0) {
                    Text(book.title)
                        .font(.system(size: 11, weight: .semibold))
                        .lineLimit(2)
                        .frame(width: shoulderWidth, alignment: .leading)
                        .accessibilityIdentifier("reader-title")
                    Spacer(minLength: 0)
                    Text(readerByline)
                        .font(.system(size: 9))
                        .lineLimit(2)
                        .multilineTextAlignment(.trailing)
                        .opacity(0.82)
                        .frame(width: shoulderWidth, alignment: .trailing)
                }
                .padding(.horizontal, metrics.horizontalControlInset)
                .padding(.top, metrics.islandTopInset + 4)
                .frame(height: metrics.safeTop, alignment: .top)

                HStack(spacing: 0) {
                    bookDetailsButton
                    Spacer(minLength: 0)
                    readerActionButtons
                }
                .padding(.horizontal, metrics.horizontalControlInset)
                .frame(height: 44)
            } else {
                HStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(book.title)
                            .font(.system(size: 11, weight: .semibold))
                            .lineLimit(1)
                            .accessibilityIdentifier("reader-title")
                        if !readerByline.isEmpty {
                            Text(readerByline)
                                .font(.system(size: 9))
                                .lineLimit(1)
                                .opacity(0.82)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    bookDetailsButton
                    readerActionButtons
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

    private var bookDetailsButton: some View {
        Button { showRightsDetails = true } label: {
            Image(systemName: "info.circle")
                .frame(width: 44, height: 44)
        }
        .font(.system(size: 17, weight: .medium))
        .buttonStyle(.plain)
        .accessibilityLabel("Book details")
        .accessibilityIdentifier("reader-book-details")
    }

    private var readerActionButtons: some View {
        HStack(spacing: 0) {
            if activeFormat == .epub || activeFormat == .fb2 {
                Button {
                    toggleActiveSpeech()
                    withAnimation(.snappy(duration: 0.2)) { speechControlsExpanded = true }
                } label: {
                    Image(systemName: activeSpeechState == .playing ? "pause.fill" : "play.fill")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(activeSpeechState == .playing || activeSpeechState == .preparing
                    ? "Pause reading aloud" : "Read aloud")
                .accessibilityIdentifier("reader-speech-toggle")
                .accessibilityValue(speechControlsExpanded ? "expanded" : "collapsed")
            }

            if hasTableOfContents {
                Button { showSections = true } label: {
                    Image(systemName: "list.bullet")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Table of contents")
                .accessibilityIdentifier("reader-contents")
            }

            if activeFormat == .epub || activeFormat == .pdf || activeFormat == .fb2 {
                searchButton
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
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Comic zoom, \(Int(round(comicController.zoomScale * 100))) percent")
                .accessibilityIdentifier("reader-comic-zoom")
            }
        }
        .font(.system(size: 17, weight: .medium))
    }

    private var hasTableOfContents: Bool {
        if activeFormat == .epub { return epubController.hasTableOfContents }
        if activeFormat == .fb2 { return !fb2Controller.sections.isEmpty }
        if activeFormat == .pdf { return !pdfController.tableOfContents.isEmpty }
        return false
    }

    private var fb2SpeechChoice: SpeechPlaybackChoice {
        container.settingsRepository.speechChoice(for: fb2Controller.document?.language ?? "en")
    }

    private var activeSpeechState: ReaderSpeechState {
        activeSpeech?.state ?? .idle
    }

    private var activeSpeechChoice: SpeechPlaybackChoice {
        container.settingsRepository.speechChoice(for: book.language ?? fb2Controller.document?.language ?? "en")
    }

    private var activeSpeech: ReaderSpeechAdapter? {
        switch activeFormat {
        case .epub:
            return ReaderSpeechAdapter(epub: epubController)
        case .fb2:
            return ReaderSpeechAdapter(fb2: fb2Controller, playback: fb2SpeechChoice)
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
            onRateCommit: restartActiveSpeech,
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

    private func stopActiveSpeech() {
        activeSpeech?.stop()
        withAnimation(.snappy(duration: 0.2)) { speechControlsExpanded = false }
        syncPlaybackSpeech()
    }

    private func openSpeechSettings() {
        onOpenSpeechSettings?()
    }

    private var searchButton: some View {
        Button {
            showSearch = true
        } label: {
            Image(systemName: "magnifyingglass")
                .frame(width: 44, height: 44)
        }
        .accessibilityLabel("Search inside book")
        .accessibilityIdentifier("reader-search")
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
        guard (activeFormat == .epub && epubController.ready)
                || (activeFormat == .fb2 && fb2Controller.ready),
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
        } else if activeFormat == .fb2 {
            List(fb2Controller.searchResults) { result in
                Button {
                    showSearch = false
                    fb2Controller.requestedSectionID = fb2Controller.sections[result.sectionIndex].id
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(fb2Controller.sections[result.sectionIndex].title.isEmpty
                             ? "Section \(result.sectionIndex + 1)"
                             : fb2Controller.sections[result.sectionIndex].title)
                            .font(.caption).foregroundStyle(.secondary)
                        Text(result.excerpt).foregroundStyle(.primary).lineLimit(3)
                    }
                }
                .accessibilityIdentifier("reader-search-result-fb2-\(result.sectionIndex)")
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
        if activeFormat == .fb2 { return fb2Controller.searching }
        return pdfController.searching
    }

    private var searchResultCount: Int {
        if activeFormat == .epub { return epubController.searchResults.count }
        if activeFormat == .fb2 { return fb2Controller.searchResults.count }
        return pdfController.searchResults.count
    }

    private func performSearch() {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return }
        if activeFormat == .epub { epubController.search(query) }
        else if activeFormat == .fb2 { fb2Controller.search(query) }
        else { pdfController.search(query) }
    }

    private func epubSectionLabel(_ index: Int) -> String {
        epubController.sections.first(where: { $0.index == index })?.label ?? "Section \(index + 1)"
    }

    @ViewBuilder
    private func readerBottomBar(metrics: ReaderChromeMetrics) -> some View {
        let progress = activeFormat == .epub ? epubController.progression :
            (activeFormat == .fb2 ? fb2Controller.progression :
                ((activeFormat == .cbr || activeFormat == .cbz) ? comicController.progression : pdfController.progression))
        let furthest = activeFormat == .epub ? epubController.furthestProgression :
            (activeFormat == .fb2 ? fb2Controller.furthestProgression :
                ((activeFormat == .cbr || activeFormat == .cbz) ? comicController.furthestProgression : pdfController.furthestProgression))
        if (activeFormat == .epub && epubController.ready) || (activeFormat == .pdf && localURL != nil) ||
            (activeFormat == .fb2 && fb2Controller.ready) ||
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
            readerPaneButton(pane: .continueReading, label: "Continue reading", identifier: "continue", systemImage: "book.pages.fill")
            readerPaneButton(pane: .search, label: "Search", identifier: "search", systemImage: "magnifyingglass")
            readerPaneButton(pane: .library, label: "Library", identifier: "library", systemImage: "book.fill")
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
        [book.author.isEmpty ? nil : book.author, book.year, book.language?.uppercased()]
            .compactMap { $0 }
            .joined(separator: " · ")
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
            if format == .fb2 { fb2Controller.configureNowPlaying(book: book) }
            if presentationOrigin == .user {
                container.settingsRepository.saveReaderSelection(
                    ReaderSelection(bookId: book.id, format: format)
                )
            }
            epubController.furthestProgression = saved.progression
            fb2Controller.furthestProgression = saved.progression
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

struct FB2Paragraph: Identifiable, Equatable {
    let id: String
    let text: String
}

struct FB2Section: Identifiable, Equatable {
    let index: Int
    let id: String
    let title: String
    let paragraphs: [FB2Paragraph]
    let children: [FB2Section]
}

struct FB2SearchResult: Identifiable, Equatable {
    let sectionIndex: Int
    let excerpt: String
    var id: String { "\(sectionIndex):\(excerpt)" }
}

struct FB2Document: Equatable {
    let title: String
    let author: String?
    let language: String?
    let sections: [FB2Section]

    var flatSections: [FB2Section] {
        var result: [FB2Section] = []
        func append(_ sections: [FB2Section]) {
            for section in sections {
                result.append(section)
                append(section.children)
            }
        }
        append(sections)
        return result.enumerated().map { index, section in
            FB2Section(index: index, id: section.id, title: section.title,
                       paragraphs: section.paragraphs, children: section.children)
        }
    }
}

enum FB2ParseError: LocalizedError, Equatable {
    case tooLarge
    case unsafeDocument
    case invalidDocument
    case emptyBody

    var errorDescription: String? {
        switch self {
        case .tooLarge: return "This FB2 file is empty or too large."
        case .unsafeDocument: return "External entities are not allowed in FB2 files."
        case .invalidDocument: return "This is not a valid FictionBook document."
        case .emptyBody: return "The FB2 document has no readable body."
        }
    }
}

private func fb2NilIfBlank(_ value: String?) -> String? {
    guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
    return value
}

/// Parses FictionBook XML into a small safe structure. XML is never turned into HTML and
/// external entities/resources are disabled and rejected before Foundation parses it.
enum FB2Parser {
    private static let maximumBytes = 50 * 1024 * 1024

    static func parse(data: Data) throws -> FB2Document {
        guard !data.isEmpty, data.count <= maximumBytes else { throw FB2ParseError.tooLarge }
        let prefix = String(data: data.prefix(256 * 1024), encoding: .utf8) ?? ""
        guard prefix.range(of: "<!DOCTYPE", options: .caseInsensitive) == nil,
              prefix.range(of: "<!ENTITY", options: .caseInsensitive) == nil
        else { throw FB2ParseError.unsafeDocument }
        let delegate = FB2XMLDelegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldResolveExternalEntities = false
        guard parser.parse(), let root = delegate.root,
              root.name.lowercased() == "fictionbook" else { throw FB2ParseError.invalidDocument }
        let metadata = root.first(named: "description")
        let title = fb2NilIfBlank(metadata?.firstDescendant(named: "book-title")?.textValue) ?? "Untitled"
        let authorNode = metadata?.firstDescendant(named: "author")
        let author = fb2NilIfBlank(authorNode?.children.map(\.textValue).joined(separator: " "))
            ?? fb2NilIfBlank(metadata?.firstDescendant(named: "nickname")?.textValue)
        let language = fb2NilIfBlank(metadata?.firstDescendant(named: "lang")?.textValue)
        let bodies = root.children.filter { $0.localName == "body" }
        var sections: [FB2Section] = []
        var looseParagraphs: [FB2Paragraph] = []
        for body in bodies {
            for child in body.children {
                if child.localName == "section" {
                    sections.append(convertSection(child, index: sections.count, parentID: "section"))
                } else if blockNames.contains(child.localName), let text = clean(child.textValue) {
                    looseParagraphs.append(FB2Paragraph(id: "body:\(looseParagraphs.count)", text: text))
                }
            }
        }
        if !looseParagraphs.isEmpty {
            sections.insert(FB2Section(index: 0, id: "body", title: "", paragraphs: looseParagraphs, children: []), at: 0)
        }
        guard !sections.isEmpty else { throw FB2ParseError.emptyBody }
        return FB2Document(title: title, author: author, language: language, sections: sections)
    }

    private static let blockNames: Set<String> = ["p", "subtitle", "text-author", "epigraph", "poem", "v"]

    private static func convertSection(_ node: FB2XMLNode, index: Int, parentID: String) -> FB2Section {
        let id = fb2NilIfBlank(node.attributes["id"]) ?? "\(parentID)-\(index)"
        let title = fb2NilIfBlank(node.first(named: "title")?.textValue) ?? ""
        var paragraphs: [FB2Paragraph] = []
        var children: [FB2Section] = []
        for child in node.children {
            if child.localName == "section" {
                children.append(convertSection(child, index: children.count, parentID: id))
            } else if blockNames.contains(child.localName), let text = clean(child.textValue) {
                paragraphs.append(FB2Paragraph(id: "\(id):\(paragraphs.count)", text: text))
            }
        }
        return FB2Section(index: index, id: id, title: title, paragraphs: paragraphs, children: children)
    }

    private static func clean(_ value: String) -> String? {
        let normalized = value.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }
}

private final class FB2XMLNode {
    let name: String
    let attributes: [String: String]
    var children: [FB2XMLNode] = []
    private var contents: [FB2XMLContent] = []

    init(name: String, attributes: [String: String]) { self.name = name; self.attributes = attributes }
    func appendText(_ value: String) {
        guard !value.isEmpty else { return }
        if case let .text(previous)? = contents.last {
            contents[contents.count - 1] = .text(previous + value)
        } else {
            contents.append(.text(value))
        }
    }
    func appendChild(_ child: FB2XMLNode) {
        children.append(child)
        contents.append(.child(child))
    }
    var localName: String { name.split(separator: ":").last.map(String.init) ?? name }
    var textValue: String {
        contents.map { content in
            switch content {
            case let .text(value): return value
            case let .child(child): return child.textValue
            }
        }.joined()
    }
    func first(named name: String) -> FB2XMLNode? { children.first { $0.localName == name } }
    func firstDescendant(named name: String) -> FB2XMLNode? {
        if localName == name { return self }
        for child in children { if let found = child.firstDescendant(named: name) { return found } }
        return nil
    }
}

private enum FB2XMLContent {
    case text(String)
    case child(FB2XMLNode)
}

private final class FB2XMLDelegate: NSObject, XMLParserDelegate {
    var root: FB2XMLNode?
    private var stack: [FB2XMLNode] = []

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        let node = FB2XMLNode(name: qName ?? elementName, attributes: attributeDict)
        stack.append(node)
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { stack.last?.appendText(string) }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        guard let node = stack.popLast() else { return }
        if let parent = stack.last { parent.appendChild(node) } else { root = node }
    }
}

@MainActor
final class FB2ReaderController: NSObject, ObservableObject {
    @Published var document: FB2Document?
    @Published var sections: [FB2Section] = []
    @Published var sectionIndex = 0
    @Published var progression = 0.0
    @Published var furthestProgression = 0.0
    @Published var ready = false
    @Published var errorMessage: String?
    @Published var requestedSectionID: String?
    @Published var searchResults: [FB2SearchResult] = []
    @Published var searching = false
    @Published var isSpeaking = false
    @Published var isSpeechPreparing = false
    @Published private(set) var speechState = ReaderSpeechState.idle
    @Published private(set) var speechLocator: String?
    @Published private(set) var isSpeechRetained = false
    @Published var textSelection: ReaderTextSelection?
    private let speech = AVSpeechSynthesizer()
    private let neuralSpeech = NeuralSpeechPlayback()
    private var pauseExpiryTask: Task<Void, Never>?
    private var speechLocations: [(offset: Int, locator: String)] = []
    private var lastPlayback: SpeechPlaybackChoice?
    private var resumeParagraphIndex = 0
    private var nowPlayingBookID = ""
    private var nowPlayingTitle = ""
    private var nowPlayingAuthor = ""
    private var nowPlayingArtwork: MPMediaItemArtwork?
    private var remoteTargets: [(MPRemoteCommand, Any)] = []

    func configureNowPlaying(book: CatalogBook) {
        nowPlayingBookID = book.id
        nowPlayingTitle = book.title
        nowPlayingAuthor = book.author
        refreshNowPlayingArtwork(book: book)
        guard remoteTargets.isEmpty else { return }
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.isEnabled = true
        commands.pauseCommand.isEnabled = true
        remoteTargets.append((commands.playCommand, commands.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.speechState == .paused { self.resumeSpeech() }
                else if self.speechState == .idle, let playback = self.lastPlayback {
                    self.toggleSpeech(playback: playback)
                }
            }
            return .success
        }))
        remoteTargets.append((commands.pauseCommand, commands.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pauseSpeech() }
            return .success
        }))
    }

    func refreshNowPlayingArtwork(book: CatalogBook) {
        guard nowPlayingBookID == book.id else { return }
        let image = CoverArtwork.image(for: book, discovery: AppContainer.shared.coverDiscovery)
        nowPlayingArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        if MPNowPlayingInfoCenter.default().nowPlayingInfo != nil { updateNowPlaying() }
    }

    func endNowPlaying() {
        for (command, target) in remoteTargets { command.removeTarget(target) }
        remoteTargets.removeAll()
        clearNowPlaying()
    }

    private func clearNowPlaying() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        UIApplication.shared.endReceivingRemoteControlEvents()
    }

    private func updateNowPlaying() {
        UIApplication.shared.beginReceivingRemoteControlEvents()
        let playing = speechState == .playing || speechState == .preparing
        let center = MPNowPlayingInfoCenter.default()
        center.playbackState = playing ? .playing : .paused
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: nowPlayingTitle,
            MPMediaItemPropertyArtist: nowPlayingAuthor,
            MPMediaItemPropertyMediaType: MPMediaType.audioBook.rawValue,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0
        ]
        if let nowPlayingArtwork { info[MPMediaItemPropertyArtwork] = nowPlayingArtwork }
        center.nowPlayingInfo = info
    }

    override init() {
        super.init()
        speech.delegate = self
    }

    func setSelection(text: String, locator: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            textSelection = nil
            return
        }
        textSelection = ReaderTextSelection(
            text: String(trimmed.prefix(2_000)),
            locator: locator,
            language: document?.language ?? "en",
            context: String(trimmed.prefix(2_000))
        )
    }

    func load(fileURL: URL, initialLocator: String?) async {
        do {
            guard let data = PublicationUtilities.fb2Data(fileURL: fileURL) else {
                throw FB2ParseError.invalidDocument
            }
            let parsed = try FB2Parser.parse(data: data)
            document = parsed
            sections = parsed.flatSections
            if let locator = initialLocator,
               let location = parseLocator(locator),
               let index = sections.firstIndex(where: { $0.id == location.sectionID }) {
                let paragraph = min(max(location.paragraph, 0), max(0, sections[index].paragraphs.count - 1))
                sectionIndex = index
                let count = sections.reduce(0) { $0 + $1.paragraphs.count }
                let rank = sections.prefix(index).reduce(0) { $0 + $1.paragraphs.count } + paragraph
                progression = count > 1 ? Double(rank) / Double(count - 1) : progress(for: index)
                resumeParagraphIndex = paragraph
                requestedSectionID = sections[index].id
            }
            ready = true
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription; ready = false }
    }

    func update(section index: Int, paragraph paragraphIndex: Int = 0, offset: Int = 0) -> String {
        sectionIndex = index
        let count = sections.reduce(0) { $0 + $1.paragraphs.count }
        let rank = sections.prefix(index).reduce(0) { $0 + $1.paragraphs.count } + paragraphIndex
        progression = count > 1 ? Double(rank) / Double(count - 1) : progress(for: index)
        furthestProgression = max(furthestProgression, progression)
        resumeParagraphIndex = paragraphIndex
        return "fb2:\(sections[index].id):\(max(0, paragraphIndex)):\(max(0, offset))"
    }

    func search(_ query: String) {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard needle.count >= 2 else { searchResults = []; return }
        searching = true
        let foldedNeedle = needle.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        searchResults = sections.enumerated().flatMap { index, section in
            section.paragraphs.compactMap { paragraph in
                let folded = paragraph.text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
                guard folded.range(of: foldedNeedle) != nil else { return nil }
                return FB2SearchResult(sectionIndex: index, excerpt: String(paragraph.text.prefix(240)))
            }
        }.prefix(100).map { $0 }
        searching = false
    }

    func toggleSpeech(playback: SpeechPlaybackChoice) {
        switch speechState {
        case .playing, .preparing:
            pauseSpeech()
        case .paused:
            resumeSpeech()
        case .idle:
            let plan = speechPlan()
            speechLocations = plan.locations
            startSpeaking(text: plan.text, chunks: plan.chunks, playback: playback)
        }
    }

    func stopSpeechCompletely() {
        stopSpeech(unload: true)
    }

    func restartSpeech(playback: SpeechPlaybackChoice) {
        guard speechState != .idle else { return }
        stopSpeech()
        toggleSpeech(playback: playback)
    }

    func speakFromSelection(_ selected: String, playback: SpeechPlaybackChoice) {
        if isSpeechSessionActive {
            stopSpeech()
        }
        let all = sections.flatMap(\.paragraphs).map(\.text).joined(separator: "\n\n")
        let needle = selected.trimmingCharacters(in: .whitespacesAndNewlines)
        let spoken: String
        if needle.isEmpty {
            spoken = all
        } else if let range = all.range(of: needle) {
            spoken = String(all[range.lowerBound...])
        } else {
            spoken = needle
        }
        speechLocations = []
        startSpeaking(text: spoken, chunks: nil, playback: playback)
    }

    private var isSpeechSessionActive: Bool {
        ReaderSpeechRetention.isRetained(
            speaking: isSpeaking,
            systemSpeaking: speech.isSpeaking,
            systemPaused: speech.isPaused,
            neuralPlaying: neuralSpeech.isPlaying,
            neuralPaused: neuralSpeech.isPaused,
            preparing: isSpeechPreparing
        )
    }

    private func setSpeaking(_ speaking: Bool) {
        isSpeaking = speaking
        if !speaking { isSpeechPreparing = false }
        if speaking, !isSpeechPreparing { speechState = .playing }
        refreshSpeechRetention()
    }

    private func markSpeechStarted() {
        if isSpeechPreparing {
            isSpeechPreparing = false
            speechState = .playing
            refreshSpeechRetention()
        }
    }

    private func refreshSpeechRetention() {
        isSpeechRetained = isSpeechSessionActive
    }

    private func startSpeaking(text: String, chunks: [SpeechQueueChunk]?, playback: SpeechPlaybackChoice) {
        guard !text.isEmpty else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true)
        } catch {
            return
        }
        isSpeechPreparing = true
        speechState = .preparing
        updateNowPlaying()
        lastPlayback = playback
        setSpeaking(true)
        switch playback.engine {
        case .neural(let engine):
            guard engine.supports(language: playback.languageTag) else {
                setSpeaking(false)
                return
            }
            neuralSpeech.play(
                chunks: chunks ?? [SpeechQueueChunk(text: text, offset: 0, pauseSeconds: 0)],
                engine: engine,
                speed: Float(min(max(playback.rate / SpeechLanguageSettings.defaultRate, 0.73), 1.25)),
                onPhrase: { [weak self] chunk in
                    self?.markSpeechStarted()
                    self?.updateSpeechLocation(offset: chunk.offset)
                },
                onProgress: { [weak self] _, _ in
                    self?.markSpeechStarted()
                },
                completion: { [weak self] result in
                    self?.finishSpeech()
                    if case .failure = result { return }
                }
            )
        case .apple:
            let utterance = AVSpeechUtterance(string: text)
            if !playback.voiceIdentifier.isEmpty {
                utterance.voice = AVSpeechSynthesisVoice(identifier: playback.voiceIdentifier)
            } else {
                utterance.voice = AVSpeechSynthesisVoice(language: playback.languageTag)
            }
            utterance.rate = Float(playback.rate)
            speech.speak(utterance)
        }
    }

    private func pauseSpeech() {
        guard speechState == .playing || speechState == .preparing else { return }
        if speech.isSpeaking { speech.pauseSpeaking(at: .word) }
        if neuralSpeech.isPlaying { neuralSpeech.pause() }
        isSpeaking = false
        isSpeechPreparing = false
        speechState = .paused
        updateNowPlaying()
        refreshSpeechRetention()
        pauseExpiryTask?.cancel()
        pauseExpiryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(ReaderSpeechPausePolicy.expiration))
            guard !Task.isCancelled else { return }
            self?.stopSpeech(unload: true)
        }
    }

    private func resumeSpeech() {
        guard speechState == .paused else { return }
        pauseExpiryTask?.cancel()
        if speech.isPaused { speech.continueSpeaking() }
        else if neuralSpeech.isPaused { neuralSpeech.resume() }
        else if let lastPlayback {
            stopSpeech()
            toggleSpeech(playback: lastPlayback)
            return
        }
        speechState = .playing
        setSpeaking(true)
        updateNowPlaying()
    }

    private func stopSpeech(unload: Bool = false) {
        pauseExpiryTask?.cancel()
        pauseExpiryTask = nil
        if unload { neuralSpeech.unload() } else { neuralSpeech.stop() }
        speech.stopSpeaking(at: .immediate)
        speechState = .idle
        setSpeaking(false)
        clearNowPlaying()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func finishSpeech() {
        pauseExpiryTask?.cancel()
        speechState = .idle
        setSpeaking(false)
        clearNowPlaying()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func speechPlan() -> (text: String, chunks: [SpeechQueueChunk], locations: [(Int, String)]) {
        var text = ""
        var chunks: [SpeechQueueChunk] = []
        var locations: [(Int, String)] = []
        for section in sections.dropFirst(sectionIndex) {
            for (paragraphIndex, paragraph) in section.paragraphs.enumerated() {
                if section.index == sectionIndex && paragraphIndex < resumeParagraphIndex { continue }
                let value = paragraph.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !value.isEmpty else { continue }
                if !text.isEmpty { text += "\n\n" }
                let offset = (text as NSString).length
                let locator = "fb2:\(section.id):\(paragraphIndex):0"
                locations.append((offset, locator))
                chunks.append(SpeechQueueChunk(text: value, offset: offset, pauseSeconds: 0.08))
                text += value
            }
        }
        return (text, chunks, locations)
    }

    private func updateSpeechLocation(offset: Int) {
        guard let entry = speechLocations.last(where: { $0.offset <= offset }) else { return }
        speechLocator = entry.locator
        if let location = parseLocator(entry.locator),
           let index = sections.firstIndex(where: { $0.id == location.sectionID }) {
            _ = update(section: index, paragraph: location.paragraph)
        }
    }

    private func progress(for index: Int) -> Double {
        guard sections.count > 1 else { return 0 }
        return Double(index) / Double(sections.count - 1)
    }

    private struct FB2Locator {
        let sectionID: String
        let paragraph: Int
    }

    private func parseLocator(_ locator: String) -> FB2Locator? {
        let parts = locator.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 4, parts[0] == "fb2", !parts[1].isEmpty,
              let paragraph = Int(parts[2]), let offset = Int(parts[3]),
              paragraph >= 0, offset >= 0 else { return nil }
        return FB2Locator(sectionID: String(parts[1]), paragraph: paragraph)
    }
}

extension FB2ReaderController: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        Task { @MainActor in self.markSpeechStarted() }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finishSpeech() }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in if self.speechState != .paused { self.finishSpeech() } }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString range: NSRange, utterance: AVSpeechUtterance) {
        Task { @MainActor in self.updateSpeechLocation(offset: range.location) }
    }
}

struct FB2ReaderView: View {
    let book: CatalogBook
    let fileURL: URL
    @ObservedObject var controller: FB2ReaderController
    let initialLocator: String?
    let onProgress: (Double, String) -> Void
    @EnvironmentObject private var container: AppContainer

    var body: some View {
        Group {
            if let error = controller.errorMessage {
                Text(error).foregroundStyle(.red).padding(24)
            } else if !controller.ready {
                ProgressView(ReaderHostView.openingMessage(for: book))
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(controller.sections) { section in
                                VStack(alignment: .leading, spacing: 8) {
                                    if !section.title.isEmpty {
                                        Text(section.title).font(.title2.bold()).padding(.top, section.index == 0 ? 12 : 24)
                                    }
                                    ForEach(section.paragraphs) { paragraph in
                                        let paragraphIndex = section.paragraphs.firstIndex(of: paragraph) ?? 0
                                        FB2SelectableParagraph(
                                            text: paragraph.text,
                                            onSelectionChange: { selected in
                                                let locator = controller.update(
                                                    section: section.index,
                                                    paragraph: paragraphIndex
                                                )
                                                controller.setSelection(text: selected, locator: locator)
                                            },
                                            onAddWord: {
                                                guard let selection = controller.textSelection,
                                                      let phrase = ReaderSelectionActions.phraseForVocabulary(from: selection.text)
                                                else { return }
                                                _ = container.vocabularyRepository.saveSelection(
                                                    word: phrase,
                                                    language: selection.language,
                                                    bookId: book.id,
                                                    bookTitle: book.title,
                                                    cfi: selection.locator,
                                                    context: selection.context
                                                )
                                                NotificationCenter.default.post(name: .bookstrVocabularyDidChange, object: nil)
                                            },
                                            onMark: {
                                                guard let selection = controller.textSelection else { return }
                                                let text = ReaderSelectionActions.normalizedText(selection.text)
                                                guard !text.isEmpty else { return }
                                                guard container.snippetRepository.saveMark(
                                                    text: text,
                                                    bookId: book.id,
                                                    bookTitle: book.title,
                                                    author: book.author,
                                                    isbn: NostrSyncService.normalizedISBN(book.isbn),
                                                    format: .fb2,
                                                    locator: selection.locator
                                                ) != nil else { return }
                                                NotificationCenter.default.post(name: .bookstrSnippetsDidChange, object: nil)
                                            },
                                            onReadFromHere: {
                                                controller.speakFromSelection(
                                                    controller.textSelection?.text ?? "",
                                                    playback: container.settingsRepository.speechChoice(
                                                        for: controller.document?.language ?? "en"
                                                    )
                                                )
                                            }
                                        )
                                        .onAppear {
                                            let locator = controller.update(
                                                section: section.index,
                                                paragraph: paragraphIndex
                                            )
                                            onProgress(controller.progression, locator)
                                        }
                                    }
                                }
                                .id(section.id)
                                .onAppear {
                                    if section.paragraphs.isEmpty {
                                        let locator = controller.update(section: section.index)
                                        onProgress(controller.progression, locator)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 18)
                        .padding(.bottom, 24)
                    }
                    .onChange(of: controller.requestedSectionID) { _, requested in
                        guard let requested else { return }
                        withAnimation { proxy.scrollTo(requested, anchor: .top) }
                        controller.requestedSectionID = nil
                    }
                }
            }
        }
        .task { await controller.load(fileURL: fileURL, initialLocator: initialLocator) }
        .onDisappear {
            controller.requestedSectionID = nil
            controller.textSelection = nil
        }
    }
}

private final class FB2ParagraphTextView: UITextView {
    var onAddWord: (() -> Void)?
    var onMark: (() -> Void)?
    var onReadFromHere: (() -> Void)?

    override func editMenu(for textRange: UITextRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
        ReaderEditMenu.menu(
            defaultActions: ReaderEditMenu.copyOnly(from: suggestedActions),
            selection: text(in: textRange) ?? "",
            allowsSpeech: true,
            addWord: { [weak self] in self?.onAddWord?() },
            mark: { [weak self] in self?.onMark?() },
            readFromHere: { [weak self] in self?.onReadFromHere?() }
        )
    }
}

private struct FB2SelectableParagraph: UIViewRepresentable {
    let text: String
    let onSelectionChange: (String) -> Void
    let onAddWord: () -> Void
    let onMark: () -> Void
    let onReadFromHere: () -> Void

    func makeUIView(context: Context) -> FB2ParagraphTextView {
        let view = FB2ParagraphTextView()
        view.isEditable = false
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.font = .preferredFont(forTextStyle: .body)
        view.delegate = context.coordinator
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.text = text
        view.onAddWord = onAddWord
        view.onMark = onMark
        view.onReadFromHere = onReadFromHere
        return view
    }

    func updateUIView(_ uiView: FB2ParagraphTextView, context: Context) {
        if uiView.text != text {
            uiView.text = text
        }
        context.coordinator.onSelectionChange = onSelectionChange
        uiView.onAddWord = onAddWord
        uiView.onMark = onMark
        uiView.onReadFromHere = onReadFromHere
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: FB2ParagraphTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? uiView.bounds.width
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: size.height)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onSelectionChange: onSelectionChange)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var onSelectionChange: (String) -> Void

        init(onSelectionChange: @escaping (String) -> Void) {
            self.onSelectionChange = onSelectionChange
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard let range = textView.selectedTextRange else {
                onSelectionChange("")
                return
            }
            onSelectionChange(textView.text(in: range) ?? "")
        }
    }
}

private extension ReaderFont {
    var readingFont: Font {
        switch self {
        case .arial: .custom("Arial", size: 17, relativeTo: .body)
        case .georgia: .custom("Georgia", size: 17, relativeTo: .body)
        case .palatino: .custom("Palatino", size: 17, relativeTo: .body)
        case .system: .body
        }
    }
}
