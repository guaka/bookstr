import SwiftUI

struct ReaderHostView: View {
    @EnvironmentObject private var container: AppContainer
    @Environment(\.dismiss) private var dismiss
    let book: CatalogBook
    var preparedURL: URL? = nil
    var initialLocator: String? = nil
    var highlightLocator: String? = nil
    var onClose: (() -> Void)? = nil
    @State private var localURL: URL?
    // The host must render a concrete view on its first frame. Starting with
    // an empty conditional Group can prevent SwiftUI from mounting this view,
    // so its opening task never runs and a full-screen cover stays black.
    @State private var loading = true
    @State private var error: String?
    @State private var showSections = false
    @State private var showRightsDetails = false
    @State private var pdfSelection: PDFTextSelection?
    @State private var readerNotice: String?
    @State private var snippetBusy = false
    @State private var showSearch = false
    @State private var searchQuery = ""
    @StateObject private var epubController = EPUBReaderController()
    @StateObject private var pdfController = PDFReaderController()

    var body: some View {
        Group {
            if loading {
                ProgressView("Opening \(book.format.rawValue.uppercased())...")
            } else if let error {
                VStack(spacing: 12) {
                    Text(error).foregroundStyle(.red)
                    Button("Retry") { Task { await openBook() } }
                }
            } else if let localURL {
                if book.format == .pdf {
                    PDFReaderView(
                        book: book,
                        fileURL: localURL,
                        textSelection: $pdfSelection,
                        controller: pdfController
                    )
                    .padding(.top, 48)
                } else {
                    EPUBReaderView(book: book, fileURL: localURL, controller: epubController,
                                   initialCFI: initialLocator, highlightCFI: highlightLocator)
                        .padding(.top, 48)
                        .padding(.bottom, 5)
                }
            }
        }
        .background(container.settingsRepository.theme.background)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .overlay {
            if book.format == .epub, let readerError = epubController.errorMessage {
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
            if book.format == .epub, localURL != nil, !epubController.ready, epubController.errorMessage == nil {
                ProgressView(epubController.loadingStage + "…")
                    .padding(16)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .overlay(alignment: .top) {
            VStack(spacing: 0) {
                readerTopBar
                selectionActionBar
            }
        }
        .overlay(alignment: .bottom) { readerBottomBar }
        .overlay(alignment: .bottom) {
            if let readerNotice {
                Text(readerNotice)
                    .font(.footnote)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.bottom, 26)
                    .onTapGesture { self.readerNotice = nil }
            }
        }
        .ignoresSafeArea(.all, edges: .all)
        .sheet(isPresented: $showSections) {
            NavigationStack {
                Group {
                    if !hasTableOfContents {
                        ContentUnavailableView("No contents", systemImage: "list.bullet",
                                               description: Text("This book does not provide a table of contents."))
                    } else if book.format == .epub {
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
                format: book.format.rawValue,
                rights: book.format == .epub ? epubController.rights : book.rights
            ))
        }
        .sheet(isPresented: $showSearch) { readerSearchSheet }
        .task { await openBook() }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            if epubController.isSpeaking { epubController.toggleSpeech() }
            epubController.endNowPlaying()
        }
        .onChange(of: container.settingsRepository.theme) { _, theme in
            epubController.apply(theme: theme)
        }
    }

    @ViewBuilder
    private var readerTopBar: some View {
        HStack(spacing: 0) {
            Button(action: closeReader) {
                Image(systemName: "arrow.left")
                    .font(.system(size: 18, weight: .medium))
                    .frame(width: 40, height: 40)
            }
            .accessibilityLabel("Back")
            .accessibilityIdentifier("reader-back")

            VStack(alignment: .leading, spacing: 1) {
                Text(book.title)
                    .font(.system(size: 8, weight: .semibold))
                    .lineLimit(1)
                if !readerByline.isEmpty {
                    Text(readerByline)
                        .font(.system(size: 10))
                        .lineLimit(1)
                        .opacity(0.82)
                }
            }
            .padding(.top, 1)
            .frame(maxWidth: .infinity, alignment: .topLeading)

            Button { showRightsDetails = true } label: {
                RightsBadge(rights: book.format == .epub ? epubController.rights : book.rights)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows the complete rights statement and source")

            if book.format == .epub {
                Button { epubController.toggleSpeech() } label: {
                    Image(systemName: epubController.isSpeaking ? "stop.fill" : "play.fill")
                        .font(.system(size: 16))
                        .frame(width: 24, height: 24)
                }
                .accessibilityLabel(epubController.isSpeaking ? "Stop reading aloud" : "Read aloud")
            }

            if hasTableOfContents {
                Button { showSections = true } label: {
                    Image(systemName: "list.bullet")
                        .frame(width: 36, height: 40)
                }
                .accessibilityLabel("Table of contents")
                .accessibilityIdentifier("reader-contents")
            }

            searchButton
            ReaderClockLabel(format: book.format)
        }
        .foregroundStyle(container.settingsRepository.theme.background)
        .padding(.leading, 6)
        .frame(height: 48)
        .background(container.settingsRepository.theme.primary.opacity(0.98))
    }

    private var hasTableOfContents: Bool {
        book.format == .epub ? epubController.hasTableOfContents : !pdfController.tableOfContents.isEmpty
    }

    private var searchButton: some View {
        Button {
            showSearch = true
        } label: {
            Image(systemName: "magnifyingglass")
                .frame(width: 40, height: 40)
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
                    ContentUnavailableView.search(text: searchQuery)
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
    }

    @ViewBuilder
    private var searchResultsList: some View {
        if book.format == .epub {
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
        book.format == .epub ? epubController.searching : pdfController.searching
    }

    private var searchResultCount: Int {
        book.format == .epub ? epubController.searchResults.count : pdfController.searchResults.count
    }

    private func performSearch() {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return }
        if book.format == .epub { epubController.search(query) } else { pdfController.search(query) }
    }

    private func epubSectionLabel(_ index: Int) -> String {
        epubController.sections.first(where: { $0.index == index })?.label ?? "Section \(index + 1)"
    }

    @ViewBuilder
    private var selectionActionBar: some View {
        if let selection = epubController.textSelection, book.format == .epub {
            selectionActions(
                text: selection.text,
                word: VocabularyPDFView.selectedWord(from: selection.text),
                language: selection.language,
                locator: selection.locator,
                context: selection.context
            )
        } else if let selection = pdfSelection, book.format == .pdf {
            selectionActions(
                text: selection.text,
                word: selection.word,
                language: "en",
                locator: selection.locator,
                context: selection.text
            )
        }
    }

    private func selectionActions(
        text: String,
        word: String?,
        language: String,
        locator: String,
        context: String
    ) -> some View {
        HStack(spacing: 8) {
            Text(text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression))
                .font(.caption)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let word {
                Button {
                    addWord(word, language: language, locator: locator, context: context)
                } label: {
                    Label("Add word", systemImage: "text.badge.plus")
                }
                .accessibilityIdentifier("reader-add-word")
            }
            Button {
                publishSnippet(text: text, locator: locator, visibility: .privateNote)
            } label: {
                Label("Private", systemImage: "lock")
            }
            Button {
                publishSnippet(text: text, locator: locator, visibility: .publicPost)
            } label: {
                Label("Public", systemImage: "globe")
            }
            .disabled(NostrSyncService.normalizedISBN(book.isbn) == nil)
        }
        .font(.caption.weight(.medium))
        .labelStyle(.iconOnly)
        .buttonStyle(.bordered)
        .tint(container.settingsRepository.theme.primary)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.regularMaterial)
        .disabled(snippetBusy)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("reader-selection-actions")
    }

    private func addWord(_ word: String, language: String, locator: String, context: String) {
        let entry = container.vocabularyRepository.saveSelection(
            word: word,
            language: language,
            bookId: book.id,
            bookTitle: book.title,
            cfi: locator,
            context: context
        )
        NotificationCenter.default.post(name: .bookstrVocabularyDidChange, object: nil)
        readerNotice = "Added “\(word)” to Words"
        Task { @MainActor in
            if let result = try? await container.dictionaryRepository.lookup(
                word: word,
                language: language,
                context: context
            ) {
                _ = container.vocabularyRepository.saveDefinition(
                    key: entry.key,
                    partOfSpeech: result.partOfSpeech,
                    definitions: result.definitions,
                    translation: result.translation,
                    sourceUrl: result.sourceUrl
                )
                NotificationCenter.default.post(name: .bookstrVocabularyDidChange, object: nil)
            }
            _ = await container.nostrSyncService.pushVocabularyWord(entry)
        }
    }

    private func publishSnippet(text: String, locator: String, visibility: SnippetVisibility) {
        snippetBusy = true
        Task { @MainActor in
            defer { snippetBusy = false }
            do {
                _ = try await container.nostrSyncService.publishSnippet(
                    text: text,
                    book: book,
                    locator: locator,
                    visibility: visibility
                )
                readerNotice = visibility == .publicPost ? "Public snippet posted" : "Private snippet saved"
            } catch {
                readerNotice = error.localizedDescription
            }
        }
    }

    @ViewBuilder
    private var readerBottomBar: some View {
        if (book.format == .epub && epubController.ready) || (book.format == .pdf && localURL != nil) {
            CurvedReaderProgress(
                progress: book.format == .epub ? epubController.progression : pdfController.progression,
                furthest: book.format == .epub
                    ? epubController.furthestProgression
                    : pdfController.furthestProgression,
                theme: container.settingsRepository.theme
            )
            .frame(height: 18)
            .contentShape(Rectangle())
            .onTapGesture {
                if hasTableOfContents { showSections = true }
            }
            .accessibilityElement()
            .accessibilityLabel("Reading progress")
            .accessibilityValue(
                "\(Int(round(100 * (book.format == .epub ? epubController.progression : pdfController.progression)))) percent"
            )
            .accessibilityIdentifier("reader-progress-\(book.format.rawValue)")
        }
    }

    private var readerByline: String {
        [book.author.isEmpty ? nil : book.author, book.year]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    private func openBook() async {
        loading = true
        error = nil
        do {
            if let preparedURL {
                localURL = preparedURL
            } else {
                localURL = try await container.catalogRepository.ensureDownloaded(book: book)
            }
            epubController.furthestProgression = container.progressRepository.get(bookId: book.id).progression
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

private struct CurvedReaderProgress: View {
    let progress: Double
    let furthest: Double
    let theme: ReaderTheme

    var body: some View {
        let foreground = theme == .night
            ? Color(red: 232 / 255, green: 228 / 255, blue: 220 / 255)
            : Color(red: 28 / 255, green: 25 / 255, blue: 22 / 255)
        ZStack {
            BottomScreenCurve()
                .stroke(foreground.opacity(0.32), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            BottomScreenCurve()
                .trim(from: 0, to: min(max(furthest, 0), 1))
                .stroke(theme.primary.opacity(0.55), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            BottomScreenCurve()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(theme.primary, style: StrokeStyle(lineWidth: 3, lineCap: .round))
        }
        .padding(.horizontal, 3)
        .padding(.bottom, 1)
    }
}

private struct BottomScreenCurve: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let curve = min(16, rect.width / 5)
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

struct ReaderClockLabel: View {
    let format: BookFormat

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            Text("\(Self.formattedTime(context.date))  \(format.rawValue.uppercased())")
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .opacity(0.78)
                .padding(.horizontal, 8)
                .accessibilityIdentifier("reader-clock")
        }
    }

    static func formattedTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }
}
