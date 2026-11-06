import Foundation
import CryptoKit

enum LocalBookImport {
    static func copy(_ source: URL, to store: JSONFileStore) throws -> CatalogBook {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        guard source.isFileURL,
              let format = BookFormat(rawValue: source.pathExtension.lowercased()),
              [.epub, .pdf].contains(format) else { throw CocoaError(.fileReadUnsupportedScheme) }
        let staging = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: staging) }
        try FileManager.default.copyItem(at: source, to: staging)
        guard PublicationUtilities.isStructurallyValidPublication(fileURL: staging, format: format) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let handle = try FileHandle(forReadingFrom: staging)
        defer { try? handle.close() }
        var hash = Insecure.MD5()
        while let bytes = try handle.read(upToCount: 1024 * 1024), !bytes.isEmpty { hash.update(data: bytes) }
        let id = hash.finalize().map { String(format: "%02x", $0) }.joined()
        store.ensureBooksDirectory()
        let target = store.bookFileURL(bookId: id, format: format)
        if !FileManager.default.fileExists(atPath: target.path) {
            try FileManager.default.moveItem(at: staging, to: target)
        }
        return CatalogBook(id: id, title: source.deletingPathExtension().lastPathComponent,
                           author: "", epubUrl: target.absoluteString, coverUrl: nil,
                           sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: format, year: nil)
    }
}
