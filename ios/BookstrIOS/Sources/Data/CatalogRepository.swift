import Foundation
import CryptoKit

final class CatalogRepository {
    static let booksAPIBase = "https://books-api.guaka.org/api"
    static let libVaultBase = "https://lib.b.bfr.ee/api"

    private struct CachedFavoriteMetadata: Codable {
        let book: CatalogBook
        let fetchedAt: Date
    }

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

    func downloadedBooks() -> [CatalogBook] {
        rememberedBooks()
            .filter { FileManager.default.fileExists(atPath: publicationFile(book: $0).path) }
    }

    func rememberedBooks() -> [CatalogBook] {
        fileStore.load("downloaded-books.json", as: [CatalogBook].self, fallback: [])
    }

    /// Resolves compact Nostr favorites without adding descriptive metadata
    /// back to the shared event. Successful responses are retained on-device.
    func resolveLibVaultFavorites(_ favorites: [ExternalFavorite]) async -> [CatalogBook] {
        let md5s = Array(Set(favorites.compactMap { favorite -> String? in
            let candidate = favorite.libvaultMd5 ?? favorite.key
            let md5 = candidate.lowercased()
            guard Self.isMD5(md5) else { return nil }
            return md5
        })).sorted()
        guard !md5s.isEmpty else { return [] }

        var cache = fileStore.load(
            "favorite-metadata.json",
            as: [String: CachedFavoriteMetadata].self,
            fallback: [:]
        )
        let refreshBefore = Date().addingTimeInterval(-30 * 24 * 60 * 60)
        var resolved = Dictionary(uniqueKeysWithValues: md5s.compactMap { md5 in
            cache[md5].map { (md5, $0.book) }
        })
        let toRefresh = md5s.filter { md5 in
            guard let cached = cache[md5] else { return true }
            return cached.fetchedAt <= refreshBefore
        }

        // A large Nostr collection can contain hundreds of compact MD5 refs.
        // Keep pressure on both URLSession and LibVault bounded so one slow
        // wave does not make every title disappear together.
        for start in stride(from: 0, to: toRefresh.count, by: 6) {
            let batch = Array(toRefresh[start..<min(start + 6, toRefresh.count)])
            await withTaskGroup(of: CatalogBook?.self) { group in
                for md5 in batch {
                    group.addTask { await Self.fetchLibVaultMetadataWithRetry(md5: md5) }
                }
                for await book in group {
                    guard let book, let md5 = book.libvaultMd5 else { continue }
                    cache[md5] = CachedFavoriteMetadata(book: book, fetchedAt: Date())
                    resolved[md5] = book
                }
            }
            fileStore.save("favorite-metadata.json", value: cache)
        }
        return resolved.values.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    /// Performs a fresh, user-requested metadata lookup for one compact favorite.
    /// Unlike the bulk hydration pass, this deliberately bypasses the cache.
    func resolveLibVaultFavorite(_ favorite: ExternalFavorite) async -> CatalogBook? {
        let md5 = (favorite.libvaultMd5 ?? favorite.key).lowercased()
        guard Self.isMD5(md5), let book = await Self.fetchLibVaultMetadata(md5: md5) else { return nil }
        var cache = fileStore.load(
            "favorite-metadata.json",
            as: [String: CachedFavoriteMetadata].self,
            fallback: [:]
        )
        cache[md5] = CachedFavoriteMetadata(book: book, fetchedAt: Date())
        fileStore.save("favorite-metadata.json", value: cache)
        return book
    }

    private static func fetchLibVaultMetadata(md5: String) async -> CatalogBook? {
        guard let url = URL(string: "\(libVaultBase)/books/\(md5)") else { return nil }
        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = 12
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let metadata = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let responseMD5 = string(metadata["md5"]) else {
                return nil
            }
            let resolvedMD5 = responseMD5.lowercased()
            guard isMD5(resolvedMD5) else { return nil }
            let rawFormat = string(metadata["extension"]) ?? string(metadata["format"])
            let title = string(metadata["title"]) ?? "Book favorite"
            let authors = string(metadata["authors"]) ?? string(metadata["author"]) ?? "Unknown author"
            return CatalogBook(
                id: resolvedMD5,
                title: title,
                author: authors,
                epubUrl: "\(libVaultBase)/files/\(resolvedMD5)",
                coverUrl: "\(libVaultBase)/covers/\(resolvedMD5)",
                sourceUrl: "https://lib.b.bfr.ee/#book?md5=\(resolvedMD5)",
                isbn: string(metadata["isbn"]),
                libvaultMd5: resolvedMD5,
                format: BookFormat.from(format: rawFormat),
                blossomSha256: nil,
                year: string(metadata["year"])
            )
        } catch {
            return nil
        }
    }

    private static func fetchLibVaultMetadataWithRetry(md5: String) async -> CatalogBook? {
        if let book = await fetchLibVaultMetadata(md5: md5) { return book }
        try? await Task.sleep(for: .milliseconds(350))
        return await fetchLibVaultMetadata(md5: md5)
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
        let target = fileStore.bookFileURL(bookId: book.id, format: book.format)
        if FileManager.default.fileExists(atPath: target.path), isValidCachedFile(book: book, fileURL: target) {
            rememberDownloaded(book)
            return target
        }
        guard var remoteURL = URL(string: book.epubUrl) else {
            throw URLError(.badURL)
        }
        if let md5 = book.libvaultMd5?.lowercased(),
           Self.isMD5(md5), remoteURL.host?.lowercased() == "lib.b.bfr.ee" {
            remoteURL = try await prepareLibVaultDownload(md5: md5)
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
        let (tempURL, response) = try await URLSession.shared.download(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw NSError(domain: "CatalogRepository", code: status,
                          userInfo: [NSLocalizedDescriptionKey: "\(book.format.rawValue.uppercased()) download failed: HTTP \(status)"])
        }
        if FileManager.default.fileExists(atPath: target.path) {
            try? FileManager.default.removeItem(at: target)
        }
        try FileManager.default.moveItem(at: tempURL, to: target)
        guard isValidCachedFile(book: book, fileURL: target) else {
            try? FileManager.default.removeItem(at: target)
            throw NSError(domain: "CatalogRepository", code: 2, userInfo: [NSLocalizedDescriptionKey: "Downloaded file failed validation"])
        }
        rememberDownloaded(book)
        return target
    }

    func publicationFile(book: CatalogBook) -> URL {
        fileStore.bookFileURL(bookId: book.id, format: book.format)
    }

    static let blossomHost = "blossom.bfr.ee"

    static func fromExternalFavorite(_ favorite: ExternalFavorite) -> CatalogBook? {
        let sha256 = favorite.blossomSha256?.lowercased()
        let validSha256 = sha256?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            ? sha256 : nil
        let md5 = favorite.libvaultMd5?.lowercased()
            ?? (Self.isMD5(favorite.key.lowercased()) ? favorite.key.lowercased() : nil)
        let usefulTitle = !favorite.title.isEmpty
            && favorite.title.localizedCaseInsensitiveCompare("Book favorite") != .orderedSame
        let knownFormat = favorite.format?.lowercased()
        if validSha256 == nil, let md5, usefulTitle, knownFormat == "epub" || knownFormat == "pdf" {
            return CatalogBook(
                id: md5,
                title: favorite.title,
                author: favorite.author ?? "Unknown author",
                epubUrl: "\(libVaultBase)/files/\(md5)",
                coverUrl: "\(libVaultBase)/covers/\(md5)",
                sourceUrl: "https://lib.b.bfr.ee/#book?md5=\(md5)",
                isbn: favorite.isbn,
                libvaultMd5: md5,
                format: BookFormat.from(format: knownFormat),
                blossomSha256: nil,
                year: favorite.year
            )
        }
        if validSha256 == nil, md5 != nil {
            return nil
        }
        let urlString = favorite.blossomUrl
            ?? favorite.url
            ?? validSha256.map { "https://\(blossomHost)/\($0)" }
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
            sourceUrl: favorite.url,
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

    private func isValidCachedFile(book: CatalogBook, fileURL: URL) -> Bool {
        guard let data = try? Data(contentsOf: fileURL), !data.isEmpty else { return false }
        let prefix = data.prefix(5)
        switch book.format {
        case .pdf:
            return String(data: prefix, encoding: .ascii)?.hasPrefix("%PDF-") == true
        case .epub:
            let isZip = prefix.starts(with: [0x50, 0x4b])
            if !isZip { return false }
        }
        if book.id.count == 64 {
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            return digest == book.id.lowercased()
        }
        return true
    }

    private func prepareLibVaultDownload(md5: String) async throws -> URL {
        guard let fetchURL = URL(string: "\(Self.libVaultBase)/fetch/\(md5)") else {
            throw URLError(.badURL)
        }
        let (initialData, initialResponse) = try await URLSession.shared.data(from: fetchURL)
        guard let initialHTTP = initialResponse as? HTTPURLResponse,
              (200...299).contains(initialHTTP.statusCode),
              let initial = try? JSONSerialization.jsonObject(with: initialData) as? [String: Any] else {
            throw NSError(domain: "CatalogRepository", code: 6,
                          userInfo: [NSLocalizedDescriptionKey: "Could not start the book download from LibVault"])
        }
        if initial["status"] as? String == "ready" {
            return try libVaultFileURL(md5: md5)
        }
        guard let jobID = initial["job_id"] as? String, !jobID.isEmpty else {
            throw NSError(domain: "CatalogRepository", code: 7,
                          userInfo: [NSLocalizedDescriptionKey: "LibVault did not return a download job"])
        }

        for _ in 0..<180 {
            try await Task.sleep(for: .seconds(1))
            guard let jobURL = URL(string: "\(Self.libVaultBase)/jobs/\(jobID)") else {
                throw URLError(.badURL)
            }
            let (data, response) = try await URLSession.shared.data(from: jobURL)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let job = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                continue
            }
            switch job["status"] as? String {
            case "ready":
                return try libVaultFileURL(md5: md5)
            case "failed":
                let detail = job["error"] as? String
                throw NSError(domain: "CatalogRepository", code: 8,
                              userInfo: [NSLocalizedDescriptionKey: detail ?? "LibVault could not fetch this book"])
            default:
                continue
            }
        }
        throw NSError(domain: "CatalogRepository", code: 9,
                      userInfo: [NSLocalizedDescriptionKey: "LibVault is still fetching this book. Please try again shortly."])
    }

    private func libVaultFileURL(md5: String) throws -> URL {
        guard let url = URL(string: "\(Self.libVaultBase)/files/\(md5)") else {
            throw URLError(.badURL)
        }
        return url
    }
}
