#if DEBUG
import Foundation
import UIKit
import CryptoKit

/// Deterministic, offline publications for the simulator UI tests. This runs
/// only when the UI-test launch argument is present and never affects a normal
/// debug or production launch.
enum LibraryUITestFixtures {
    static let epubID = "ui-test-alice-epub"
    static let pdfID = "ui-test-alice-pdf"
    static let cbzID = "ui-test-comic-cbz"
    static let cbrID = "ui-test-comic-cbr"

    static func install(fileStore: JSONFileStore, settings: SettingsRepository) {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--ui-testing-preserve-library-state"),
           FileManager.default.fileExists(atPath: fileStore.bookFileURL(bookId: cbzID, format: .cbz).path) {
            return
        }
        fileStore.save("downloads.json", value: [BookDownloadQueue.Job]())
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
        settings.saveReaderSelection(ReaderSelection(bookId: epubID, format: .epub, selectedAt: 1))

        let epub = CatalogBook(
            id: epubID, title: "Alice EPUB Fixture", author: "Lewis Carroll",
            epubUrl: "", coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .epub, year: "1865"
        )
        let pdf = CatalogBook(
            id: pdfID, title: "Alice PDF Fixture", author: "Lewis Carroll",
            epubUrl: "", coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .pdf, year: "1865"
        )
        let cbz = CatalogBook(
            id: cbzID, title: "Comic CBZ Fixture", author: "Bookstr Tests",
            epubUrl: "", coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .cbz, year: "2026", language: "pt-BR"
        )
        let cbr = CatalogBook(
            id: cbrID, title: "Comic CBR Fixture", author: "Public domain",
            epubUrl: "", coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil,
            format: .cbr, year: nil
        )

        try? epubData().write(to: fileStore.bookFileURL(bookId: epubID, format: .epub), options: .atomic)
        try? pdfData().write(to: fileStore.bookFileURL(bookId: pdfID, format: .pdf), options: .atomic)
        copyBundledFixture(
            named: "bookstr-test-comic", extension: "cbz",
            to: fileStore.bookFileURL(bookId: cbzID, format: .cbz)
        )
        copyBundledFixture(
            named: "bobby-make-believe-public-domain", extension: "cbr",
            to: fileStore.bookFileURL(bookId: cbrID, format: .cbr)
        )
        fileStore.save("downloaded-books.json", value: [epub, pdf, cbz, cbr])
        fileStore.save("book_progress.json", value: [
            BookProgress(bookId: epubID, progression: 0.01, cfi: "", updatedAt: 2),
            BookProgress(bookId: pdfID, progression: 0.8, cfi: "", updatedAt: 1),
            BookProgress(bookId: cbzID, progression: 0, cfi: "comic:0:3", updatedAt: 0),
            BookProgress(bookId: cbrID, progression: 0, cfi: "comic:0:4", updatedAt: 0),
        ])
    }

    private static func copyBundledFixture(named name: String, extension fileExtension: String, to target: URL) {
        guard let source = Bundle.main.url(forResource: name, withExtension: fileExtension, subdirectory: "Comics")
                ?? Bundle.main.url(forResource: name, withExtension: fileExtension),
              let data = try? Data(contentsOf: source) else { return }
        try? data.write(to: target, options: .atomic)
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
            ("OEBPS/content.opf", #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">alice-ui-test</dc:identifier><dc:title>Alice's Adventures in Wonderland</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>"#),
            ("OEBPS/nav.xhtml", #"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Down the Rabbit-Hole</a></li></ol></nav></body></html>"#),
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

extension LibraryUITestFixtures {
    struct TorrentFixtureSigner: NostrSigner {
        let publicKeyHex = String(repeating: "1", count: 64)
        func sign(_ event: NostrEvent) async throws -> NostrEvent { event }
        func nip44Encrypt(_ plaintext: String, to recipientPubkey: String) async throws -> String { plaintext }
        func nip44Decrypt(_ ciphertext: String, from senderPubkey: String) async throws -> String { ciphertext }
    }
    final class EmptyPublicSearch: URLProtocol {
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data("{\"books\":[]}".utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }
    static func torrentCatalog(fileStore: JSONFileStore, settings: SettingsRepository, signerStore: SignerStore, nip46: Nip46Service) -> CatalogRepository {
        let arguments = ProcessInfo.processInfo.arguments
        let zlib = arguments.contains("--ui-testing-zlib-fixture")
        let original = try! Data(contentsOf: fileStore.bookFileURL(bookId: pdfID, format: .pdf))
        func record(_ data: Data, title: String, id: Int) -> [String: Any] {
            let md5 = Insecure.MD5.hash(data: data).map { String(format: "%02x", $0) }.joined()
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("bookstr-torrents").appendingPathComponent(md5)
            try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let filename = zlib ? String(id) : md5 + ".pdf"
            if !arguments.contains("--ui-testing-torrent-pending") {
                try! data.write(to: directory.appendingPathComponent(filename))
            }
            var pieces = Data()
            for offset in stride(from: 0, to: data.count, by: 16384) {
                pieces.append(contentsOf: Insecure.SHA1.hash(data: data[offset..<min(offset + 16384, data.count)]))
            }
            let prefix = "d4:infod6:lengthi\(data.count)e4:name\(filename.utf8.count):\(filename)12:piece lengthi16384e6:pieces\(pieces.count):"
            try! (Data(prefix.utf8) + pieces + Data("ee".utf8)).write(to: directory.appendingPathComponent("book.torrent"))
            var record: [String: Any] = ["md5": md5, "id": id, "title": title, "authors": "Fixture Author", "collection": "fiction", "publisher": "Fixture Press", "year": "1865", "language": "en", "extension": "pdf", "filesize_bytes": data.count]
            if zlib {
                record["collection"] = "zlib"; record["id"] = 0
                record["torrent"] = ["filename": filename, "metadata_url": "https://annas-archive.gl/dyn/small_file/torrents/managed_by_aa/zlib/pilimi-zlib-0-119999.torrent"]
            }
            return record
        }
        var records = [record(original, title: "Torrent Reading Fixture", id: 1234)]
        if arguments.contains("--ui-testing-torrent-multiple") {
            records.append(record(original + Data("\n% Second edition\n".utf8), title: "Second Torrent Fixture", id: 2345))
        }
        // The private catalog is injected below. No fixture key is used for
        // signing, and the test disables relay connections.
        settings.authMode = .none; settings.pubkeyHex = nil; settings.relays = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [EmptyPublicSearch.self]
        return CatalogRepository(fileStore: fileStore, settings: settings, signerStore: signerStore, nip46Service: nip46,
            searchSession: URLSession(configuration: configuration), signerProvider: { TorrentFixtureSigner() }, catalogRequest: { request, _, _ in
                if request["type"] as? String == "libcat.search" { return ["books": records] }
                if arguments.contains("--ui-testing-torrent-offline") { throw URLError(.notConnectedToInternet) }
                let md5 = (request["book"] as? [String: Any])?["md5"] as? String
                return ["book": records.first { $0["md5"] as? String == md5 }!]
            })
    }
}
#endif
