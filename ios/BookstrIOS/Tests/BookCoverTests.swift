import XCTest
import PDFKit
#if canImport(UIKit)
import UIKit
#endif
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class BookCoverTests: XCTestCase {
    private let png = Data([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82,
    ])

    func testBookCoverViewURLAcceptsWebAndFileSchemesOnly() {
        XCTAssertNotNil(BookCoverView.coverURL("https://example.com/cover.jpg"))
        XCTAssertNotNil(BookCoverView.coverURL("file:///tmp/covers/abc.jpg"))
        XCTAssertNil(BookCoverView.coverURL("data:image/png;base64,AAAA"))
        XCTAssertNil(BookCoverView.coverURL("javascript:alert(1)"))
        XCTAssertNil(BookCoverView.coverURL(""))
        XCTAssertNil(BookCoverView.coverURL(nil))
    }

#if canImport(UIKit) && !SWIFT_PACKAGE
    func testLocalCoverThumbnailIsDownsampledAndCached() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("cover-thumbnail-\(UUID().uuidString).jpg")
        defer { try? FileManager.default.removeItem(at: url) }
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1_200, height: 1_800))
        let data = renderer.jpegData(withCompressionQuality: 0.9) { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1_200, height: 1_800))
        }
        try data.write(to: url)

        let first = try XCTUnwrap(BookCoverView.thumbnailImage(at: url))
        let second = try XCTUnwrap(BookCoverView.thumbnailImage(at: url))
        XCTAssertLessThanOrEqual(max(first.size.width, first.size.height), 256)
        XCTAssertTrue(first === second)
    }
#endif

    func testExtractsEPUB3CoverImageProperty() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest>"# +
            #"<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"# +
            #"<item id="cover" href="images/cover%20art.png" media-type="image/png" properties="cover-image"/>"# +
            #"</manifest><spine/></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/nav.xhtml", Data("<html/>".utf8)),
            ("OEBPS/images/cover art.png", png),
        ])
        XCTAssertEqual(cover?.pathExtension, "png")
        XCTAssertEqual(cover?.data, png)
    }

    func testExtractsEPUB2MetaCoverConvention() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata>"# +
            #"<meta name="cover" content="my-cover"/>"# +
            #"</metadata><manifest>"# +
            #"<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>"# +
            #"<item id="my-cover" href="covers/cover.jpg" media-type="image/jpeg"/>"# +
            #"</manifest><spine/></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
            ("OEBPS/covers/cover.jpg", png),
        ])
        XCTAssertNotNil(cover)
    }

    func testFallsBackToConventionalCoverEntry() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/>"# +
            #"<manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>"# +
            #"<spine/></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
            ("cover.jpg", png),
        ])
        XCTAssertEqual(cover?.data, png)
    }

    func testReturnsNilWhenEPUBHasNoCover() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/>"# +
            #"<manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>"# +
            #"<spine/></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
        ])
        XCTAssertNil(cover)
    }

    func testReturnsNilForTruncatedEPUBArchive() {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("cover-trunc-\(UUID().uuidString).epub")
        try? Data([0x50, 0x4B]).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertNil(PublicationUtilities.epubCover(fileURL: url))
    }

    func testRejectsNonImagePayloadInCoverSlot() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/>"# +
            #"<manifest><item id="cover" href="cover.bin" media-type="image/png" properties="cover-image"/></manifest>"# +
            #"<spine/></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/cover.bin", Data("not an image".utf8)),
        ])
        XCTAssertNil(cover)
    }

    func testFallsBackToCoverPrefixedBasename() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/>"# +
            #"<manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>"# +
            #"<spine/></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
            ("OEBPS/images/cover_front.jpg", png),
        ])
        XCTAssertEqual(cover?.data, png)
    }

    func testExtractsGuideCoverReference() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata/>"# +
            #"<manifest><item id="cover" href="images/front.png" media-type="image/png"/>"# +
            #"<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>"# +
            #"<spine/><guide><reference type="cover" title="Cover" href="images/front.png"/></guide></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
            ("OEBPS/images/front.png", png),
        ])
        XCTAssertEqual(cover?.data, png)
    }

    func testFollowsCoverXHTMLToISBNNamedImage() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata>"# +
            #"<meta name="cover" content="cover"/></metadata><manifest>"# +
            #"<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>"# +
            #"<item id="cimage" href="images/9780143127550.jpg" media-type="image/jpeg"/>"# +
            #"<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>"# +
            #"</manifest><spine/><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#
        let coverPage = Data(
            #"<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="images/9780143127550.jpg"/></body></html>"#
                .utf8
        )
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/cover.xhtml", coverPage),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
            ("OEBPS/images/9780143127550.jpg", png),
        ])
        XCTAssertEqual(cover?.data, png)
    }

    func testFallsBackToManifestRasterWhenCoverMetadataMissing() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata/>"# +
            #"<manifest><item id="jacket" href="images/9780143127550.jpg" media-type="image/jpeg"/>"# +
            #"<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>"# +
            #"<spine/></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
            ("OEBPS/images/9780143127550.jpg", png),
        ])
        XCTAssertEqual(cover?.data, png)
    }

    func testFallsBackToZipRasterEntryAbsentFromManifest() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata/>"# +
            #"<manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>"# +
            #"<spine/></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
            ("OEBPS/images/jacket.png", png),
        ])
        XCTAssertEqual(cover?.data, png)
    }

    func testFollowsCoverXHTMLXlinkHref() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata>"# +
            #"<meta name="cover" content="cover"/></metadata><manifest>"# +
            #"<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>"# +
            #"<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>"# +
            #"</manifest><spine/></package>"#
        let coverPage = Data((
            #"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><body>"# +
            #"<image xlink:href="images/front.webp#view"/></body></html>"#
        ).utf8)
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/cover.xhtml", coverPage),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
            ("OEBPS/images/front.webp", png),
        ])
        XCTAssertEqual(cover?.data, png)
    }

    func testExtractsManifestItemNamedCoverWithoutProperties() throws {
        let opf = #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata/>"# +
            #"<manifest><item id="cover-image" href="art/jacket.jpg" media-type="image/jpeg"/>"# +
            #"<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>"# +
            #"<spine/></package>"#
        let cover = try epubCover(entries: [
            ("META-INF/container.xml", containerXML(rootPath: "OEBPS/content.opf")),
            ("OEBPS/content.opf", Data(opf.utf8)),
            ("OEBPS/chapter.xhtml", Data("<html/>".utf8)),
            ("OEBPS/art/jacket.jpg", png),
        ])
        XCTAssertEqual(cover?.data, png)
    }

    func testPDFCoverRendersFirstPage() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("cover-test-\(UUID().uuidString).pdf")
        let document = PDFDocument()
        let page = PDFPage()
        document.insert(page, at: 0)
        XCTAssertTrue(document.write(to: url))
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertNotNil(PublicationUtilities.pdfCover(fileURL: url))
    }

#if !SWIFT_PACKAGE
    func testCatalogBookCoverUrlCanBeStampedIncludingNegativeCache() {
        var book = CatalogBook(
            id: "abc", title: "T", author: "A", epubUrl: "https://example.com/a.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .epub, year: nil
        )
        XCTAssertNil(book.coverUrl)
        book.coverUrl = ""
        XCTAssertEqual(book.coverUrl, "")
        book.coverUrl = "file:///tmp/covers/abc.jpg"
        XCTAssertEqual(book.coverUrl, "file:///tmp/covers/abc.jpg")
    }

    func testEmbeddedCoverScanSkipsNegativeCacheAndKeepsRemoteCovers() {
        let unscanned = CatalogBook(
            id: "a", title: "T", author: "A", epubUrl: "https://example.com/a.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .epub, year: nil
        )
        let negative = CatalogBook(
            id: "b", title: "T", author: "A", epubUrl: "https://example.com/b.epub",
            coverUrl: "", sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .epub, year: nil
        )
        let remote = CatalogBook(
            id: "c", title: "T", author: "A", epubUrl: "https://example.com/c.epub",
            coverUrl: "https://covers.example/c.jpg", sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .epub, year: nil
        )
        XCTAssertTrue(CatalogRepository.shouldScanEmbeddedCover(for: unscanned))
        XCTAssertFalse(CatalogRepository.shouldScanEmbeddedCover(for: negative))
        XCTAssertFalse(CatalogRepository.shouldScanEmbeddedCover(for: remote))
        XCTAssertTrue(CatalogRepository.hasUsableCover(remote))
        XCTAssertFalse(CatalogRepository.hasUsableCover(negative))
        XCTAssertFalse(CatalogRepository.hasUsableCover(unscanned))
    }
#endif

    func testBookstrTagCoverSlotRoundTrip() {
        let cover = "https://lib.b.bfr.ee/api/covers/abc123"
        let serialized = FavoritesParser.compactItemTags(refs: [
            SharedFavoriteRef(bookstrId: "book-1", url: "https://example.com/a.epub", title: "Title",
                              format: "epub", coverUrl: cover),
        ], fallbackAddedAt: 1_000)
        let bookstrTag = serialized.first { $0.first == "bookstr" }
        XCTAssertEqual(bookstrTag?.count, 15)
        XCTAssertEqual(bookstrTag?[9], cover)

        let parsed = FavoritesParser.parseSharedFavoriteTags(serialized as [Any])
        XCTAssertEqual(parsed.count, 1)
        XCTAssertEqual(parsed.first?.coverUrl, cover)
    }

    func testBookstrTagParsesWebPublishedCover() {
        let tags: [[String]] = [
            ["bookstr", "book-1", "Title", "Author", "https://example.com/a.epub", "epub", "1990",
             "en", "gutenberg", "https://covers.example/1.jpg", "sha-of-cover",
             "public_domain", "", "", ""],
        ]
        let parsed = FavoritesParser.parseSharedFavoriteTags(tags as [Any])
        XCTAssertEqual(parsed.first?.coverUrl, "https://covers.example/1.jpg")
        let external = FavoritesParser.matchSharedFavorites(refs: parsed, books: [])
        XCTAssertEqual(external.external.first?.coverUrl, "https://covers.example/1.jpg")
    }

    func testLocalCoverPathsNeverSyncToNostr() {
        let serialized = FavoritesParser.compactItemTags(refs: [
            SharedFavoriteRef(bookstrId: "book-1", title: "Title", coverUrl: "file:///tmp/covers/book-1.jpg"),
        ], fallbackAddedAt: 1_000)
        let bookstrTag = serialized.first { $0.first == "bookstr" }
        XCTAssertEqual(bookstrTag?[9], "")
        XCTAssertNil(FavoritesParser.remoteCoverURL("file:///tmp/covers/book-1.jpg"))
    }

    // MARK: - Helpers

    private func containerXML(rootPath: String) -> Data {
        Data(#"<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="\#(rootPath)" media-type="application/oebps-package+xml"/></rootfiles></container>"#.utf8)
    }

    private func epubCover(entries: [(name: String, data: Data)]) throws -> PublicationUtilities.EmbeddedCover? {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("cover-test-\(UUID().uuidString).epub")
        try Self.makeZIP(entries: entries).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        return PublicationUtilities.epubCover(fileURL: url)
    }

    /// Minimal stored-method ZIP. The reader verifies structure and sizes; the
    /// CRC field is left zeroed because nothing on this path checks it.
    private static func makeZIP(entries: [(name: String, data: Data)]) -> Data {
        var body = Data()
        var directory = Data()
        var offset = 0
        for entry in entries {
            let name = Data(entry.name.utf8)
            let size = UInt32(entry.data.count)

            var localHeader = Data()
            localHeader.append(u32(0x04034b50))
            localHeader.append(u16(20))
            localHeader.append(u16(0))
            localHeader.append(u16(0))
            localHeader.append(u16(0))
            localHeader.append(u16(0))
            localHeader.append(u32(0))
            localHeader.append(u32(size))
            localHeader.append(u32(size))
            localHeader.append(u16(UInt16(name.count)))
            localHeader.append(u16(0))
            body.append(localHeader)
            body.append(name)
            body.append(entry.data)

            var directoryEntry = Data()
            directoryEntry.append(u32(0x02014b50))
            directoryEntry.append(u16(20))
            directoryEntry.append(u16(20))
            directoryEntry.append(u16(0))
            directoryEntry.append(u16(0))
            directoryEntry.append(u16(0))
            directoryEntry.append(u16(0))
            directoryEntry.append(u32(0))
            directoryEntry.append(u32(size))
            directoryEntry.append(u32(size))
            directoryEntry.append(u16(UInt16(name.count)))
            directoryEntry.append(u16(0))
            directoryEntry.append(u16(0))
            directoryEntry.append(u16(0))
            directoryEntry.append(u16(0))
            directoryEntry.append(u32(0))
            directoryEntry.append(u32(UInt32(offset)))
            directoryEntry.append(name)
            directory.append(directoryEntry)
            offset += localHeader.count + name.count + entry.data.count
        }
        var eocd = Data()
        eocd.append(u32(0x06054b50))
        eocd.append(u16(0))
        eocd.append(u16(0))
        eocd.append(u16(UInt16(entries.count)))
        eocd.append(u16(UInt16(entries.count)))
        eocd.append(u32(UInt32(directory.count)))
        eocd.append(u32(UInt32(offset)))
        eocd.append(u16(0))
        body.append(directory)
        body.append(eocd)
        return body
    }

    private static func u16(_ value: UInt16) -> Data {
        withUnsafeBytes(of: value.littleEndian) { Data($0) }
    }

    private static func u32(_ value: UInt32) -> Data {
        withUnsafeBytes(of: value.littleEndian) { Data($0) }
    }
}
