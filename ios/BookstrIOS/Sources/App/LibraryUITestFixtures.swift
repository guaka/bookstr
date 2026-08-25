#if DEBUG
import Foundation
import UIKit

/// Deterministic, offline publications for the simulator UI tests. This runs
/// only when the UI-test launch argument is present and never affects a normal
/// debug or production launch.
enum LibraryUITestFixtures {
    static let epubID = "ui-test-alice-epub"
    static let pdfID = "ui-test-alice-pdf"

    static func install(fileStore: JSONFileStore, settings: SettingsRepository) {
        settings.theme = .night
        settings.authMode = .none
        settings.pubkeyHex = nil
        settings.saveReaderSession(ReaderSession(
            bookId: epubID,
            bookTitle: "Alice EPUB Fixture",
            format: .epub,
            author: "Lewis Carroll",
            year: "1865",
            locator: nil,
            pageIndex: 0,
            pageOffset: 0
        ))

        let epub = CatalogBook(
            id: epubID, title: "Alice EPUB Fixture", author: "Lewis Carroll",
            epubUrl: "", coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .epub, blossomSha256: nil, year: "1865"
        )
        let pdf = CatalogBook(
            id: pdfID, title: "Alice PDF Fixture", author: "Lewis Carroll",
            epubUrl: "", coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .pdf, blossomSha256: nil, year: "1865"
        )

        try? epubData().write(to: fileStore.bookFileURL(bookId: epubID, format: .epub), options: .atomic)
        try? pdfData().write(to: fileStore.bookFileURL(bookId: pdfID, format: .pdf), options: .atomic)
        fileStore.save("downloaded-books.json", value: [epub, pdf])
        fileStore.save("book_progress.json", value: [
            BookProgress(bookId: epubID, progression: 0.01, cfi: "", updatedAt: 2),
            BookProgress(bookId: pdfID, progression: 0.01, cfi: "", updatedAt: 1),
        ])
    }

    private static func pdfData() -> Data {
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 420, height: 595))
        return renderer.pdfData { context in
            context.beginPage()
            "Alice's Adventures in Wonderland\nLewis Carroll\n\nAlice was beginning to get very tired."
                .draw(
                    in: CGRect(x: 36, y: 36, width: 348, height: 500),
                    withAttributes: [
                        .font: UIFont.systemFont(ofSize: 18),
                        .foregroundColor: UIColor.black,
                    ]
                )
        }
    }

    private static func epubData() -> Data {
        let paragraphs = (1...36).map { index in
            "<p>Passage \(index). Alice followed the White Rabbit through Wonderland, " +
            "where every turn brought another curious conversation and another reason to continue reading.</p>"
        }.joined()
        let chapter = """
        <?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>
        <title>Down the Rabbit-Hole</title></head><body><h1>Down the Rabbit-Hole</h1>
        <p>Alice was beginning to get very tired.</p>\(paragraphs)
        <h2>The final page marker</h2><p>Alice reached the end of the navigation fixture.</p>
        </body></html>
        """
        return storedZip([
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", #"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#),
            ("OEBPS/content.opf", #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">alice-ui-test</dc:identifier><dc:title>Alice's Adventures in Wonderland</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#),
            ("OEBPS/chapter.xhtml", chapter),
        ])
    }

    private static func storedZip(_ entries: [(String, String)]) -> Data {
        var archive = Data()
        var directory = Data()
        var count: UInt16 = 0
        for (name, contents) in entries {
            let nameData = Data(name.utf8)
            let body = Data(contents.utf8)
            let checksum = crc32(body)
            let offset = UInt32(archive.count)
            appendLE(UInt32(0x04034b50), to: &archive)
            appendLE(UInt16(20), to: &archive); appendLE(UInt16(0), to: &archive)
            appendLE(UInt16(0), to: &archive); appendLE(UInt16(0), to: &archive); appendLE(UInt16(0), to: &archive)
            appendLE(checksum, to: &archive); appendLE(UInt32(body.count), to: &archive); appendLE(UInt32(body.count), to: &archive)
            appendLE(UInt16(nameData.count), to: &archive); appendLE(UInt16(0), to: &archive)
            archive.append(nameData); archive.append(body)

            appendLE(UInt32(0x02014b50), to: &directory)
            appendLE(UInt16(20), to: &directory); appendLE(UInt16(20), to: &directory)
            appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory)
            appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory)
            appendLE(checksum, to: &directory); appendLE(UInt32(body.count), to: &directory); appendLE(UInt32(body.count), to: &directory)
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

    private static func appendLE<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        var value = value.littleEndian
        withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
    }

    private static func crc32(_ data: Data) -> UInt32 {
        var crc = UInt32.max
        for byte in data {
            crc ^= UInt32(byte)
            for _ in 0..<8 { crc = (crc >> 1) ^ (0xedb88320 & (0 &- (crc & 1))) }
        }
        return ~crc
    }
}
#endif
