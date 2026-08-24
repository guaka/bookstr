import XCTest
import PDFKit
import UIKit
import CryptoKit
import SwiftUI
import WebKit
@testable import BookstrIOS

final class FavoritesParserTests: XCTestCase {
    func testPublicationIdentityCandidatesIncludeBlossomAndMD5AliasesOnce() {
        let book = CatalogBook(
            id: "legacy-id", title: "Alias test", author: "Author", epubUrl: "https://example.com/book.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil,
            libvaultMd5: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", format: .epub,
            blossomSha256: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            year: nil
        )

        XCTAssertEqual(
            CatalogRepository.publicationIdentityCandidates(for: book),
            [
                "legacy-id",
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ]
        )
    }

    func testParsesEncryptedNIP51TagFormat() {
        let sha = String(repeating: "b", count: 64)
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let tags: [Any] = [
            ["r", "https://lib.b.bfr.ee/#book?md5=\(md5)"],
            ["libvault", md5],
            ["libvault-book", md5, "A Book", "An Author", "epub", "1234", "2024"],
            ["blossom", md5, sha, "https://blossom.bfr.ee/\(sha)", "epub"],
            ["i", "isbn:978-0-123456-78-9", "https://lib.b.bfr.ee/#book?md5=\(md5)"],
            ["k", "isbn"]
        ]
        let refs = FavoritesParser.parseSharedFavoriteTags(tags)
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "A Book")
        XCTAssertEqual(refs[0].author, "An Author")
        XCTAssertEqual(refs[0].year, "2024")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].blossomSha256, sha)
        XCTAssertEqual(refs[0].blossomUrl, "https://blossom.bfr.ee/\(sha)")
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://lib.b.bfr.ee/#book?md5=\(md5)")
    }

    func testMatchesPortableISBNsAndKeepsUnmatchedEditions() {
        let tags: [Any] = [
            ["libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
            ["i", "isbn:9780123456789"],
            ["r", "https://lib.b.bfr.ee/#book?md5=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
            ["libvault", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]
        ]
        let refs = FavoritesParser.parseSharedFavoriteTags(tags)
        let result = FavoritesParser.matchSharedFavorites(
            refs: refs,
            books: [
                CatalogBook(
                    id: "book-1",
                    title: "One",
                    author: "Author",
                    epubUrl: "one.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: "978-0-123456-78-9",
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                )
            ]
        )
        XCTAssertEqual(result.bookIds, ["book-1"])
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].libvaultMd5, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    }

    func testBlossomFavoriteBecomesCatalogBook() {
        let sha = String(repeating: "b", count: 64)
        let favorite = ExternalFavorite(
            key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            title: "A Book",
            author: "An Author",
            year: "2024",
            url: nil,
            isbn: "9780123456789",
            libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            format: "epub",
            blossomSha256: sha,
            blossomUrl: "https://blossom.bfr.ee/\(sha)"
        )
        let book = CatalogRepository.fromBlossomFavorite(favorite)
        XCTAssertEqual(book?.id, sha)
        XCTAssertEqual(book?.title, "A Book")
        XCTAssertEqual(book?.epubUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testBlossomFavoriteSynthesizesURL() {
        let sha = String(repeating: "c", count: 64)
        let favorite = ExternalFavorite(
            key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            title: "A Book",
            author: "An Author",
            year: nil,
            url: nil,
            isbn: nil,
            libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            format: "epub",
            blossomSha256: sha,
            blossomUrl: nil
        )
        XCTAssertEqual(CatalogRepository.fromBlossomFavorite(favorite)?.epubUrl, "https://blossom.bfr.ee/\(sha)")
    }

    func testBlossomFavoriteNeverFallsBackToLibVaultLocator() {
        let sha = String(repeating: "d", count: 64)
        let favorite = ExternalFavorite(
            key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            title: "A Book", author: "An Author", year: nil,
            url: "https://lib.b.bfr.ee/api/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            isbn: nil, libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", format: "epub",
            blossomSha256: sha, blossomUrl: nil
        )
        XCTAssertEqual(CatalogRepository.fromBlossomFavorite(favorite)?.epubUrl,
                       "https://blossom.bfr.ee/\(sha)")
    }

    func testLibVaultDescriptorWithoutBlossomIsNotFetchable() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let favorite = ExternalFavorite(
            key: md5,
            title: "A Resolved Book",
            author: "An Author",
            year: "2024",
            url: nil,
            isbn: nil,
            libvaultMd5: md5,
            format: "pdf",
            blossomSha256: nil,
            blossomUrl: nil
        )
        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testRegularDownloadFavoriteBecomesCatalogBook() {
        let favorite = ExternalFavorite(
            key: "gutenberg:123",
            title: "A Search Favorite",
            author: "An Author",
            year: "2024",
            url: "https://books-api.guaka.org/api/books/123/download",
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )
        let book = CatalogRepository.fromExternalFavorite(favorite)
        XCTAssertEqual(book?.id, "gutenberg:123")
        XCTAssertEqual(book?.format, .epub)
        XCTAssertEqual(book?.epubUrl, favorite.url)
    }

    func testFavoriteWithoutDownloadLocationCannotBecomeCatalogBook() {
        let favorite = ExternalFavorite(
            key: "missing",
            title: "Unavailable",
            author: nil,
            year: nil,
            url: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: "epub",
            blossomSha256: nil,
            blossomUrl: nil
        )
        XCTAssertNil(CatalogRepository.fromExternalFavorite(favorite))
    }

    func testParsesWrappedTagsObject() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let json = "{\"tags\":[[\"libvault\",\"\(md5)\"],[\"libvault-book\",\"\(md5)\",\"Wrapped\",\"Author\",\"epub\"]]}"
        let refs = FavoritesParser.parseSharedFavoriteTags(json)
        XCTAssertEqual(refs.first?.title, "Wrapped")
    }

    func testRelayEventWithNumericTagsDecodes() {
        let event = NostrEvent.fromRelayObject([
            "id": "abc",
            "pubkey": "def",
            "created_at": 1_700_000_000,
            "kind": 30003,
            "tags": [["d", "libvault-favorites"], ["published_at", 123]],
            "content": "ciphertext",
            "sig": "sig"
        ])
        XCTAssertEqual(event?.kind, 30003)
        XCTAssertEqual(event?.dTag, "libvault-favorites")
        XCTAssertEqual(event?.tags.last, ["published_at", "123"])
    }

    func testReadsChunkManifest() {
        let manifest = FavoritesParser.chunkManifest(from: #"[["libvault-chunks","3","libvault-favorites-chunk"]]"#)
        XCTAssertEqual(manifest?.count, 3)
        XCTAssertEqual(manifest?.prefix, "libvault-favorites-chunk")
        XCTAssertEqual(NostrKinds.favoritesChunkDTag(index: 1), "libvault-favorites-chunk-1")
        XCTAssertNil(FavoritesParser.chunkManifest(from: #"[["libvault","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]]"#))
    }

    func testParsesCompactFavoriteReference() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-collection", "2"],
            ["title", "Favorites"],
            ["book", "libvault", md5, "1700000000"]
        ])
        XCTAssertEqual(refs, [SharedFavoriteRef(libvaultMd5: md5, addedAt: 1_700_000_000)])
    }

    func testDuplicateCompactReferenceKeepsBlossomAssociation() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let sha = String(repeating: "b", count: 64)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000000"],
            ["blossom", md5, sha, "https://blossom.bfr.ee/\(sha)", "pdf"],
            ["book", "libvault", md5, "1700000100"]
        ])
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].blossomSha256, sha)
        XCTAssertEqual(refs[0].format, "pdf")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_000)
    }

    func testLegacyBookstrBookMetadataTagIsRecognized() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000000"],
            ["bookstr-book", md5, "Legacy title", "Legacy author", "epub"]
        ])
        XCTAssertEqual(refs.first?.title, "Legacy title")
        XCTAssertEqual(refs.first?.author, "Legacy author")
    }

    func testFavoriteMatchesDownloadedBookByBlossomHash() {
        let sha = String(repeating: "c", count: 64)
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(blossomSha256: sha)],
            books: [CatalogBook(id: sha, title: "Local", author: "Author", epubUrl: "",
                                coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
                                format: .epub, blossomSha256: sha, year: nil)]
        )
        XCTAssertEqual(result.bookIds, [sha])
        XCTAssertTrue(result.external.isEmpty)
    }

    func testParseSharedFavoriteTagsRejectsNonJsonInput() {
        XCTAssertTrue(FavoritesParser.parseSharedFavoriteTags("null").isEmpty)
        XCTAssertTrue(FavoritesParser.parseSharedFavoriteTags("not-json").isEmpty)
        XCTAssertTrue(FavoritesParser.parseSharedFavoriteTags("{}").isEmpty)
    }

    func testCollectionIndexFiltersDeletedCollections() {
        let snapshot = FavoritesParser.parseCollectionIndex(from: #"""
            [["collection","bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Keep","10"],
             ["deleted","bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","20"],
             ["collection","bookstr-collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Show","30"]]
            """#)

        XCTAssertEqual(snapshot.entries.count, 1)
        XCTAssertEqual(snapshot.entries[0].0, "bookstr-collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        XCTAssertEqual(snapshot.entries[0].1, "Show")
    }

    func testMatchSharedFavoritesUsesNormalizedISBNAcrossFormats() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(isbn: "978-1-2345-6789-0")],
            books: [CatalogBook(
                id: "book-1",
                title: "Matched",
                author: "Author",
                epubUrl: "https://example.com/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: "9781234567890",
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )]
        )

        XCTAssertEqual(result.bookIds, ["book-1"])
        XCTAssertTrue(result.external.isEmpty)
    }

    func testInvalidPdfHeaderIsRejectedInsteadOfOpeningBlackReader() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("%PDF-not-a-document".utf8).write(to: url)
        XCTAssertEqual(CatalogRepository.detectedFormat(fileURL: url), .pdf)
        XCTAssertFalse(CatalogRepository.isStructurallyValidPublication(fileURL: url, format: .pdf))
    }

    func testRealPdfIsAccepted() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 200, height: 200))
        try renderer.writePDF(to: url) { context in
            context.beginPage()
            "Bookstr".draw(at: CGPoint(x: 20, y: 20), withAttributes: nil)
        }
        XCTAssertEqual(CatalogRepository.detectedFormat(fileURL: url), .pdf)
        XCTAssertTrue(CatalogRepository.isStructurallyValidPublication(fileURL: url, format: .pdf))
    }

    func testPublicDomainAlicePdfFixtureIsAcceptedAndHasReadableText() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        let excerpt = "Alice was beginning to get very tired of sitting by her sister on the bank."
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 420, height: 595))
        try renderer.writePDF(to: url) { context in
            context.beginPage()
            "Alice's Adventures in Wonderland\nLewis Carroll\n\n\(excerpt)".draw(
                in: CGRect(x: 36, y: 36, width: 348, height: 500),
                withAttributes: [.font: UIFont.systemFont(ofSize: 15)]
            )
        }
        XCTAssertTrue(CatalogRepository.isStructurallyValidPublication(fileURL: url, format: .pdf))
        let extracted = PDFDocument(url: url)?.string ?? ""
        XCTAssertTrue(extracted.contains("Alice was beginning"))
        XCTAssertTrue(extracted.contains("Lewis Carroll"))
    }

    func testPublicDomainAliceEpubFixtureIsAccepted() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? FileManager.default.removeItem(at: url) }
        let entries = [
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", #"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#),
            ("OEBPS/content.opf", #"<?xml version="1.0"?><package version="3.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Alice's Adventures in Wonderland</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#),
            ("OEBPS/chapter.xhtml", "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>Down the Rabbit-Hole</h1><p>Alice was beginning to get very tired.</p></body></html>")
        ]
        try makeStoredZip(entries).write(to: url)
        XCTAssertEqual(CatalogRepository.detectedFormat(fileURL: url), .epub)
        XCTAssertTrue(CatalogRepository.isStructurallyValidPublication(fileURL: url, format: .epub))
    }

    @MainActor
    func testPublicDomainAliceEpubActuallyReachesReadyReader() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? FileManager.default.removeItem(at: url) }
        try makeAliceEpub().write(to: url)
        let book = CatalogBook(
            id: "test-alice", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll",
            epubUrl: url.absoluteString, coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .epub, blossomSha256: nil, year: "1865"
        )
        let controller = EPUBReaderController()
        let container = AppContainer.bootstrap()
        container.settingsRepository.theme = .night
        let view = EPUBReaderView(
            book: book, fileURL: url, controller: controller, initialCFI: nil, highlightCFI: nil
        ).frame(width: 390, height: 844).environmentObject(container)
        let host = UIHostingController(rootView: view)
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            throw XCTSkip("The hosted EPUB reader needs a UIWindowScene")
        }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        defer { window.isHidden = true }

        let finished = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in controller.ready || controller.errorMessage != nil },
            object: nil
        )
        await fulfillment(of: [finished], timeout: 10)
        XCTAssertNil(controller.errorMessage, "stage: \(controller.loadingStage)")
        XCTAssertTrue(controller.ready, "stalled at stage: \(controller.loadingStage)")

        guard let webView = findSubview(WKWebView.self, in: host.view) else {
            return XCTFail("The mounted reader did not contain a WKWebView")
        }
        let visibleText = try await webView.callAsyncJavaScript(
            "return Array.from(document.querySelectorAll('iframe')).map(frame => frame.contentDocument?.body?.innerText || '').join(' ');",
            arguments: [:], in: nil, contentWorld: .page
        ) as? String
        XCTAssertTrue(visibleText?.contains("Alice was beginning") == true, "ready reader had no visible chapter text")

        let layoutJSON = try await webView.callAsyncJavaScript(
            """
            const container = document.querySelector('.epub-container');
            const frame = document.querySelector('iframe');
            return JSON.stringify({
              scrollHeight: container?.scrollHeight || 0,
              clientHeight: container?.clientHeight || 0,
              misclassifiedAsCover: Boolean(frame?.contentDocument?.getElementById('bookstr-cover-layout'))
            });
            """,
            arguments: [:], in: nil, contentWorld: .page
        ) as? String
        let layoutData = try XCTUnwrap(layoutJSON?.data(using: .utf8))
        let layout = try XCTUnwrap(JSONSerialization.jsonObject(with: layoutData) as? [String: Any])
        let scrollHeight = try XCTUnwrap(layout["scrollHeight"] as? Double)
        let clientHeight = try XCTUnwrap(layout["clientHeight"] as? Double)
        XCTAssertFalse(layout["misclassifiedAsCover"] as? Bool ?? true)
        XCTAssertGreaterThan(scrollHeight, clientHeight + 100, "long first chapter had no vertical scroll range")

        let offsetsJSON = try await webView.callAsyncJavaScript(
            """
            const container = document.querySelector('.epub-container');
            container.scrollTo({ top: 0, behavior: 'auto' });
            window.nextPage();
            await new Promise(resolve => setTimeout(resolve, 400));
            const first = container?.scrollTop || 0;
            window.nextPage();
            await new Promise(resolve => setTimeout(resolve, 400));
            const second = container?.scrollTop || 0;
            window.prevPage();
            await new Promise(resolve => setTimeout(resolve, 400));
            const reversedOnce = container?.scrollTop || 0;
            window.prevPage();
            await new Promise(resolve => setTimeout(resolve, 400));
            return JSON.stringify({
              first,
              second,
              reversedOnce,
              backAtStart: container?.scrollTop || 0
            });
            """,
            arguments: [:], in: nil, contentWorld: .page
        ) as? String
        let offsetsData = try XCTUnwrap(offsetsJSON?.data(using: .utf8))
        let offsets = try XCTUnwrap(JSONSerialization.jsonObject(with: offsetsData) as? [String: Double])
        let first = try XCTUnwrap(offsets["first"])
        let second = try XCTUnwrap(offsets["second"])
        let reversedOnce = try XCTUnwrap(offsets["reversedOnce"])
        let backAtStart = try XCTUnwrap(offsets["backAtStart"])
        XCTAssertGreaterThan(first, 100, "nextPage did not advance through the scrollable chapter")
        XCTAssertGreaterThan(second, first + 100, "a second nextPage call stayed on the same page")
        XCTAssertLessThan(reversedOnce, second - 100, "prevPage did not reverse one viewport")
        XCTAssertLessThan(backAtStart, 10, "two prevPage calls did not return to the beginning")

        let snapshot = try await webView.takeSnapshot(configuration: nil)
        XCTAssertGreaterThan(snapshot.size.width, 100)
        XCTAssertGreaterThan(snapshot.size.height, 100)
    }

    @MainActor
    func testEPUBReaderCanAdjustFontPercentViaReaderAPI() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? FileManager.default.removeItem(at: url) }
        try makeAliceEpub().write(to: url)
        let book = CatalogBook(
            id: "test-alice", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll",
            epubUrl: url.absoluteString, coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .epub, blossomSha256: nil, year: "1865"
        )
        let controller = EPUBReaderController()
        let container = AppContainer.bootstrap()
        let view = EPUBReaderView(
            book: book, fileURL: url, controller: controller, initialCFI: nil, highlightCFI: nil
        ).frame(width: 390, height: 844).environmentObject(container)
        let host = UIHostingController(rootView: view)
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
            throw XCTSkip("The hosted EPUB reader needs a UIWindowScene")
        }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        defer { window.isHidden = true }

        let finished = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in controller.ready || controller.errorMessage != nil },
            object: nil
        )
        await fulfillment(of: [finished], timeout: 10)
        XCTAssertNil(controller.errorMessage, "stage: \(controller.loadingStage)")
        XCTAssertTrue(controller.ready, "stalled at stage: \(controller.loadingStage)")

        guard let webView = findSubview(WKWebView.self, in: host.view) else {
            return XCTFail("The mounted reader did not contain a WKWebView")
        }
        let adjustAvailable = try await webView.callAsyncJavaScript(
            "return typeof window.adjustReaderFont;",
            arguments: [:], in: nil, contentWorld: .page
        ) as? String
        XCTAssertEqual(adjustAvailable, "function")

        let fontPercentBefore = try await webView.callAsyncJavaScript(
            "return window.readerFontPercent;",
            arguments: [:], in: nil, contentWorld: .page
        ) as? NSNumber
        XCTAssertNotNil(fontPercentBefore)
        let before = fontPercentBefore?.intValue ?? 100

        await webView.callAsyncJavaScript(
            "window.adjustReaderFont(10);",
            arguments: [:], in: nil, contentWorld: .page
        )
        let fontPercentAfterIncrease = try await webView.callAsyncJavaScript(
            "return window.readerFontPercent;",
            arguments: [:], in: nil, contentWorld: .page
        ) as? NSNumber
        XCTAssertEqual(fontPercentAfterIncrease?.intValue, min(before + 10, 180))

        await webView.callAsyncJavaScript(
            "window.adjustReaderFont(-1000);",
            arguments: [:], in: nil, contentWorld: .page
        )
        let fontPercentAfterDecrease = try await webView.callAsyncJavaScript(
            "return window.readerFontPercent;",
            arguments: [:], in: nil, contentWorld: .page
        ) as? NSNumber
        XCTAssertEqual(fontPercentAfterDecrease?.intValue, 75)

        await webView.callAsyncJavaScript(
            "window.adjustReaderFont(1000);",
            arguments: [:], in: nil, contentWorld: .page
        )
        let fontPercentAfterClamp = try await webView.callAsyncJavaScript(
            "return window.readerFontPercent;",
            arguments: [:], in: nil, contentWorld: .page
        ) as? NSNumber
        XCTAssertEqual(fontPercentAfterClamp?.intValue, 180)
    }

    private func findSubview<T: UIView>(_ type: T.Type, in root: UIView) -> T? {
        if let match = root as? T { return match }
        return root.subviews.lazy.compactMap { self.findSubview(type, in: $0) }.first
    }

    func testEpubContainerMarkerAcrossReadBoundaryIsAccepted() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? FileManager.default.removeItem(at: url) }
        let padding = String(repeating: "x", count: 65_530)
        try makeStoredZip([("padding.txt", padding), ("META-INF/container.xml", "<container/>")]).write(to: url)
        XCTAssertTrue(CatalogRepository.isStructurallyValidPublication(fileURL: url, format: .epub))
    }

    func testIncrementalPublicationHashMatchesCryptoKit() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let data = Data(String(repeating: "Alice in Wonderland. ", count: 10_000).utf8)
        try data.write(to: url)
        let expected = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(CatalogRepository.sha256(fileURL: url, chunkSize: 31), expected)
    }

    func testZipWithoutEpubContainerIsRejected() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data([0x50, 0x4b, 0x03, 0x04, 0x00]).write(to: url)
        XCTAssertEqual(CatalogRepository.detectedFormat(fileURL: url), .epub)
        XCTAssertFalse(CatalogRepository.isStructurallyValidPublication(fileURL: url, format: .epub))
    }

    func testUnavailableSearchResultMatchesExternalFavoriteByStableID() {
        let result = BookSearchResult(
            id: "openlibrary:OL123M", source: "openlibrary", title: "A Book", author: "An Author",
            year: "2024", publisher: nil, language: "en", format: nil, downloadUrl: nil,
            coverUrl: nil, rating: 0, editionCount: 1
        )
        let favorite = ExternalFavorite(
            key: result.id, title: result.title, author: result.author, year: result.year,
            url: nil, isbn: nil, libvaultMd5: nil, format: nil,
            blossomSha256: nil, blossomUrl: nil
        )
        XCTAssertTrue(SearchFavoriteMatcher.matches(result, favorite: favorite))
    }

    func testSearchResultMatchesLegacyFavoriteByTitleAndAuthor() {
        let result = BookSearchResult(
            id: "new-id", source: "catalog", title: "A Book", author: "An Author",
            year: nil, publisher: nil, language: nil, format: .epub, downloadUrl: nil,
            coverUrl: nil, rating: 0, editionCount: 1
        )
        let favorite = ExternalFavorite(
            key: "old-id", title: "a book", author: "an author", year: nil,
            url: nil, isbn: nil, libvaultMd5: nil, format: "epub",
            blossomSha256: nil, blossomUrl: nil
        )
        XCTAssertTrue(SearchFavoriteMatcher.matches(result, favorite: favorite))
    }

    func testSerializesFavoriteMetadataForOfflineClients() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let tags = FavoritesParser.collectionTags(refs: [
            SharedFavoriteRef(libvaultMd5: md5, title: "Not synchronized", author: "Private cache",
                              addedAt: 1_700_000_000)
        ], updatedAt: 1_700_000_100)
        XCTAssertTrue(tags.contains(["book", "libvault", md5, "1700000000"]))
        XCTAssertTrue(FavoritesParser.serializeTags(tags).contains("Not synchronized"))
        XCTAssertTrue(FavoritesParser.serializeTags(tags).contains("Private cache"))
    }

    func testSplitsCompactItemsUnderSignerLimit() {
        let refs = (0..<240).map { index in
            SharedFavoriteRef(
                libvaultMd5: String(format: "%032x", index),
                addedAt: Int64(1_700_000_000 + index)
            )
        }
        let itemTags = FavoritesParser.compactItemTags(refs: refs, fallbackAddedAt: 1_700_000_000)
        let chunks = FavoritesParser.splitItemTags(itemTags)
        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertEqual(chunks.flatMap { $0 }.count, itemTags.count)
        XCTAssertTrue(chunks.allSatisfy {
            FavoritesParser.serializeTags($0).count <= FavoritesParser.maxChunkPlaintextChars
        })
        let manifest = FavoritesParser.chunkManifest(
            from: #"[["bookstr-chunks","3","bookstr-chunk-generation"]]"#
        )
        XCTAssertEqual(manifest, FavoriteChunkManifest(count: 3, prefix: "bookstr-chunk-generation"))
    }

    /// Small, dependency-free ZIP writer used to make a genuine EPUB fixture.
    /// The Alice text is public domain; keeping it generated avoids shipping a
    /// large opaque binary in the test bundle.
    private func makeStoredZip(_ entries: [(String, String)]) throws -> Data {
        var archive = Data()
        var directory = Data()
        var count: UInt16 = 0
        for (name, contents) in entries {
            let nameData = Data(name.utf8)
            let body = Data(contents.utf8)
            let crc = crc32(body)
            let offset = UInt32(archive.count)
            appendLE(UInt32(0x04034b50), to: &archive)
            appendLE(UInt16(20), to: &archive); appendLE(UInt16(0), to: &archive)
            appendLE(UInt16(0), to: &archive); appendLE(UInt16(0), to: &archive); appendLE(UInt16(0), to: &archive)
            appendLE(crc, to: &archive); appendLE(UInt32(body.count), to: &archive); appendLE(UInt32(body.count), to: &archive)
            appendLE(UInt16(nameData.count), to: &archive); appendLE(UInt16(0), to: &archive)
            archive.append(nameData); archive.append(body)

            appendLE(UInt32(0x02014b50), to: &directory)
            appendLE(UInt16(20), to: &directory); appendLE(UInt16(20), to: &directory)
            appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory)
            appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory)
            appendLE(crc, to: &directory); appendLE(UInt32(body.count), to: &directory); appendLE(UInt32(body.count), to: &directory)
            appendLE(UInt16(nameData.count), to: &directory); appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory)
            appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory); appendLE(UInt32(0), to: &directory)
            appendLE(offset, to: &directory); directory.append(nameData)
            count += 1
        }
        let directoryOffset = UInt32(archive.count)
        archive.append(directory)
        appendLE(UInt32(0x06054b50), to: &archive)
        appendLE(UInt16(0), to: &archive); appendLE(UInt16(0), to: &archive)
        appendLE(count, to: &archive); appendLE(count, to: &archive)
        appendLE(UInt32(directory.count), to: &archive); appendLE(directoryOffset, to: &archive); appendLE(UInt16(0), to: &archive)
        return archive
    }

    private func makeAliceEpub() throws -> Data {
        let paragraphs = (1...36).map { index in
            "<p>Passage \(index). Alice followed the White Rabbit through Wonderland, " +
            "where every turn brought another curious conversation and another reason to continue reading.</p>"
        }.joined()
        return try makeStoredZip([
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", #"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#),
            ("OEBPS/content.opf", #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">alice-test</dc:identifier><dc:title>Alice's Adventures in Wonderland</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#),
            ("OEBPS/chapter.xhtml", "<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>Down the Rabbit-Hole</title></head><body><h1>Down the Rabbit-Hole</h1><p>Alice was beginning to get very tired.</p>\(paragraphs)</body></html>")
        ])
    }

    private func appendLE<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        var little = value.littleEndian
        withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
    }

    private func crc32(_ data: Data) -> UInt32 {
        var crc = UInt32.max
        for byte in data {
            crc ^= UInt32(byte)
            for _ in 0..<8 { crc = (crc >> 1) ^ (0xedb88320 & (0 &- (crc & 1))) }
        }
        return ~crc
    }
}
