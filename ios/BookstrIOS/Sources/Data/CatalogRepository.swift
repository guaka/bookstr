import Foundation
import CryptoKit
import PDFKit

/// The web app keeps descriptive book data independently from the favorite
/// locator. Do the same on iOS: Blossom decides whether a publication can be
/// opened, while this cache lets compact MD5 favorites retain their labels.
final class FavoriteMetadataRepository {
    private struct Entry: Codable {
        var bookstrId: String?
        var libvaultMd5: String?
        var isbn: String?
        var title: String
        var author: String?
        var year: String?
        var format: String?
        var updatedAt: Int64
    }

    // Compatibility with the earlier LibVault-backed cache on existing installs.
    private struct LegacyEntry: Codable {
        let book: CatalogBook
        let fetchedAt: Date
    }

    private let fileStore: JSONFileStore
    private var entries: [String: Entry]

    init(fileStore: JSONFileStore) {
        self.fileStore = fileStore
        let current = fileStore.load("favorite-metadata.json", as: [String: Entry].self, fallback: [:])
        if !current.isEmpty {
            entries = current
        } else {
            let legacy = fileStore.load("favorite-metadata.json", as: [String: LegacyEntry].self, fallback: [:])
            entries = legacy.reduce(into: [:]) { result, pair in
                let book = pair.value.book
                result[pair.key.lowercased()] = Entry(
                    bookstrId: book.id, libvaultMd5: book.libvaultMd5, isbn: book.isbn,
                    title: book.title, author: book.author, year: book.year,
                    format: book.format.rawValue,
                    updatedAt: Int64(pair.value.fetchedAt.timeIntervalSince1970 * 1000)
                )
            }
        }
    }

    func remember(book: CatalogBook, updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        remember(SharedFavoriteRef(
            bookstrId: book.id, libvaultMd5: book.libvaultMd5, isbn: book.isbn,
            url: book.sourceUrl ?? book.epubUrl, title: book.title, author: book.author,
            year: book.year, format: book.format.rawValue, blossomSha256: book.blossomSha256,
            blossomUrl: book.blossomSha256 == nil ? nil : book.epubUrl
        ), updatedAt: updatedAt)
    }

    func remember(_ ref: SharedFavoriteRef, updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        guard let title = useful(ref.title) else { return }
        let entry = Entry(
            bookstrId: ref.bookstrId, libvaultMd5: ref.libvaultMd5?.lowercased(), isbn: ref.isbn,
            title: title, author: useful(ref.author), year: useful(ref.year), format: useful(ref.format),
            updatedAt: updatedAt
        )
        let keys = identityKeys(ref)
        guard !keys.isEmpty else { return }
        for key in keys where entries[key]?.updatedAt ?? 0 <= updatedAt {
            entries[key] = entry
        }
        persist()
    }

    func rememberProgress(bookId: String, title: String?, author: String?, updatedAt: Int64) {
        let normalized = bookId.lowercased()
        remember(SharedFavoriteRef(
            bookstrId: bookId,
            libvaultMd5: Self.isMD5(normalized) ? normalized : nil,
            title: title,
            author: author
        ), updatedAt: updatedAt)
    }

    func enrich(_ refs: [SharedFavoriteRef]) -> [SharedFavoriteRef] {
        refs.map { ref in
            guard let cached = identityKeys(ref).compactMap({ entries[$0] }).max(by: { $0.updatedAt < $1.updatedAt }) else {
                return ref
            }
            var result = ref
            if useful(result.title) == nil { result.title = cached.title }
            if useful(result.author) == nil { result.author = cached.author }
            if useful(result.year) == nil { result.year = cached.year }
            if useful(result.format) == nil { result.format = cached.format }
            if result.isbn == nil { result.isbn = cached.isbn }
            if result.bookstrId == nil { result.bookstrId = cached.bookstrId }
            return result
        }
    }

    private func identityKeys(_ ref: SharedFavoriteRef) -> [String] {
        [
            ref.libvaultMd5.map { "md5:\($0.lowercased())" },
            ref.bookstrId.map { "id:\($0.lowercased())" },
            ref.isbn.map { "isbn:\($0)" }
        ].compactMap { $0 }
    }

    private func useful(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty,
              value.localizedCaseInsensitiveCompare("Book favorite") != .orderedSame else { return nil }
        return value
    }

    private func persist() {
        fileStore.save("favorite-metadata.json", value: entries)
    }

    private static func isMD5(_ value: String) -> Bool {
        value.count == 32 && value.allSatisfy(\.isHexDigit)
    }
}

final class CatalogRepository {
    static let booksAPIBase = "https://books-api.guaka.org/api"
    private static let downloadSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 180
        return URLSession(configuration: configuration)
    }()
    private let fileStore: JSONFileStore
    private let settings: SettingsRepository
    private let signerStore: SignerStore
    private let nip46Service: Nip46Service

    init(fileStore: JSONFileStore, settings: SettingsRepository, signerStore: SignerStore, nip46Service: Nip46Service) {
        self.fileStore = fileStore
        self.settings = settings
        self.signerStore = signerStore
        self.nip46Service = nip46Service
        fileStore.ensureBooksDirectory()
    }

    func downloadedBooks(externalFavorites: [ExternalFavorite] = []) -> [CatalogBook] {
        var byID = Dictionary(uniqueKeysWithValues: rememberedBooks().map { ($0.id.lowercased(), $0) })
        let favoritesBySHA = Dictionary(externalFavorites.compactMap { favorite -> (String, ExternalFavorite)? in
            guard let sha = favorite.blossomSha256?.lowercased(), sha.count == 64,
                  sha.allSatisfy(\.isHexDigit) else { return nil }
            return (sha, favorite)
        }, uniquingKeysWith: { first, _ in first })
        for file in fileStore.publicationFiles() {
            let ext = file.pathExtension.lowercased()
            guard ext == "epub" || ext == "pdf" else { continue }
            let id = file.deletingPathExtension().lastPathComponent.lowercased()
            guard id.count == 64, id.allSatisfy(\.isHexDigit) else { continue }
            if let remembered = byID[id], remembered.format.rawValue != ext {
                byID[id] = replacingFormat(of: remembered, with: ext == "pdf" ? .pdf : .epub)
            } else if byID[id] == nil, let favorite = favoritesBySHA[id] {
                byID[id] = CatalogBook(
                    id: id, title: favorite.title, author: favorite.author ?? "Unknown",
                    epubUrl: "https://\(Self.blossomHost)/\(id)", coverUrl: nil,
                    sourceUrl: favorite.blossomUrl, isbn: favorite.isbn,
                    libvaultMd5: favorite.libvaultMd5,
                    format: ext == "pdf" ? .pdf : .epub, blossomSha256: id, year: favorite.year
                )
            } else if byID[id] == nil {
                byID[id] = CatalogBook(
                    id: id, title: "Downloaded \(ext.uppercased())", author: "Unknown",
                    epubUrl: "https://\(Self.blossomHost)/\(id)", coverUrl: nil,
                    sourceUrl: nil, isbn: nil, libvaultMd5: nil,
                    format: ext == "pdf" ? .pdf : .epub, blossomSha256: id, year: nil
                )
            }
        }
        let downloaded = byID.values.filter {
            FileManager.default.fileExists(atPath: publicationFile(book: $0).path)
        }
        downloaded.forEach(rememberDownloaded)
        return downloaded.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    func rememberedBooks() -> [CatalogBook] {
        fileStore.load("downloaded-books.json", as: [CatalogBook].self, fallback: [])
    }

    private static func isMD5(_ value: String) -> Bool {
        value.count == 32 && value.allSatisfy(\.isHexDigit)
    }

    func search(_ query: String, limit: Int = 20) async throws -> [BookSearchResult] {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.count >= 2 else {
            throw NSError(domain: "CatalogRepository", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "Type at least 2 characters to search"])
        }
        guard var components = URLComponents(string: Self.booksAPIBase + "/search") else {
            throw URLError(.badURL)
        }
        components.queryItems = [URLQueryItem(name: "q", value: normalized),
                                 URLQueryItem(name: "limit", value: String(min(max(limit, 1), 50)))]
        guard let url = components.url else { throw URLError(.badURL) }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw NSError(domain: "CatalogRepository", code: 5,
                          userInfo: [NSLocalizedDescriptionKey: "Search failed"])
        }
        return Self.parseSearchResponse(data, limit: limit)
    }

    static func parseSearchResponse(_ data: Data, limit: Int = 20) -> [BookSearchResult] {
        guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
        let items = payload["books"] as? [[String: Any]] ?? payload["results"] as? [[String: Any]] ?? []
        return items.prefix(limit).compactMap { item in
            let source = string(item["source"])?.lowercased() ?? "all.books.party"
            guard let nativeID = string(item["id"]) ?? string(item["source_native_id"]), !nativeID.isEmpty else { return nil }
            let rawFormat = string(item["extension"]) ?? string(item["format"])
                ?? (source == "gutenberg" ? "epub" : nil)
            let explicitURL = string(item["readUrl"]) ?? string(item["url"]) ?? string(item["link"])
            let downloadURL = explicitURL ?? (source == "gutenberg" ? "\(booksAPIBase)/books/\(nativeID)/download" : nil)
            let format = rawFormat.map { BookFormat.from(format: $0, url: downloadURL ?? "") }
            let author = string(item["author"]) ?? string(item["authors"]) ?? "Unknown author"
            let issued = string(item["issued"])?.split(separator: "-").first.map(String.init)
            let cover = string(item["cover_id"]).map { "https://covers.openlibrary.org/b/id/\($0)-M.jpg" }
            return BookSearchResult(
                id: "\(source):\(nativeID)", source: source, title: string(item["title"]) ?? "Untitled",
                author: author, year: issued ?? string(item["year"]), publisher: string(item["publisher"]),
                language: string(item["language"]), format: format, downloadUrl: downloadURL, coverUrl: cover,
                rating: (item["avg_rating"] as? NSNumber)?.doubleValue ?? (item["rating"] as? NSNumber)?.doubleValue ?? 0,
                editionCount: (item["edition_count"] as? NSNumber)?.intValue ?? 0
            )
        }.sorted { $0.isReadable && !$1.isReadable }
    }

    private static func string(_ value: Any?) -> String? {
        if let value = value as? String, !value.isEmpty { return value }
        if let value = value as? NSNumber { return value.stringValue }
        return nil
    }

    func ensureDownloaded(book: CatalogBook) async throws -> URL {
        if let local = localPublication(for: book) {
            rememberDownloaded(local.book)
            return local.url
        }

        let target = fileStore.bookFileURL(bookId: book.id, format: book.format)
        if FileManager.default.fileExists(atPath: target.path), let actual = Self.detectedFormat(fileURL: target) {
            let corrected = replacingFormat(of: book, with: actual)
            if isValidCachedFile(book: corrected, fileURL: target, verifyBlossomHash: false) {
                let correctedTarget = fileStore.bookFileURL(bookId: corrected.id, format: actual)
                if correctedTarget != target {
                    if FileManager.default.fileExists(atPath: correctedTarget.path) { try? FileManager.default.removeItem(at: correctedTarget) }
                    try FileManager.default.moveItem(at: target, to: correctedTarget)
                }
                rememberDownloaded(corrected)
                return correctedTarget
            }
        }
        guard let remoteURL = URL(string: book.epubUrl) else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: remoteURL)
        let blossomHash = book.blossomSha256?.lowercased()
            ?? (remoteURL.host?.lowercased() == Self.blossomHost && book.id.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil
                ? book.id.lowercased() : nil)
        if let blossomHash {
            if settings.authMode == .nip46 {
                await nip46Service.restore(from: settings)
            }
            guard let signer = signerStore.signer(from: settings), let host = remoteURL.host else {
                throw NSError(domain: "CatalogRepository", code: 3,
                              userInfo: [NSLocalizedDescriptionKey: "Connect the approved Nostr identity to download this book"])
            }
            request.setValue(try await BlossomAuthorization.get(signer: signer, hash: blossomHash, server: host),
                             forHTTPHeaderField: "Authorization")
        }
        let (tempURL, response) = try await Self.downloadSession.download(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw NSError(domain: "CatalogRepository", code: status,
                          userInfo: [NSLocalizedDescriptionKey: "\(book.format.rawValue.uppercased()) download failed: HTTP \(status)"])
        }
        guard let actual = Self.detectedFormat(fileURL: tempURL) else {
            throw NSError(domain: "CatalogRepository", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "The downloaded file is neither a valid PDF nor EPUB"])
        }
        let corrected = replacingFormat(of: book, with: actual)
        guard isValidCachedFile(book: corrected, fileURL: tempURL, verifyBlossomHash: true) else {
            throw NSError(domain: "CatalogRepository", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Downloaded \(actual.rawValue.uppercased()) failed verification"])
        }
        let correctedTarget = fileStore.bookFileURL(bookId: corrected.id, format: actual)
        if FileManager.default.fileExists(atPath: correctedTarget.path) { try? FileManager.default.removeItem(at: correctedTarget) }
        try FileManager.default.moveItem(at: tempURL, to: correctedTarget)
        rememberDownloaded(corrected)
        return correctedTarget
    }

    func prepareForOpening(book: CatalogBook) async throws -> CatalogBook {
        if let local = localPublication(for: book) {
            rememberDownloaded(local.book)
            return local.book
        }

        let fileURL = try await ensureDownloaded(book: book)
        guard let actual = Self.detectedFormat(fileURL: fileURL) else {
            throw NSError(domain: "CatalogRepository", code: 10,
                          userInfo: [NSLocalizedDescriptionKey: "This publication is not a readable PDF or EPUB"])
        }
        let corrected = replacingFormat(of: book, with: actual)
        guard isValidCachedFile(book: corrected, fileURL: fileURL, verifyBlossomHash: false) else {
            throw NSError(domain: "CatalogRepository", code: 11,
                          userInfo: [NSLocalizedDescriptionKey: "This \(actual.rawValue.uppercased()) is damaged or unsupported"])
        }
        rememberDownloaded(corrected)
        return corrected
    }

    func publicationFile(book: CatalogBook) -> URL {
        fileStore.bookFileURL(bookId: book.id, format: book.format)
    }

    /// Favorites and reading progress have historically used either a LibVault
    /// MD5 or a Blossom SHA-256 as the book id. Resolve all of those aliases to
    /// the file that is already on disk before trying the network again.
    func localPublication(for book: CatalogBook) -> (book: CatalogBook, url: URL)? {
        for id in Self.publicationIdentityCandidates(for: book) {
            for format in [book.format, book.format == .epub ? .pdf : .epub] {
                let url = fileStore.bookFileURL(bookId: id, format: format)
                guard FileManager.default.fileExists(atPath: url.path),
                      let actual = Self.detectedFormat(fileURL: url),
                      Self.isStructurallyValidPublication(fileURL: url, format: actual)
                else { continue }

                return (replacingIdentity(of: book, with: id, format: actual), url)
            }
        }
        return nil
    }

    static func publicationIdentityCandidates(for book: CatalogBook) -> [String] {
        var seen = Set<String>()
        return [book.id, book.blossomSha256, book.libvaultMd5]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    static let blossomHost = "blossom.bfr.ee"

    static func fromExternalFavorite(_ favorite: ExternalFavorite) -> CatalogBook? {
        let sha256 = favorite.blossomSha256?.lowercased()
        let validSha256 = sha256?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            ? sha256 : nil
        let md5 = favorite.libvaultMd5?.lowercased()
            ?? (Self.isMD5(favorite.key.lowercased()) ? favorite.key.lowercased() : nil)
        if validSha256 == nil, md5 != nil {
            return nil
        }
        let explicitBlossomURL = favorite.blossomUrl.flatMap { value -> String? in
            guard let parsed = URL(string: value), parsed.scheme?.lowercased() == "https",
                  parsed.host?.lowercased() == blossomHost else { return nil }
            return parsed.absoluteString
        }
        // An old LibVault page/file locator is metadata, never an iOS download
        // fallback. A publication hash always resolves through Blossom on ip2.
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

    private func rememberDownloaded(_ book: CatalogBook) {
        var books = fileStore.load("downloaded-books.json", as: [CatalogBook].self, fallback: [])
        books.removeAll { $0.id == book.id }
        books.append(book)
        fileStore.save("downloaded-books.json", value: books)
    }

    private func replacingIdentity(of book: CatalogBook, with id: String, format: BookFormat) -> CatalogBook {
        CatalogBook(
            id: id, title: book.title, author: book.author, epubUrl: book.epubUrl,
            coverUrl: book.coverUrl, sourceUrl: book.sourceUrl, isbn: book.isbn,
            libvaultMd5: book.libvaultMd5, format: format,
            blossomSha256: book.blossomSha256, year: book.year
        )
    }

    private func isValidCachedFile(book: CatalogBook, fileURL: URL, verifyBlossomHash: Bool) -> Bool {
        guard Self.isStructurallyValidPublication(fileURL: fileURL, format: book.format) else { return false }
        if verifyBlossomHash, let expected = book.blossomSha256?.lowercased() {
            guard let digest = Self.sha256(fileURL: fileURL) else { return false }
            return digest == expected
        }
        return true
    }

    /// Hash downloads incrementally. Large publications must never be loaded into
    /// one giant Data value on the UI task just to verify their Blossom address.
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

    private func replacingFormat(of book: CatalogBook, with format: BookFormat) -> CatalogBook {
        guard book.format != format else { return book }
        return CatalogBook(
            id: book.id, title: book.title, author: book.author, epubUrl: book.epubUrl,
            coverUrl: book.coverUrl, sourceUrl: book.sourceUrl, isbn: book.isbn,
            libvaultMd5: book.libvaultMd5, format: format,
            blossomSha256: book.blossomSha256, year: book.year
        )
    }

}
