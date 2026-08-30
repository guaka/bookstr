import SwiftUI
import Foundation
import AVFoundation
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
    var showsReaderChrome: Bool = true
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
    @State private var showSearch = false
    @State private var searchQuery = ""
    @StateObject private var epubController = EPUBReaderController()
    @StateObject private var pdfController = PDFReaderController()
    @StateObject private var fb2Controller = FB2ReaderController()

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
                } else if book.format == .fb2 {
                    FB2ReaderView(
                        book: book,
                        fileURL: localURL,
                        controller: fb2Controller,
                        initialLocator: initialLocator,
                        onProgress: { progression, locator in
                            container.progressRepository.save(bookId: book.id, progression: progression, cfi: locator)
                        }
                    )
                    .padding(.top, 48)
                    .padding(.bottom, 5)
                } else {
                    EPUBReaderView(book: book, fileURL: localURL, controller: epubController,
                                   initialCFI: initialLocator, highlightCFI: highlightLocator,
                                   highlightKind: highlightKind)
                        .padding(.top, 48)
                        .padding(.bottom, 5)
                }
            }
        }
        .background(container.settingsRepository.theme.background)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .toolbar(showsReaderChrome ? .hidden : .automatic, for: .navigationBar)
        .toolbar(showsReaderChrome ? .hidden : .automatic, for: .tabBar)
        .statusBarHidden(showsReaderChrome)
        .persistentSystemOverlays(showsReaderChrome ? .hidden : .automatic)
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
            readerTopBar
        }
        .overlay(alignment: .bottom) { readerBottomBar }
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
                    } else if book.format == .fb2 {
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
                format: book.format.rawValue,
                rights: book.format == .epub ? epubController.rights : book.rights
            ))
        }
        .sheet(isPresented: $showSearch) { readerSearchSheet }
        .task { await openBook() }
        .onAppear {
            updateIdleTimer()
            syncPlaybackSpeech()
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            if epubController.isSpeechRetained { epubController.toggleSpeech() }
            if fb2Controller.isSpeechRetained { fb2Controller.toggleSpeech(playback: fb2SpeechChoice) }
            epubController.endNowPlaying()
        }
        .onChange(of: showsReaderChrome) { _, _ in updateIdleTimer() }
        .onChange(of: epubController.isSpeechRetained) { _, _ in syncPlaybackSpeech() }
        .onChange(of: epubController.isSpeaking) { _, _ in syncPlaybackSpeech() }
        .onChange(of: fb2Controller.isSpeechRetained) { _, _ in syncPlaybackSpeech() }
        .onChange(of: fb2Controller.isSpeaking) { _, _ in syncPlaybackSpeech() }
        .onReceive(
            NotificationCenter.default.publisher(
                for: ReaderPlaybackSession.toggleSpeechNotification,
                object: playback
            )
        ) { _ in
            toggleActiveSpeech()
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
    private var readerTopBar: some View {
        HStack(alignment: .top, spacing: 0) {
            Button(action: closeReader) {
                Image(systemName: "arrow.left")
                    .font(.system(size: 18, weight: .medium))
                    .frame(width: 40, height: 40)
            }
            .accessibilityLabel("Back")
            .accessibilityIdentifier("reader-back")

            VStack(alignment: .leading, spacing: 1) {
                Text(book.title)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .accessibilityIdentifier("reader-title")
                if !readerByline.isEmpty {
                    Text(readerByline)
                        .font(.system(size: 8))
                        .lineLimit(1)
                        .opacity(0.82)
                }
            }
            .padding(.top, 2)
            .containerRelativeFrame(.horizontal, alignment: .topLeading) { width, _ in
                ReaderTopBarLayout.metadataWidth(containerWidth: width)
            }

            Spacer(minLength: 0)

            Button { showRightsDetails = true } label: {
                RightsBadge(rights: book.format == .epub ? epubController.rights : book.rights)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows the complete rights statement and source")

            if book.format == .epub {
                Button {
                    epubController.toggleSpeech()
                    syncPlaybackSpeech()
                } label: {
                    Image(systemName: epubController.isSpeaking ? "stop.fill" : "play.fill")
                        .font(.system(size: 16))
                        .frame(width: 24, height: 24)
                }
                .accessibilityLabel(epubController.isSpeaking ? "Stop reading aloud" : "Read aloud")
                .accessibilityIdentifier("reader-speech-toggle")
            }

            if book.format == .fb2 {
                Button {
                    fb2Controller.toggleSpeech(playback: fb2SpeechChoice)
                    syncPlaybackSpeech()
                } label: {
                    Image(systemName: fb2Controller.isSpeaking ? "stop.fill" : "play.fill")
                        .font(.system(size: 16))
                        .frame(width: 24, height: 24)
                }
                .accessibilityLabel(fb2Controller.isSpeaking ? "Stop reading aloud" : "Read aloud")
                .accessibilityIdentifier("reader-speech-toggle")
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
        }
        .foregroundStyle(container.settingsRepository.theme.background)
        .padding(.leading, 6)
        .frame(height: 48)
        .background(container.settingsRepository.theme.primary.opacity(0.98))
        .overlay(alignment: .top) {
            ReaderClockLabel()
                .padding(.top, 1)
                .allowsHitTesting(false)
        }
    }

    private var hasTableOfContents: Bool {
        if book.format == .epub { return epubController.hasTableOfContents }
        if book.format == .fb2 { return !fb2Controller.sections.isEmpty }
        return !pdfController.tableOfContents.isEmpty
    }

    private var fb2SpeechChoice: SpeechPlaybackChoice {
        container.settingsRepository.speechChoice(for: fb2Controller.document?.language ?? "en")
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

    private func updateIdleTimer() {
        UIApplication.shared.isIdleTimerDisabled = showsReaderChrome
    }

    private func syncPlaybackSpeech() {
        switch book.format {
        case .epub:
            playback.updateSpeechState(
                retained: epubController.isSpeechRetained,
                playing: epubController.isSpeaking
            )
        case .fb2:
            playback.updateSpeechState(
                retained: fb2Controller.isSpeechRetained,
                playing: fb2Controller.isSpeaking
            )
        case .pdf:
            playback.updateSpeechState(retained: false, playing: false)
        }
    }

    private func toggleActiveSpeech() {
        switch book.format {
        case .epub:
            epubController.toggleSpeech()
        case .fb2:
            fb2Controller.toggleSpeech(playback: fb2SpeechChoice)
        case .pdf:
            break
        }
        syncPlaybackSpeech()
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
        } else if book.format == .fb2 {
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
        if book.format == .epub { return epubController.searching }
        if book.format == .fb2 { return fb2Controller.searching }
        return pdfController.searching
    }

    private var searchResultCount: Int {
        if book.format == .epub { return epubController.searchResults.count }
        if book.format == .fb2 { return fb2Controller.searchResults.count }
        return pdfController.searchResults.count
    }

    private func performSearch() {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return }
        if book.format == .epub { epubController.search(query) }
        else if book.format == .fb2 { fb2Controller.search(query) }
        else { pdfController.search(query) }
    }

    private func epubSectionLabel(_ index: Int) -> String {
        epubController.sections.first(where: { $0.index == index })?.label ?? "Section \(index + 1)"
    }

    @ViewBuilder
    private var readerBottomBar: some View {
        let progress = book.format == .epub ? epubController.progression :
            (book.format == .fb2 ? fb2Controller.progression : pdfController.progression)
        let furthest = book.format == .epub ? epubController.furthestProgression :
            (book.format == .fb2 ? fb2Controller.furthestProgression : pdfController.furthestProgression)
        if (book.format == .epub && epubController.ready) || (book.format == .pdf && localURL != nil) ||
            (book.format == .fb2 && fb2Controller.ready) {
            CurvedReaderProgress(
                progress: progress,
                furthest: furthest,
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
                "\(Int(round(100 * progress))) percent"
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
            let saved = container.progressRepository.get(bookId: book.id)
            epubController.furthestProgression = saved.progression
            fb2Controller.furthestProgression = saved.progression
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

enum ReaderTopBarLayout {
    static func metadataWidth(containerWidth: CGFloat) -> CGFloat {
        min(100, max(70, containerWidth * 0.20))
    }
}

struct ReaderClockLabel: View {

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            Text(Self.labelText(for: context.date))
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .opacity(0.78)
                .padding(.horizontal, 2)
                .accessibilityIdentifier("reader-clock")
        }
    }

    static func labelText(for date: Date) -> String {
        formattedTime(date)
    }

    static func formattedTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
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
    @Published private(set) var isSpeechRetained = false
    @Published var textSelection: ReaderTextSelection?
    private let speech = AVSpeechSynthesizer()
    private let neuralSpeech = NeuralSpeechPlayback()

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
        if isSpeechSessionActive {
            neuralSpeech.stop()
            speech.stopSpeaking(at: .immediate)
            setSpeaking(false)
            return
        }
        startSpeaking(text: sections.flatMap(\.paragraphs).map(\.text).joined(separator: "\n\n"), playback: playback)
    }

    func speakFromSelection(_ selected: String, playback: SpeechPlaybackChoice) {
        if isSpeechSessionActive {
            neuralSpeech.stop()
            speech.stopSpeaking(at: .immediate)
            setSpeaking(false)
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
        startSpeaking(text: spoken, playback: playback)
    }

    private var isSpeechSessionActive: Bool {
        ReaderSpeechRetention.isRetained(
            speaking: isSpeaking,
            systemSpeaking: speech.isSpeaking,
            systemPaused: speech.isPaused,
            neuralPlaying: neuralSpeech.isPlaying,
            neuralPaused: neuralSpeech.isPaused
        )
    }

    private func setSpeaking(_ speaking: Bool) {
        isSpeaking = speaking
        refreshSpeechRetention()
    }

    private func refreshSpeechRetention() {
        isSpeechRetained = isSpeechSessionActive
    }

    private func startSpeaking(text: String, playback: SpeechPlaybackChoice) {
        guard !text.isEmpty else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true)
        } catch {
            return
        }
        setSpeaking(true)
        switch playback.engine {
        case .neural(let engine):
            guard engine.supports(language: playback.languageTag) else {
                setSpeaking(false)
                return
            }
            neuralSpeech.play(
                text: text,
                engine: engine,
                speed: Float(min(max(playback.rate / SpeechLanguageSettings.defaultRate, 0.73), 1.25))
            ) { [weak self] result in
                self?.setSpeaking(false)
                if case .failure = result { return }
            }
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
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.setSpeaking(false) }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.setSpeaking(false) }
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
                ProgressView("Preparing FB2…")
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
