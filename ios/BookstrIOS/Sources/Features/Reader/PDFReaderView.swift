import SwiftUI
import PDFKit

struct PDFReaderView: UIViewRepresentable {
    @EnvironmentObject private var container: AppContainer
    let book: CatalogBook
    let fileURL: URL

    func makeUIView(context: Context) -> PDFView {
        let pdfView = PDFView()
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
        let progress = container.progressRepository.get(bookId: book.id)
        if progress.cfi.hasPrefix("page:"),
           let pageIndex = Int(progress.cfi.dropFirst("page:".count)),
           let page = pdfView.document?.page(at: pageIndex) {
            pdfView.go(to: page)
        }
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.pageChanged(_:)),
            name: Notification.Name.PDFViewPageChanged,
            object: pdfView
        )
        return pdfView
    }

    func updateUIView(_ uiView: PDFView, context: Context) {
        uiView.backgroundColor = container.settingsRepository.theme.uiBackground
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(container: container, book: book)
    }

    final class Coordinator: NSObject {
        private let container: AppContainer
        private let book: CatalogBook

        init(container: AppContainer, book: CatalogBook) {
            self.container = container
            self.book = book
        }

        @objc func pageChanged(_ note: Notification) {
            guard let pdfView = note.object as? PDFView,
                  let document = pdfView.document,
                  let page = pdfView.currentPage else { return }
            let index = document.index(for: page)
            let progression = Double(max(index, 0)) / Double(max(document.pageCount - 1, 1))
            container.progressRepository.save(bookId: book.id, progression: progression, cfi: "page:\(index)")
            let session = ReaderSession(bookId: book.id, bookTitle: book.title, format: .pdf, author: book.author, year: book.year, locator: nil, pageIndex: index, pageOffset: 0)
            container.settingsRepository.saveReaderSession(session)
            Task {
                await container.nostrSyncService.pushProgress(book: book, progression: progression, cfi: "page:\(index)")
            }
        }
    }
}
