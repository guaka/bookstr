import XCTest
import PDFKit
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class LocalBookImportTests: XCTestCase {
    func testDocumentRegistrationSurvivesProjectGeneration() throws {
        let ios = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: ios.appendingPathComponent("BookstrIOS/Info.plist"))
        let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        let types = try XCTUnwrap(plist["CFBundleDocumentTypes"] as? [[String: Any]])
        XCTAssertEqual(types.compactMap { ($0["LSItemContentTypes"] as? [String])?.first }, ["org.idpf.epub-container", "com.adobe.pdf"])
        XCTAssertTrue(types.allSatisfy { $0["CFBundleTypeRole"] as? String == "Viewer" })
        let project = try String(contentsOf: ios.appendingPathComponent("project.yml"))
        for type in ["org.idpf.epub-container", "com.adobe.pdf"] { XCTAssertTrue(project.contains(type)) }
    }
    func testSavedArraysSkipUnknownFormatsWithoutLosingSupportedEntries() {
        let store = JSONFileStore(subdirectory: "BookstrImportTests/\(UUID().uuidString)")
        XCTAssertEqual(store.loadArray("missing.json", as: BookFormat.self), [])
        store.save("formats.json", value: ["pdf", "mobi", "epub", "cbz", "cbr"])
        XCTAssertEqual(store.loadArray("formats.json", as: BookFormat.self), [.pdf, .epub, .cbz, .cbr])
        store.save("formats.json", value: ["format": "pdf"])
        XCTAssertEqual(store.loadArray("formats.json", as: BookFormat.self), [])
    }

    func testCopiesDocumentsAndReusesContentIdentity() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = JSONFileStore(subdirectory: "BookstrImportTests/\(UUID().uuidString)")
        let pdf = directory.appendingPathComponent("Example.PDF")
        let document = PDFDocument()
        document.insert(PDFPage(), at: 0)
        XCTAssertTrue(document.write(to: pdf))
        let first = try LocalBookImport.copy(pdf, to: store)
        defer { try? FileManager.default.removeItem(at: store.bookFileURL(bookId: first.id, format: .pdf)) }
        XCTAssertEqual(first.title, "Example")
        XCTAssertEqual(first.format, .pdf)
        XCTAssertEqual(first.id.count, 32)
        XCTAssertEqual(try LocalBookImport.copy(pdf, to: store).id, first.id)
        XCTAssertEqual(try Data(contentsOf: pdf), try Data(contentsOf: store.bookFileURL(bookId: first.id, format: .pdf)))
        let epub = directory.appendingPathComponent("Example.epub")
        // Exercise the existing bounded structural gate with its minimum accepted EPUB signature.
        try Data("PK\u{03}\u{04}META-INF/container.xml".utf8).write(to: epub)
        let book = try LocalBookImport.copy(epub, to: store)
        defer { try? FileManager.default.removeItem(at: store.bookFileURL(bookId: book.id, format: .epub)) }
        XCTAssertEqual(book.format, .epub)
        XCTAssertNotEqual(book.id, first.id)
    }

    func testRejectsUnsupportedMissingAndCorruptFiles() throws {
        let store = JSONFileStore(subdirectory: "BookstrImportTests/\(UUID().uuidString)")
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: file) }
        XCTAssertThrowsError(try LocalBookImport.copy(file, to: store))
        try Data("not a PDF".utf8).write(to: file)
        XCTAssertThrowsError(try LocalBookImport.copy(file, to: store))
        XCTAssertThrowsError(try LocalBookImport.copy(file.appendingPathExtension("txt"), to: store))
        XCTAssertThrowsError(try LocalBookImport.copy(URL(string: "https://example.org/book.pdf")!, to: store))
    }
}
