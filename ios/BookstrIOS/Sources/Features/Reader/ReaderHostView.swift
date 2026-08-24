import SwiftUI

struct ReaderHostView: View {
    @EnvironmentObject private var container: AppContainer
    @Environment(\.dismiss) private var dismiss
    let book: CatalogBook
    var preparedURL: URL? = nil
    var initialLocator: String? = nil
    var highlightLocator: String? = nil
    @State private var localURL: URL?
    // The host must render a concrete view on its first frame. Starting with
    // an empty conditional Group can prevent SwiftUI from mounting this view,
    // so its opening task never runs and a full-screen cover stays black.
    @State private var loading = true
    @State private var error: String?
    @State private var showSections = false
    @StateObject private var epubController = EPUBReaderController()

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
                    PDFReaderView(book: book, fileURL: localURL)
                } else {
                    EPUBReaderView(book: book, fileURL: localURL, controller: epubController,
                                   initialCFI: initialLocator, highlightCFI: highlightLocator)
                        .padding(.top, 40)
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
                    Button("Back to Library") { dismiss() }
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
        .overlay(alignment: .top) { readerTopBar }
        .overlay(alignment: .bottom) { readerBottomBar }
        .ignoresSafeArea(.all, edges: .all)
        .sheet(isPresented: $showSections) {
            NavigationStack {
                Group {
                    if epubController.sections.isEmpty {
                        ContentUnavailableView("No sections", systemImage: "list.bullet",
                                               description: Text("This EPUB does not provide a table of contents."))
                    } else {
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
                    }
                }
                .navigationTitle("Sections")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { showSections = false }
                    }
                }
            }
            .preferredColorScheme(container.settingsRepository.theme.colorScheme)
        }
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
        if book.format == .epub {
            HStack(spacing: 0) {
                Button { dismiss() } label: {
                    Image(systemName: "arrow.left")
                        .font(.system(size: 18, weight: .medium))
                        .frame(width: 40, height: 40)
                }
                .accessibilityLabel("Back")
                .accessibilityIdentifier("reader-back")

                Text(readerTitle)
                    .font(.system(size: 11))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button { epubController.toggleSpeech() } label: {
                    Image(systemName: epubController.isSpeaking ? "stop.fill" : "play.fill")
                        .font(.system(size: 16))
                        .frame(width: 24, height: 24)
                }
                .accessibilityLabel(epubController.isSpeaking ? "Stop reading aloud" : "Read aloud")
                Button { epubController.adjustReaderFont(by: 10) } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .bold))
                        .frame(width: 24, height: 24)
                }
                .accessibilityIdentifier("reader-font-larger")
                .accessibilityLabel("Zoom in")
                Button { epubController.adjustReaderFont(by: -10) } label: {
                    Image(systemName: "minus")
                        .font(.system(size: 16, weight: .bold))
                        .frame(width: 24, height: 24)
                }
                .accessibilityIdentifier("reader-font-smaller")
                .accessibilityLabel("Zoom out")

                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text("\(context.date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)))  EPUB")
                        .font(.system(size: 9))
                        .opacity(0.78)
                        .padding(.horizontal, 8)
                }
            }
            .foregroundStyle(container.settingsRepository.theme.background)
            .padding(.leading, 6)
            .frame(height: 40)
            .background(container.settingsRepository.theme.primary.opacity(0.98))
        } else {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.left")
                        .font(.title3.weight(.semibold))
                        .padding(10)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .accessibilityIdentifier("reader-back")
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
        }
    }

    @ViewBuilder
    private var readerBottomBar: some View {
        if book.format == .epub, epubController.ready {
            SegmentedEPUBProgress(
                progress: epubController.progression,
                furthest: epubController.furthestProgression,
                sectionCount: epubController.sectionCount,
                theme: container.settingsRepository.theme
            )
            .frame(height: 5)
            .contentShape(Rectangle())
            .onTapGesture { showSections = true }
        }
    }

    private var readerTitle: String {
        let detail = [book.author.isEmpty ? nil : book.author, book.year]
            .compactMap { $0 }
            .joined(separator: " · ")
        return detail.isEmpty ? book.title : "\(book.title) — \(detail)"
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

private struct SegmentedEPUBProgress: View {
    let progress: Double
    let furthest: Double
    let sectionCount: Int
    let theme: ReaderTheme

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let foreground = theme == .night ? Color(red: 232 / 255, green: 228 / 255, blue: 220 / 255)
                                                 : Color(red: 28 / 255, green: 25 / 255, blue: 22 / 255)
            ZStack(alignment: .leading) {
                Rectangle().fill(foreground.opacity(0.38))
                Rectangle().fill(theme.primary.opacity(0.58))
                    .frame(width: width * min(max(furthest, 0), 1))
                Rectangle().fill(theme.primary)
                    .frame(width: width * min(max(progress, 0), 1))
                if sectionCount > 1 {
                    ForEach(1..<sectionCount, id: \.self) { section in
                        Rectangle().fill(theme.background.opacity(0.9))
                            .frame(width: 1)
                            .offset(x: width * CGFloat(section) / CGFloat(sectionCount))
                    }
                }
            }
        }
    }
}
