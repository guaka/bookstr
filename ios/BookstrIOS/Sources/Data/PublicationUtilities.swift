import CryptoKit
import Foundation
#if canImport(LibArchive)
import LibArchive
#endif
#if canImport(zlib)
import zlib
#endif
import PDFKit

enum PublicationUtilities {
    static let blossomHost = "blossom.bfr.ee"
    static let maxFB2Bytes: Int64 = 50 * 1024 * 1024
    static let maxComicEntries = 2_000
    static let maxComicPageBytes: UInt32 = 30 * 1024 * 1024
    static let maxComicMetadataBytes = 1 * 1024 * 1024

    struct ComicMetadata: Equatable {
        let language: String?
    }

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
            year: favorite.year,
            rightsStatus: favorite.rightsStatus,
            license: favorite.license,
            licenseUrl: favorite.licenseUrl,
            rightsSource: favorite.rightsSource
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
        let prefix = try? handle.read(upToCount: 8)
        guard let prefix else { return nil }
        if String(data: prefix, encoding: .ascii)?.hasPrefix("%PDF-") == true { return .pdf }
        if isRARSignature(prefix) { return .cbr }
        if prefix.starts(with: [0x50, 0x4b]) {
            if isSafeFB2Zip(fileURL: fileURL) { return .fb2 }
            if fileContains(fileURL, needle: Data("META-INF/container.xml".utf8)) { return .epub }
            if zipContainsComicImage(fileURL: fileURL) { return .cbz }
            // Preserve the historical detection contract: an unknown ZIP is
            // provisionally EPUB, then structural validation rejects it.
            return .epub
        }
        if String(data: prefix, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("<") == true { return .fb2 }
        return nil
    }

    static func isStructurallyValidPublication(fileURL: URL, format: BookFormat) -> Bool {
        switch format {
        case .pdf:
            return detectedFormat(fileURL: fileURL) == .pdf && (PDFDocument(url: fileURL)?.pageCount ?? 0) > 0
        case .epub:
            return detectedFormat(fileURL: fileURL) == .epub
                && fileContains(fileURL, needle: Data("META-INF/container.xml".utf8))
        case .fb2:
            return validateFB2(fileURL: fileURL)
        case .cbr:
            return detectedFormat(fileURL: fileURL) == .cbr
        case .cbz:
            return detectedFormat(fileURL: fileURL) == .cbz
        }
    }

    private static func isRARSignature(_ prefix: Data) -> Bool {
        prefix.starts(with: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
            || prefix.starts(with: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
    }

    /// Validate CBZ from its central directory so arbitrary ZIP downloads are
    /// not mislabeled as EPUBs or comics. Page payloads stay mapped on disk.
    private static func zipContainsComicImage(fileURL: URL) -> Bool {
        guard let data = try? Data(contentsOf: fileURL, options: [.mappedIfSafe]), data.count >= 22 else { return false }
        let searchStart = max(data.startIndex, data.endIndex - 65_557)
        var cursor = data.endIndex - 22
        var endRecord: Data.Index?
        while cursor >= searchStart {
            if cursor + 3 < data.endIndex, readUInt32(data, cursor) == 0x06054b50 {
                endRecord = cursor
                break
            }
            if cursor == data.startIndex { break }
            cursor -= 1
        }
        guard let endRecord,
              endRecord + 22 <= data.endIndex,
              readUInt16(data, endRecord + 4) == 0,
              readUInt16(data, endRecord + 6) == 0 else { return false }
        let entryCount = Int(readUInt16(data, endRecord + 10))
        let directorySize = Int(readUInt32(data, endRecord + 12))
        let directoryOffset = Int(readUInt32(data, endRecord + 16))
        guard entryCount > 0, entryCount <= maxComicEntries,
              directoryOffset >= 0, directorySize >= 46,
              directoryOffset + directorySize <= data.count else { return false }

        var entry = data.startIndex + directoryOffset
        let directoryEnd = entry + directorySize
        var readableImages = 0
        for _ in 0..<entryCount {
            guard entry + 46 <= directoryEnd, readUInt32(data, entry) == 0x02014b50 else { return false }
            let flags = readUInt16(data, entry + 8)
            let uncompressedSize = readUInt32(data, entry + 24)
            let nameLength = Int(readUInt16(data, entry + 28))
            let extraLength = Int(readUInt16(data, entry + 30))
            let commentLength = Int(readUInt16(data, entry + 32))
            let next = entry + 46 + nameLength + extraLength + commentLength
            guard nameLength > 0, next <= directoryEnd,
                  let name = String(data: data[(entry + 46)..<(entry + 46 + nameLength)], encoding: .utf8)
            else { return false }
            let normalized = name.replacingOccurrences(of: "\\", with: "/")
            let components = normalized.split(separator: "/", omittingEmptySubsequences: false)
            guard !normalized.hasPrefix("/"), !components.contains(".."), !components.contains("") else { return false }
            if flags & 0x0001 == 0,
               uncompressedSize > 0, uncompressedSize <= maxComicPageBytes,
               isComicImageName(normalized) {
                readableImages += 1
            }
            entry = next
        }
        return entry == directoryEnd && readableImages > 0
    }

    private static func isComicImageName(_ name: String) -> Bool {
        let lower = name.lowercased()
        guard !lower.contains("/__macosx/"), !lower.hasPrefix("__macosx/") else { return false }
        return [".jpg", ".jpeg", ".png", ".gif", ".webp"].contains { lower.hasSuffix($0) }
    }

    static func comicMetadata(fileURL: URL, format: BookFormat) -> ComicMetadata? {
        let data: Data?
        switch format {
        case .cbz: data = zipComicInfoData(fileURL: fileURL)
        case .cbr: data = rarComicInfoData(fileURL: fileURL)
        default: return nil
        }
        guard let data, let language = parseComicInfoLanguage(data) else { return nil }
        return ComicMetadata(language: language)
    }

    private final class ComicInfoParser: NSObject, XMLParserDelegate {
        var language: String?
        private var value = ""
        private var invalid = false

        func parser(_ parser: XMLParser, didStartElement elementName: String,
                    namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
            value = ""
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) { value += string }

        func parser(_ parser: XMLParser, didEndElement elementName: String,
                    namespaceURI: String?, qualifiedName qName: String?) {
            let name = (qName ?? elementName).split(separator: ":").last.map(String.init)?.lowercased()
                ?? elementName.lowercased()
            if name == "languageiso", language == nil {
                let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
                    .replacingOccurrences(of: "_", with: "-").lowercased()
                if candidate.range(of: #"^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$"#, options: .regularExpression) != nil {
                    language = candidate
                }
            }
            value = ""
        }

        func parser(_ parser: XMLParser, foundSkippedEntity name: String) {
            invalid = true
            parser.abortParsing()
        }

        var isValid: Bool { !invalid && language != nil }
    }

    private static func parseComicInfoLanguage(_ data: Data) -> String? {
        guard !data.isEmpty, data.count <= maxComicMetadataBytes else { return nil }
        let source = String(decoding: data, as: UTF8.self)
        guard source.range(of: "<!DOCTYPE", options: .caseInsensitive) == nil,
              source.range(of: "<!ENTITY", options: .caseInsensitive) == nil else { return nil }
        let delegate = ComicInfoParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldProcessNamespaces = true
        parser.shouldResolveExternalEntities = false
        guard parser.parse(), delegate.isValid else { return nil }
        return delegate.language
    }

    private static func zipComicInfoData(fileURL: URL) -> Data? {
        guard let data = try? Data(contentsOf: fileURL, options: [.mappedIfSafe]), data.count >= 22 else { return nil }
        let searchStart = max(data.startIndex, data.endIndex - 65_557)
        var cursor = data.endIndex - 22
        var endRecord: Data.Index?
        while cursor >= searchStart {
            if cursor + 3 < data.endIndex, readUInt32(data, cursor) == 0x06054b50 {
                endRecord = cursor
                break
            }
            if cursor == data.startIndex { break }
            cursor -= 1
        }
        guard let endRecord,
              readUInt16(data, endRecord + 4) == 0,
              readUInt16(data, endRecord + 6) == 0 else { return nil }
        let entryCount = Int(readUInt16(data, endRecord + 10))
        let directorySize = Int(readUInt32(data, endRecord + 12))
        let directoryOffset = Int(readUInt32(data, endRecord + 16))
        guard entryCount > 0, entryCount <= maxComicEntries,
              directorySize >= 46, directoryOffset >= 0,
              directoryOffset + directorySize <= data.count else { return nil }

        var entry = data.startIndex + directoryOffset
        let directoryEnd = entry + directorySize
        for _ in 0..<entryCount {
            guard entry + 46 <= directoryEnd, readUInt32(data, entry) == 0x02014b50 else { return nil }
            let flags = readUInt16(data, entry + 8)
            let method = readUInt16(data, entry + 10)
            let compressedSize = Int(readUInt32(data, entry + 20))
            let uncompressedSize = Int(readUInt32(data, entry + 24))
            let nameLength = Int(readUInt16(data, entry + 28))
            let extraLength = Int(readUInt16(data, entry + 30))
            let commentLength = Int(readUInt16(data, entry + 32))
            let localOffset = Int(readUInt32(data, entry + 42))
            let nameStart = entry + 46
            let next = nameStart + nameLength + extraLength + commentLength
            guard nameLength > 0, next <= directoryEnd,
                  let name = String(data: data[nameStart..<(nameStart + nameLength)], encoding: .utf8)
            else { return nil }
            entry = next

            let normalized = name.replacingOccurrences(of: "\\", with: "/")
            guard normalized.split(separator: "/").last?.lowercased() == "comicinfo.xml" else { continue }
            guard flags & 0x0001 == 0, method == 0 || method == 8,
                  compressedSize > 0, compressedSize <= maxComicMetadataBytes,
                  uncompressedSize > 0, uncompressedSize <= maxComicMetadataBytes,
                  localOffset >= 0, localOffset + 30 <= data.count,
                  readUInt32(data, data.startIndex + localOffset) == 0x04034b50 else { return nil }
            let localNameLength = Int(readUInt16(data, data.startIndex + localOffset + 26))
            let localExtraLength = Int(readUInt16(data, data.startIndex + localOffset + 28))
            let payload = data.startIndex + localOffset + 30 + localNameLength + localExtraLength
            guard payload + compressedSize <= data.endIndex else { return nil }
            let compressed = Data(data[payload..<(payload + compressedSize)])
            if method == 0 { return compressedSize == uncompressedSize ? compressed : nil }
            return inflateRawDeflate(compressed, expectedSize: uncompressedSize)
        }
        return nil
    }

    private static func rarComicInfoData(fileURL: URL) -> Data? {
        #if canImport(LibArchive)
        var result = Data()
        do {
            try ArchiveReader().readDataBlocks(
                in: fileURL,
                selecting: { entry in
                    guard entry.fileType == .regular,
                          !entry.isDataEncrypted, !entry.isMetadataEncrypted,
                          entry.size > 0, entry.size <= Int64(maxComicMetadataBytes),
                          URL(fileURLWithPath: entry.path).lastPathComponent.lowercased() == "comicinfo.xml"
                    else { return .skip }
                    return .read
                }
            ) { _, block in
                guard result.count + block.data.count <= maxComicMetadataBytes else { return .finishEntry }
                result.append(block.data)
                return .continueReading
            }
            return result.isEmpty ? nil : result
        } catch {
            return nil
        }
        #else
        return nil
        #endif
    }

    /// Returns descriptive metadata from a local FB2 file without inserting
    /// source XML into a view. XMLParser is non-validating and external entity
    /// resolution is explicitly disabled.
    static func fb2Metadata(fileURL: URL) -> (title: String?, author: String?, year: String?)? {
        guard let data = fb2Data(fileURL: fileURL), Int64(data.count) <= maxFB2Bytes,
              let parsed = parseFB2(data: data) else { return nil }
        return (parsed.title, parsed.author, parsed.year)
    }

    private static func validateFB2(fileURL: URL) -> Bool {
        guard let data = fb2Data(fileURL: fileURL), !data.isEmpty,
              Int64(data.count) <= maxFB2Bytes else { return false }
        return parseFB2(data: data) != nil
    }

    private final class FB2MetadataParser: NSObject, XMLParserDelegate {
        var title: String?
        var firstName: String?
        var lastName: String?
        var nickname: String?
        var year: String?
        private var path: [String] = []
        private var value = ""
        private var invalid = false
        private var rootSeen = false
        private var sectionCount = 0

        var author: String? {
            if let nickname, !nickname.isEmpty { return nickname }
            let result = [firstName, lastName].compactMap { $0 }.joined(separator: " ")
            return result.isEmpty ? nil : result
        }

        func parser(_ parser: XMLParser, didStartElement elementName: String,
                    namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
            let name = (qName ?? elementName).split(separator: ":").last.map(String.init)?.lowercased() ?? elementName.lowercased()
            path.append(name)
            value = ""
            if path.count == 1 {
                rootSeen = true
                if name != "fictionbook" { invalid = true }
            } else if name == "fictionbook" {
                invalid = true
            }
            if name == "section" { sectionCount += 1 }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) { value += string }

        func parser(_ parser: XMLParser, didEndElement elementName: String,
                    namespaceURI: String?, qualifiedName qName: String?) {
            let name = (qName ?? elementName).split(separator: ":").last.map(String.init)?.lowercased() ?? elementName.lowercased()
            let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
            switch name {
            case "book-title": if title == nil, !text.isEmpty { title = text }
            case "first-name": if firstName == nil, !text.isEmpty { firstName = text }
            case "last-name": if lastName == nil, !text.isEmpty { lastName = text }
            case "nickname": if nickname == nil, !text.isEmpty { nickname = text }
            case "date": if year == nil { year = text.range(of: #"\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b"#, options: .regularExpression).map { String(text[$0]) } }
            default: break
            }
            _ = path.popLast()
            value = ""
        }

        func parser(_ parser: XMLParser, foundSkippedEntity name: String) { invalid = true; parser.abortParsing() }

        var isValid: Bool { rootSeen && !invalid && title != nil && sectionCount > 0 }
    }

    private static func parseFB2(data: Data) -> (title: String?, author: String?, year: String?)? {
        let source = String(decoding: data, as: UTF8.self)
        guard !data.isEmpty, source.range(of: "<!DOCTYPE", options: .caseInsensitive) == nil,
              source.range(of: "<!ENTITY", options: .caseInsensitive) == nil else { return nil }
        let delegate = FB2MetadataParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldProcessNamespaces = true
        parser.shouldResolveExternalEntities = false
        guard parser.parse(), delegate.isValid else { return nil }
        return (delegate.title, delegate.author, delegate.year)
    }

    /// Returns native FB2 XML or the sole validated entry from a safe FB2 ZIP.
    /// The cache retains the original download; readers consume this extracted view.
    static func fb2Data(fileURL: URL) -> Data? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let size = attributes[.size] as? NSNumber, size.int64Value > 0,
              size.int64Value <= maxFB2Bytes else { return nil }
        guard let data = try? Data(contentsOf: fileURL, options: [.mappedIfSafe]), !data.isEmpty else { return nil }
        if data.starts(with: [0x50, 0x4b]) { return extractFB2Zip(data) }
        return data
    }

    // iOS has no Foundation ZIP API. Parse the central directory defensively
    // and support a single stored or raw-deflate FB2 entry. All archive
    // metadata is bounded before allocating or inflating any payload.
    private static func extractFB2Zip(_ data: Data) -> Data? {
        guard data.count >= 22 else { return nil }
        let end = data.endIndex - 4
        let lower = max(data.startIndex, end - 65_557)
        var eocd: Data.Index?
        var cursor = end
        while cursor >= lower {
            if data[cursor] == 0x50, cursor + 3 < data.endIndex,
               data[cursor + 1] == 0x4b, data[cursor + 2] == 0x05, data[cursor + 3] == 0x06 { eocd = cursor; break }
            if cursor == data.startIndex { break }
            cursor -= 1
        }
        guard let endRecord = eocd,
              readUInt16(data, endRecord + 4) == 0,
              readUInt16(data, endRecord + 6) == 0,
              readUInt16(data, endRecord + 8) == 1,
              readUInt16(data, endRecord + 10) == 1,
              endRecord + 22 + Int(readUInt16(data, endRecord + 20)) == data.endIndex else { return nil }
        let directorySize = Int(readUInt32(data, endRecord + 12))
        let directoryOffset = Int(readUInt32(data, endRecord + 16))
        guard directoryOffset >= 0, directorySize >= 46, directoryOffset + directorySize <= data.count,
              readUInt32(data, data.startIndex + directoryOffset) == 0x02014b50 else { return nil }
        let nameLength = Int(readUInt16(data, data.startIndex + directoryOffset + 28))
        let extraLength = Int(readUInt16(data, data.startIndex + directoryOffset + 30))
        let commentLength = Int(readUInt16(data, data.startIndex + directoryOffset + 32))
        let entry = data.startIndex + directoryOffset
        let nameStart = entry + 46
        guard nameLength > 0, nameStart + nameLength + extraLength + commentLength <= data.endIndex,
              let name = String(data: data[nameStart..<(nameStart + nameLength)], encoding: .utf8) else { return nil }
        let normalized = name.replacingOccurrences(of: "\\", with: "/")
        guard !normalized.hasPrefix("/"), !normalized.split(separator: "/").contains(".."),
              !normalized.split(separator: "/").contains(""), normalized.lowercased().hasSuffix(".fb2") else { return nil }
        let flags = readUInt16(data, entry + 8)
        let method = readUInt16(data, entry + 10)
        guard method == 0 || method == 8 else { return nil }
        guard flags & 0x0001 == 0 else { return nil }
        let compressedSize = Int(readUInt32(data, entry + 20))
        let uncompressedSize = Int(readUInt32(data, entry + 24))
        let localOffset = Int(readUInt32(data, entry + 42))
        guard compressedSize > 0, uncompressedSize > 0,
              Int64(compressedSize) <= maxFB2Bytes, Int64(uncompressedSize) <= maxFB2Bytes, localOffset >= 0,
              localOffset + 30 <= data.count, readUInt32(data, data.startIndex + localOffset) == 0x04034b50 else { return nil }
        guard readUInt16(data, data.startIndex + localOffset + 6) == flags,
              readUInt16(data, data.startIndex + localOffset + 8) == method else { return nil }
        let localNameLength = Int(readUInt16(data, data.startIndex + localOffset + 26))
        let localExtraLength = Int(readUInt16(data, data.startIndex + localOffset + 28))
        let payload = data.startIndex + localOffset + 30 + localNameLength + localExtraLength
        guard payload + compressedSize <= data.endIndex else { return nil }
        let compressed = Data(data[payload..<(payload + compressedSize)])
        if method == 0 {
            guard compressedSize == uncompressedSize else { return nil }
            return compressed
        }
        return inflateRawDeflate(compressed, expectedSize: uncompressedSize)
    }

    private static func isSafeFB2Zip(fileURL: URL) -> Bool {
        guard let data = try? Data(contentsOf: fileURL, options: [.mappedIfSafe]), Int64(data.count) <= maxFB2Bytes else { return false }
        return extractFB2Zip(data) != nil
    }

    private static func inflateRawDeflate(_ compressed: Data, expectedSize: Int) -> Data? {
        #if canImport(zlib)
        guard !compressed.isEmpty, expectedSize > 0, expectedSize <= maxFB2Bytes else { return nil }
        var stream = z_stream()
        guard inflateInit2_(&stream, -15, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { return nil }
        defer { inflateEnd(&stream) }
        var output = Data(count: expectedSize)
        var inflated = false
        compressed.withUnsafeBytes { inputBuffer in
            output.withUnsafeMutableBytes { outputBuffer in
                guard let inputAddress = inputBuffer.bindMemory(to: Bytef.self).baseAddress,
                      let outputAddress = outputBuffer.bindMemory(to: Bytef.self).baseAddress else { return }
                stream.next_in = UnsafeMutablePointer(mutating: inputAddress)
                stream.avail_in = uInt(compressed.count)
                stream.next_out = outputAddress
                stream.avail_out = uInt(expectedSize)
                inflated = inflate(&stream, Z_FINISH) == Z_STREAM_END &&
                    stream.total_out == uLong(expectedSize) && stream.avail_in == 0
            }
        }
        return inflated ? output : nil
        #else
        return nil
        #endif
    }

    private static func readUInt16(_ data: Data, _ index: Data.Index) -> UInt16 {
        UInt16(data[index]) | UInt16(data[index + 1]) << 8
    }

    private static func readUInt32(_ data: Data, _ index: Data.Index) -> UInt32 {
        UInt32(data[index]) | UInt32(data[index + 1]) << 8 | UInt32(data[index + 2]) << 16 | UInt32(data[index + 3]) << 24
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
