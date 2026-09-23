import CarPlay
import UIKit

/// Audio browsing is deliberately offline: only validated local publications and
/// already-cached artwork are read while the vehicle is connected.
@MainActor
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private let container = AppContainer.shared

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController) {
        self.interfaceController = interfaceController
        container.coverDiscovery.setCarPlayConnected(true)
        reload()
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        self.interfaceController = nil
        container.coverDiscovery.setCarPlayConnected(false)
    }

    private func reload() {
        let books = container.catalogRepository.downloadedBooks().filter {
            $0.format == .epub || $0.format == .fb2
        }
        let byID = Dictionary(uniqueKeysWithValues: books.map { ($0.id, $0) })
        let recent = container.progressRepository.all().compactMap { byID[$0.bookId] }
        let cap = CPListTemplate.maximumItemCount
        let recentBooks = Array(recent.prefix(min(10, cap)))
        let remaining = max(0, cap - recentBooks.count)
        let otherBooks = Array(books.prefix(remaining))

        var sections: [CPListSection] = []
        if !recentBooks.isEmpty {
            sections.append(CPListSection(items: recentBooks.map(makeItem), header: "Continue Listening", sectionIndexTitle: nil))
        }
        if !otherBooks.isEmpty {
            sections.append(CPListSection(items: otherBooks.map(makeItem), header: "Downloaded Books", sectionIndexTitle: nil))
        }
        if sections.isEmpty {
            let empty = CPListItem(text: "No downloaded EPUB or FB2 books", detailText: "Download books on your iPhone first")
            sections = [CPListSection(items: [empty])]
        }
        let list = CPListTemplate(title: "Bookstr", sections: sections)
        interfaceController?.setRootTemplate(list, animated: false, completion: nil)
    }

    private func makeItem(_ book: CatalogBook) -> CPListItem {
        let item = CPListItem(text: book.title, detailText: book.author,
                              image: CoverArtwork.image(for: book, discovery: container.coverDiscovery))
        item.handler = { [weak self] _, completion in
            self?.play(book)
            completion()
        }
        return item
    }

    private func play(_ book: CatalogBook) {
        guard let local = container.catalogRepository.localPublication(for: book),
              local.book.format == .epub || local.book.format == .fb2 else {
            reload()
            return
        }
        let locator = container.progressRepository.get(bookId: book.id).cfi
        container.readerPlayback.presentForCarPlay(
            book: local.book, localURL: local.url,
            locator: locator.isEmpty ? nil : locator
        )
        interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
    }
}
