import PDFKit
import XCTest
import UIKit
@testable import BookstrIOS

@MainActor
final class PDFReaderViewCoordinatorTests: XCTestCase {
    func testPageChangedSavesProgressAndReaderSessionForPdfPage() throws {
        let context = makeContainerContext()
        defer { context.cleanup() }

        let book = sampleBook()
        let coordinator = PDFReaderView.Coordinator(container: context.container, book: book)
        let documentURL = try createPDF(pageCount: 2)
        defer { try? FileManager.default.removeItem(at: documentURL) }

        guard let document = PDFDocument(url: documentURL), let targetPage = document.page(at: 1) else {
            XCTFail("Expected a valid PDF document with at least two pages")
            return
        }

        let pdfView = PDFView()
        pdfView.document = document
        pdfView.go(to: targetPage)

        coordinator.pageChanged(Notification(name: .PDFViewPageChanged, object: pdfView))

        let savedProgress = context.progressRepository.get(bookId: book.id)
        XCTAssertEqual(savedProgress.cfi, "page:1")
        XCTAssertEqual(savedProgress.progression, 1.0, accuracy: 0.000_001)

        let savedSession = context.settingsRepository.readerSession()
        XCTAssertNotNil(savedSession)
        XCTAssertEqual(savedSession?.bookId, book.id)
        XCTAssertEqual(savedSession?.bookTitle, book.title)
        XCTAssertEqual(savedSession?.format, .pdf)
        XCTAssertEqual(savedSession?.pageIndex, 1)
        XCTAssertEqual(savedSession?.pageOffset, 0)
    }

    func testPageChangedNoopsWhenNotificationIsNotPdfView() {
        let context = makeContainerContext()
        defer { context.cleanup() }

        context.progressRepository.save(bookId: "local", progression: 0.41, cfi: "preexisting")
        let coordinator = PDFReaderView.Coordinator(container: context.container, book: sampleBook())

        coordinator.pageChanged(Notification(name: .PDFViewPageChanged, object: NSObject()))

        let savedProgress = context.progressRepository.get(bookId: "local")
        XCTAssertEqual(savedProgress.cfi, "preexisting")
        XCTAssertEqual(savedProgress.progression, 0.41, accuracy: 0.000_001)
        XCTAssertNil(context.settingsRepository.readerSession())
    }

    func testPdfSelectionAcceptsOneWordOnly() {
        XCTAssertEqual(VocabularyPDFView.selectedWord(from: "  reader  "), "reader")
        XCTAssertEqual(VocabularyPDFView.selectedWord(from: "don't"), "don't")
        XCTAssertNil(VocabularyPDFView.selectedWord(from: "two words"))
        XCTAssertNil(VocabularyPDFView.selectedWord(from: ""))
    }

    func testPDFSearchFindsAndDisplaysMatchingText() throws {
        let documentURL = try createSearchablePDF(text: "Alice found Wonderland and followed the rabbit.")
        defer { try? FileManager.default.removeItem(at: documentURL) }
        let view = PDFView()
        view.document = PDFDocument(url: documentURL)
        let controller = PDFReaderController()
        controller.attach(view)

        controller.search("Wonderland")

        XCTAssertEqual(controller.searchResults.count, 1)
        XCTAssertEqual(controller.searchResults.first?.pageIndex, 0)
        XCTAssertEqual(controller.searchResults.first?.excerpt, "Wonderland")
        if let result = controller.searchResults.first {
            controller.display(result)
            XCTAssertEqual(view.currentSelection?.string, "Wonderland")
        }
    }

    private func sampleBook() -> CatalogBook {
        CatalogBook(
            id: "1a" + String(repeating: "2", count: 62),
            title: "Unit PDF",
            author: "Bookstr QA",
            epubUrl: "https://example.org/unit-book.pdf",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: .pdf,
            blossomSha256: nil,
            year: "2026"
        )
    }

    private func createPDF(pageCount: Int) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bookstr-pdf-reader-test-\(UUID().uuidString).pdf")
        let bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        let data = renderer.pdfData { context in
            for _ in 0..<pageCount {
                context.beginPage()
            }
        }
        try data.write(to: url)
        return url
    }

    private func createSearchablePDF(text: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bookstr-pdf-search-test-\(UUID().uuidString).pdf")
        let bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        let data = renderer.pdfData { context in
            context.beginPage()
            text.draw(
                in: CGRect(x: 36, y: 36, width: 520, height: 200),
                withAttributes: [.font: UIFont.systemFont(ofSize: 18)]
            )
        }
        try data.write(to: url)
        return url
    }

    private func makeContainerContext() -> TestContext {
        let suite = "bookstr-pdf-reader-coordinator-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let settings = SettingsRepository(defaults: defaults)
        let fileStoreSubdirectory = "bookstr-pdf-reader-coordinator-" + UUID().uuidString
        let fileStore = JSONFileStore(subdirectory: fileStoreSubdirectory)
        let progress = ProgressRepository(fileStore: fileStore)
        let vocabulary = VocabularyRepository(fileStore: fileStore)
        let dictionary = DictionaryRepository()
        let favoriteMetadata = FavoriteMetadataRepository(fileStore: fileStore)
        let nip46Service = Nip46Service()
        let signerStore = SignerStore(nip46Service: nip46Service)
        let catalog = CatalogRepository(
            fileStore: fileStore,
            settings: settings,
            signerStore: signerStore,
            nip46Service: nip46Service
        )
        let nostrClient = NostrClient()
        let sync = NostrSyncService(
            settings: settings,
            progress: progress,
            vocabulary: vocabulary,
            favoriteMetadata: favoriteMetadata,
            client: nostrClient,
            signerStore: signerStore,
            nip46Service: nip46Service
        )
        let container = AppContainer(
            settingsRepository: settings,
            progressRepository: progress,
            vocabularyRepository: vocabulary,
            dictionaryRepository: dictionary,
            favoriteMetadataRepository: favoriteMetadata,
            catalogRepository: catalog,
            nostrClient: nostrClient,
            signerStore: signerStore,
            nostrSyncService: sync,
            nip46Service: nip46Service
        )

        let rootDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let storeRoot = rootDirectory.appendingPathComponent(fileStoreSubdirectory, isDirectory: true)
        let cleanup: () -> Void = {
            try? FileManager.default.removeItem(at: storeRoot)
            defaults.removePersistentDomain(forName: suite)
        }

        return TestContext(
            container: container,
            settingsRepository: settings,
            progressRepository: progress,
            cleanup: cleanup
        )
    }

    private struct TestContext {
        let container: AppContainer
        let settingsRepository: SettingsRepository
        let progressRepository: ProgressRepository
        let cleanup: () -> Void
    }
}
