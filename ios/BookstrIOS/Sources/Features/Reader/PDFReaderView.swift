import SwiftUI
import PDFKit

struct PDFSearchResult: Identifiable {
    let id = UUID()
    let selection: PDFSelection
    let pageIndex: Int
    let excerpt: String
}

struct PDFTableOfContentsItem: Identifiable {
    let id = UUID()
    let label: String
    let pageIndex: Int
    let depth: Int
    let destination: PDFDestination
}

@MainActor
final class PDFReaderController: ObservableObject {
    @Published var searchResults: [PDFSearchResult] = []
    @Published var searching = false
    @Published var progression = 0.0
    @Published var furthestProgression = 0.0
    @Published var pageCount = 1
    @Published var tableOfContents: [PDFTableOfContentsItem] = []
    fileprivate weak var pdfView: PDFView?

    func attach(_ pdfView: PDFView) {
        self.pdfView = pdfView
    }

    func search(_ query: String) {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard needle.count >= 2, let document = pdfView?.document else {
            searchResults = []
            return
        }
        searching = true
        let matches = document.findString(needle, withOptions: .caseInsensitive).prefix(100)
        searchResults = matches.map { selection in
            let page = selection.pages.first
            let index = page.flatMap { document.index(for: $0) } ?? 0
            return PDFSearchResult(
                selection: selection,
                pageIndex: max(index, 0),
                excerpt: selection.string?.replacingOccurrences(
                    of: #"\s+"#, with: " ", options: .regularExpression
                ) ?? needle
            )
        }
        searching = false
    }

    func display(_ result: PDFSearchResult) {
        pdfView?.setCurrentSelection(result.selection, animate: true)
        pdfView?.go(to: result.selection)
    }

    func updatePage(index: Int, count: Int) {
        pageCount = max(count, 1)
        progression = Double(max(index, 0)) / Double(max(count - 1, 1))
        furthestProgression = max(furthestProgression, progression)
    }

    func highlightCurrentSelection() {
        guard let pdfView, let selection = pdfView.currentSelection else { return }
        let color = UIColor(red: 231 / 255, green: 199 / 255, blue: 102 / 255, alpha: 0.55)
        for page in selection.pages {
            let bounds = selection.bounds(for: page)
            guard !bounds.isNull, bounds.width > 1, bounds.height > 1 else { continue }
            let annotation = PDFAnnotation(bounds: bounds, forType: .highlight, withProperties: nil)
            annotation.color = color
            page.addAnnotation(annotation)
        }
    }

    func reloadTableOfContents() {
        guard let document = pdfView?.document, let root = document.outlineRoot else {
            tableOfContents = []
            return
        }
        var rows: [PDFTableOfContentsItem] = []
        func appendChildren(of outline: PDFOutline, depth: Int) {
            for index in 0..<outline.numberOfChildren {
                guard let child = outline.child(at: index) else { continue }
                if let destination = child.destination, let page = destination.page {
                    let pageIndex = max(document.index(for: page), 0)
                    rows.append(PDFTableOfContentsItem(
                        label: child.label?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                            ?? "Page \(pageIndex + 1)",
                        pageIndex: pageIndex,
                        depth: depth,
                        destination: destination
                    ))
                }
                appendChildren(of: child, depth: depth + 1)
            }
        }
        appendChildren(of: root, depth: 0)
        tableOfContents = rows
    }

    func display(_ item: PDFTableOfContentsItem) {
        pdfView?.go(to: item.destination)
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

final class VocabularyPDFView: PDFView {
    var editMenuSelection: () -> String = { "" }
    var onEditMenuAddWord: (() -> Void)?
    var onEditMenuMark: (() -> Void)?

    static func selectedWord(from value: String?) -> String? {
        ReaderSelectionActions.phraseForVocabulary(from: value ?? "")
    }

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        ReaderEditMenu.configure(
            builder,
            selection: editMenuSelection(),
            allowsSpeech: false,
            addWord: { [weak self] in self?.onEditMenuAddWord?() },
            mark: { [weak self] in self?.onEditMenuMark?() },
            readFromHere: {}
        )
    }
}

struct PDFTextSelection: Equatable {
    let text: String
    let pageIndex: Int

    var word: String? { VocabularyPDFView.selectedWord(from: text) }
    var locator: String { "page:\(pageIndex)" }
}

struct PDFReaderView: UIViewRepresentable {
    @EnvironmentObject private var container: AppContainer
    let book: CatalogBook
    let fileURL: URL
    @Binding var textSelection: PDFTextSelection?
    @ObservedObject var controller: PDFReaderController

    func makeUIView(context: Context) -> PDFView {
        let pdfView = VocabularyPDFView()
        controller.attach(pdfView)
        pdfView.autoScales = true
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.displaysPageBreaks = false
        pdfView.backgroundColor = container.settingsRepository.theme.uiBackground
        pdfView.document = PDFDocument(url: fileURL)
        pdfView.accessibilityIdentifier = "pdf-reader"
        pdfView.accessibilityLabel = "PDF reader: \(book.title)"
        pdfView.accessibilityValue = "\(pdfView.document?.pageCount ?? 0) rendered pages"
        pdfView.isAccessibilityElement = true
        pdfView.editMenuSelection = { [weak coordinator = context.coordinator] in
            coordinator?.textSelection.wrappedValue?.text ?? pdfView.currentSelection?.string ?? ""
        }
        pdfView.onEditMenuAddWord = { [weak coordinator = context.coordinator] in
            coordinator?.addWordFromEditMenu()
        }
        pdfView.onEditMenuMark = { [weak coordinator = context.coordinator] in
            coordinator?.markFromEditMenu()
        }
        let progress = container.progressRepository.get(bookId: book.id)
        if progress.cfi.hasPrefix("page:"),
           let pageIndex = Int(progress.cfi.dropFirst("page:".count)),
           let page = pdfView.document?.page(at: pageIndex) {
            pdfView.go(to: page)
        }
        let initialIndex = pdfView.currentPage.flatMap { pdfView.document?.index(for: $0) } ?? 0
        let initialPageCount = pdfView.document?.pageCount ?? 1
        let initialFurthest = container.progressRepository.get(bookId: book.id).progression
        DispatchQueue.main.async {
            controller.furthestProgression = initialFurthest
            controller.reloadTableOfContents()
            controller.updatePage(index: initialIndex, count: initialPageCount)
        }
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.pageChanged(_:)),
            name: Notification.Name.PDFViewPageChanged,
            object: pdfView
        )
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.selectionChanged(_:)),
            name: Notification.Name.PDFViewSelectionChanged,
            object: pdfView
        )
        return pdfView
    }

    func updateUIView(_ uiView: PDFView, context: Context) {
        controller.attach(uiView)
        uiView.backgroundColor = container.settingsRepository.theme.uiBackground
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(container: container, book: book, textSelection: $textSelection, controller: controller)
    }

    static func dismantleUIView(_ uiView: PDFView, coordinator: Coordinator) {
        NotificationCenter.default.removeObserver(coordinator)
        uiView.document = nil
    }

    @MainActor
    final class Coordinator: NSObject {
        private let container: AppContainer
        private let book: CatalogBook
        private let controller: PDFReaderController?
        fileprivate var textSelection: Binding<PDFTextSelection?>

        init(
            container: AppContainer,
            book: CatalogBook,
            textSelection: Binding<PDFTextSelection?> = .constant(nil),
            controller: PDFReaderController? = nil
        ) {
            self.container = container
            self.book = book
            self.textSelection = textSelection
            self.controller = controller
        }

        @objc func pageChanged(_ note: Notification) {
            guard let pdfView = note.object as? PDFView,
                  let document = pdfView.document,
                  let page = pdfView.currentPage else { return }
            let index = document.index(for: page)
            let progression = Double(max(index, 0)) / Double(max(document.pageCount - 1, 1))
            let pageCount = document.pageCount
            DispatchQueue.main.async { [weak controller] in
                controller?.updatePage(index: index, count: pageCount)
            }
            container.progressRepository.save(bookId: book.id, progression: progression, cfi: "page:\(index)")
            let session = ReaderSession(
                bookId: book.id, bookTitle: book.title, format: .pdf, author: book.author,
                year: book.year, locator: nil, pageIndex: index, pageOffset: 0,
                rightsStatus: book.rightsStatus, license: book.license,
                licenseUrl: book.licenseUrl, rightsSource: book.rightsSource
            )
            container.settingsRepository.saveReaderSession(session)
            Task {
                await container.nostrSyncService.pushProgress(book: book, progression: progression, cfi: "page:\(index)")
            }
        }

        @objc func selectionChanged(_ note: Notification) {
            guard let pdfView = note.object as? PDFView else { return }
            let text = pdfView.currentSelection?.string?
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !text.isEmpty else {
                textSelection.wrappedValue = nil
                return
            }
            let page = pdfView.currentSelection?.pages.first ?? pdfView.currentPage
            let index = page.flatMap { pdfView.document?.index(for: $0) } ?? 0
            textSelection.wrappedValue = PDFTextSelection(text: String(text.prefix(2_000)), pageIndex: max(index, 0))
        }

        fileprivate func addWordFromEditMenu() {
            guard let selection = textSelection.wrappedValue,
                  let phrase = ReaderSelectionActions.phraseForVocabulary(from: selection.text)
            else { return }
            _ = container.vocabularyRepository.saveSelection(
                word: phrase,
                language: "en",
                bookId: book.id,
                bookTitle: book.title,
                cfi: selection.locator,
                context: selection.text
            )
            controller?.highlightCurrentSelection()
            NotificationCenter.default.post(name: .bookstrVocabularyDidChange, object: nil)
        }

        fileprivate func markFromEditMenu() {
            guard let selection = textSelection.wrappedValue else { return }
            let text = ReaderSelectionActions.normalizedText(selection.text)
            guard !text.isEmpty else { return }
            guard container.snippetRepository.saveMark(
                text: text,
                bookId: book.id,
                bookTitle: book.title,
                author: book.author,
                isbn: NostrSyncService.normalizedISBN(book.isbn),
                format: .pdf,
                locator: selection.locator
            ) != nil else { return }
            controller?.highlightCurrentSelection()
            NotificationCenter.default.post(name: .bookstrSnippetsDidChange, object: nil)
        }
    }
}
