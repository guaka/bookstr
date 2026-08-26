import CryptoKit
import Foundation
import PDFKit

enum PublicationUtilities {
    static let blossomHost = "blossom.bfr.ee"

    static func publicationIdentityCandidates(for book: CatalogBook) -> [String] {
        var seen = Set<String>()
        return [book.id, book.blossomSha256, book.libvaultMd5]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    static func fromExternalFavorite(_ favorite: ExternalFavorite) -> CatalogBook? {
        let sha256 = favorite.blossomSha256?.lowercased()
        let validSha256 = sha256?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            ? sha256 : nil
        let md5 = favorite.libvaultMd5?.lowercased()
            ?? (isMD5(favorite.key.lowercased()) ? favorite.key.lowercased() : nil)
        if validSha256 == nil, md5 != nil {
            return nil
        }
        let explicitBlossomURL = favorite.blossomUrl.flatMap { value -> String? in
            guard let parsed = URL(string: value), parsed.scheme?.lowercased() == "https",
                  parsed.host?.lowercased() == blossomHost else { return nil }
            return parsed.absoluteString
        }
        let urlString = validSha256.map { explicitBlossomURL ?? "https://\(blossomHost)/\($0)" }
            ?? favorite.url
        guard let urlString,
              let parsed = URL(string: urlString),
              ["http", "https"].contains(parsed.scheme?.lowercased() ?? "") else {
            return nil
        }
        return CatalogBook(
            id: validSha256 ?? favorite.key,
            title: favorite.title,
            author: favorite.author ?? "Unknown",
            epubUrl: parsed.absoluteString,
            coverUrl: nil,
            sourceUrl: validSha256 == nil ? favorite.url : urlString,
            isbn: favorite.isbn,
            libvaultMd5: favorite.libvaultMd5,
            format: BookFormat.from(format: favorite.format, url: parsed.absoluteString),
            blossomSha256: validSha256,
            year: favorite.year
        )
    }

    static func fromBlossomFavorite(_ favorite: ExternalFavorite) -> CatalogBook? {
        guard favorite.blossomSha256 != nil else { return nil }
        return fromExternalFavorite(favorite)
    }

    static func sha256(fileURL: URL, chunkSize: Int = 1_048_576) -> String? {
        guard chunkSize > 0, let handle = try? FileHandle(forReadingFrom: fileURL) else { return nil }
        defer { try? handle.close() }
        var hasher = SHA256()
        do {
            while let data = try handle.read(upToCount: chunkSize), !data.isEmpty {
                hasher.update(data: data)
            }
            return hasher.finalize().map { String(format: "%02x", $0) }.joined()
        } catch {
            return nil
        }
    }

    static func detectedFormat(fileURL: URL) -> BookFormat? {
        guard let handle = try? FileHandle(forReadingFrom: fileURL) else { return nil }
        defer { try? handle.close() }
        let prefix = try? handle.read(upToCount: 5)
        guard let prefix else { return nil }
        if String(data: prefix, encoding: .ascii)?.hasPrefix("%PDF-") == true { return .pdf }
        if prefix.starts(with: [0x50, 0x4b]) { return .epub }
        return nil
    }

    static func isStructurallyValidPublication(fileURL: URL, format: BookFormat) -> Bool {
        switch format {
        case .pdf:
            return detectedFormat(fileURL: fileURL) == .pdf && (PDFDocument(url: fileURL)?.pageCount ?? 0) > 0
        case .epub:
            return detectedFormat(fileURL: fileURL) == .epub
                && fileContains(fileURL, needle: Data("META-INF/container.xml".utf8))
        }
    }

    private static func fileContains(_ url: URL, needle: Data, chunkSize: Int = 64 * 1024) -> Bool {
        guard !needle.isEmpty, let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        var carry = Data()
        do {
            while let chunk = try handle.read(upToCount: chunkSize), !chunk.isEmpty {
                var window = carry
                window.append(chunk)
                if window.range(of: needle) != nil { return true }
                carry = Data(window.suffix(max(needle.count - 1, 0)))
            }
        } catch {
            return false
        }
        return false
    }

    private static func isMD5(_ value: String) -> Bool {
        value.count == 32 && value.allSatisfy(\.isHexDigit)
    }
}
