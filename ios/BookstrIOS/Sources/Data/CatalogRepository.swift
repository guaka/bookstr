import Foundation

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
        var rightsStatus: String?
        var license: String?
        var licenseUrl: String?
        var rightsSource: String?
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
                    rightsStatus: book.rightsStatus, license: book.license,
                    licenseUrl: book.licenseUrl, rightsSource: book.rightsSource,
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
            blossomUrl: book.blossomSha256 == nil ? nil : book.epubUrl,
            rightsStatus: book.rightsStatus, license: book.license,
            licenseUrl: book.licenseUrl, rightsSource: book.rightsSource
        ), updatedAt: updatedAt)
    }

    func remember(_ ref: SharedFavoriteRef, updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        guard let title = useful(ref.title) else { return }
        let entry = Entry(
            bookstrId: ref.bookstrId, libvaultMd5: ref.libvaultMd5?.lowercased(), isbn: ref.isbn,
            title: title, author: useful(ref.author), year: useful(ref.year), format: useful(ref.format),
            rightsStatus: ref.rightsStatus, license: ref.license,
            licenseUrl: ref.licenseUrl, rightsSource: ref.rightsSource,
            updatedAt: updatedAt
        )
        let keys = identityKeys(ref)
        guard !keys.isEmpty else { return }
        for key in keys where entries[key]?.updatedAt ?? 0 <= updatedAt {
            entries[key] = entry
        }
        persist()
    }

    func rememberProgress(bookId: String, title: String?, author: String?, updatedAt: Int64,
                          rights: BookRights = BookRights()) {
        let normalized = bookId.lowercased()
        remember(SharedFavoriteRef(
            bookstrId: bookId,
            libvaultMd5: Self.isMD5(normalized) ? normalized : nil,
            title: title,
            author: author,
            rightsStatus: rights.status.rawValue, license: rights.license,
            licenseUrl: rights.licenseURL, rightsSource: rights.source
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
            let rights = BookRights.preferred(
                current: BookRights.normalize(status: result.rightsStatus, license: result.license,
                                              licenseURL: result.licenseUrl, source: result.rightsSource),
                incoming: BookRights.normalize(status: cached.rightsStatus, license: cached.license,
                                               licenseURL: cached.licenseUrl, source: cached.rightsSource)
            )
            result.rightsStatus = rights.status.rawValue
            result.license = rights.license
            result.licenseUrl = rights.licenseURL
            result.rightsSource = rights.source
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
    private let fileStore: JSONFileStore
    private let settings: SettingsRepository
    private let signerStore: SignerStore
    private let nip46Service: Nip46Service
    private var inspectedComicMetadata = Set<URL>()
    private var comicLanguageByURL: [URL: String] = [:]

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
            guard let storedFormat = BookFormat(rawValue: ext) else { continue }
            let embedded = ext == "fb2" ? PublicationUtilities.fb2Metadata(fileURL: file) : nil
            let id = file.deletingPathExtension().lastPathComponent.lowercased()
            guard id.count == 64, id.allSatisfy(\.isHexDigit) else { continue }
            let comicLanguage = byID[id]?.language ?? ((storedFormat == .cbr || storedFormat == .cbz)
                ? cachedComicLanguage(fileURL: file, format: storedFormat) : nil)
            if let remembered = byID[id], remembered.format.rawValue != ext {
                var updated = replacingFormat(of: remembered, with: storedFormat)
                updated.language = updated.language ?? comicLanguage
                byID[id] = updated
            } else if var remembered = byID[id] {
                remembered.language = remembered.language ?? comicLanguage
                byID[id] = remembered
            } else if byID[id] == nil, let favorite = favoritesBySHA[id] {
                byID[id] = CatalogBook(
                    id: id, title: favorite.title, author: favorite.author ?? "Unknown",
                    epubUrl: "https://\(Self.blossomHost)/\(id)", coverUrl: nil,
                    sourceUrl: favorite.blossomUrl, isbn: favorite.isbn,
                    libvaultMd5: favorite.libvaultMd5,
                    format: storedFormat, blossomSha256: id, year: favorite.year,
                    language: comicLanguage,
                    rightsStatus: favorite.rightsStatus, license: favorite.license,
                    licenseUrl: favorite.licenseUrl, rightsSource: favorite.rightsSource
                )
            } else if byID[id] == nil {
                byID[id] = CatalogBook(
                    id: id, title: embedded?.title ?? "Downloaded \(ext.uppercased())", author: embedded?.author ?? "Unknown",
                    epubUrl: "https://\(Self.blossomHost)/\(id)", coverUrl: nil,
                    sourceUrl: nil, isbn: nil, libvaultMd5: nil,
                    format: storedFormat, blossomSha256: id, year: embedded?.year,
                    language: comicLanguage
                )
            }
        }
        let downloaded = byID.values.filter {
            guard let local = localPublication(for: $0) else { return false }
            return Self.isStructurallyValidPublication(fileURL: local.url, format: local.book.format)
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

    private let privateCatalog = PrivateCatalogClient(crypto: .native)

    func search(_ query: String, limit: Int = 20) async throws -> [BookSearchResult] {
        try await searchPage(query, limit: limit).books
    }

    func searchPage(_ query: String, offset: Int = 0, limit: Int = 50) async throws -> CatalogSearchPage {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.count >= 2, offset >= 0 else { throw PrivateCatalogError.rejected("Type at least 2 characters to search") }
        if settings.authMode == .nip46 { await nip46Service.restore(from: settings) }
        guard let signer = signerStore.signer(from: settings) else {
            return CatalogSearchPage(books: try await publicSearch(normalized, limit: limit))
        }
        // Public results remain usable if the private relay is unavailable.
        async let publicBooks: [BookSearchResult] = offset == 0 ? ((try? await publicSearch(normalized, limit: limit)) ?? []) : []
        do {
            let response = try await privateCatalog.request(["type": "libcat.search", "query": normalized,
                "search_type": "all", "offset": offset, "limit": min(max(limit, 1), 50)], signer: signer)
            var page = CatalogSearchPage.libcat(response, offset: offset)
            page.books = CatalogSearchPage.merge(page.books, await publicBooks)
            return page
        } catch {
            try Task.checkCancellation()
            let fallback = await publicBooks
            if fallback.isEmpty { throw error }
            return CatalogSearchPage(books: fallback, warning: error.localizedDescription)
        }
    }

    private func publicSearch(_ query: String, limit: Int = 20) async throws -> [BookSearchResult] {
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
            let rightsProvider = source == "gutenberg" && item.keys.contains("copyright") ? "gutendex" : source
            let rights = BookRights.normalize(
                status: string(item["rights_status"]) ?? string(item["rightsStatus"]),
                license: string(item["license"]) ?? string(item["rights"]),
                licenseURL: string(item["license_url"]) ?? string(item["licenseUrl"]),
                source: string(item["rights_source"]) ?? string(item["rightsSource"]) ?? rightsProvider,
                copyright: bool(item["copyright"])
            )
            return BookSearchResult(
                id: "\(source):\(nativeID)", source: source, title: string(item["title"]) ?? "Untitled",
                author: author, year: issued ?? string(item["year"]), publisher: string(item["publisher"]),
                language: string(item["language"]), format: format, downloadUrl: downloadURL, coverUrl: cover,
                rating: (item["avg_rating"] as? NSNumber)?.doubleValue ?? (item["rating"] as? NSNumber)?.doubleValue ?? 0,
                editionCount: (item["edition_count"] as? NSNumber)?.intValue ?? 0,
                rightsStatus: rights.status.rawValue, license: rights.license,
                licenseUrl: rights.licenseURL, rightsSource: rights.source
            )
        }.sorted { $0.isReadable && !$1.isReadable }
    }

    private static func string(_ value: Any?) -> String? {
        if let value = value as? String, !value.isEmpty { return value }
        if let value = value as? NSNumber { return value.stringValue }
        return nil
    }

    private static func bool(_ value: Any?) -> Bool? {
        if value is NSNull || value == nil { return nil }
        if let value = value as? Bool { return value }
        if let value = value as? NSNumber { return value.boolValue }
        return nil
    }

    func prepareForOpening(result: BookSearchResult) async throws -> CatalogBook {
        guard var book = result.asCatalogBook() else { throw PrivateCatalogError.rejected("This edition has no supported download") }
        if localPublication(for: book) != nil { return try await prepareForOpening(book: book) }
        if book.epubUrl.isEmpty, let md5 = result.libvaultMd5 {
            if settings.authMode == .nip46 { await nip46Service.restore(from: settings) }
            guard let signer = signerStore.signer(from: settings) else {
                throw PrivateCatalogError.rejected("Connect your Nostr identity to download this edition")
            }
            let response = try await privateCatalog.request(["type": "libcat.resolve", "book": ["md5": md5]], signer: signer)
            book = try CatalogSearchPage.publication(response, for: book)
        }
        return try await prepareForOpening(book: book)
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
        let (tempURL, response) = try await PublicationDownloadManager.shared.download(for: request)
        defer {
            try? FileManager.default.removeItem(at: tempURL)
            PublicationDownloadManager.shared.discard(remoteURL)
        }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw NSError(domain: "CatalogRepository", code: status,
                          userInfo: [NSLocalizedDescriptionKey: "\(book.format.rawValue.uppercased()) download failed: HTTP \(status)"])
        }
        guard let actual = Self.detectedFormat(fileURL: tempURL) else {
            throw NSError(domain: "CatalogRepository", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "The downloaded file is not a valid PDF, EPUB, FB2, CBR, or CBZ"])
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
                          userInfo: [NSLocalizedDescriptionKey: "This publication is not a readable PDF, EPUB, FB2, CBR, or CBZ"])
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
            for format in [book.format] + BookFormat.allCases.filter({ $0 != book.format }) {
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
        PublicationUtilities.publicationIdentityCandidates(for: book)
    }

    static let blossomHost = PublicationUtilities.blossomHost

    static func fromExternalFavorite(_ favorite: ExternalFavorite) -> CatalogBook? {
        PublicationUtilities.fromExternalFavorite(favorite)
    }

    static func fromBlossomFavorite(_ favorite: ExternalFavorite) -> CatalogBook? {
        PublicationUtilities.fromBlossomFavorite(favorite)
    }

    private func rememberDownloaded(_ book: CatalogBook) {
        var books = fileStore.load("downloaded-books.json", as: [CatalogBook].self, fallback: [])
        let rights = BookRights.preferred(
            current: books.first(where: { $0.id == book.id })?.rights ?? BookRights(),
            incoming: book.rights
        )
        var updated = book
        updated.rightsStatus = rights.status.rawValue
        updated.license = rights.license
        updated.licenseUrl = rights.licenseURL
        updated.rightsSource = rights.source
        books.removeAll { $0.id == book.id }
        books.append(updated)
        fileStore.save("downloaded-books.json", value: books)
    }

    func rememberEmbeddedRights(book: CatalogBook, statement: String?) -> BookRights {
        let rights = BookRights.preferred(
            current: book.rights,
            incoming: BookRights.normalize(license: statement, source: "epub_opf")
        )
        var updated = book
        updated.rightsStatus = rights.status.rawValue
        updated.license = rights.license
        updated.licenseUrl = rights.licenseURL
        updated.rightsSource = rights.source
        rememberDownloaded(updated)
        return rights
    }

    private func replacingIdentity(of book: CatalogBook, with id: String, format: BookFormat) -> CatalogBook {
        CatalogBook(
            id: id, title: book.title, author: book.author, epubUrl: book.epubUrl,
            coverUrl: book.coverUrl, sourceUrl: book.sourceUrl, isbn: book.isbn,
            libvaultMd5: book.libvaultMd5, format: format,
            blossomSha256: book.blossomSha256, year: book.year, language: book.language,
            rightsStatus: book.rightsStatus, license: book.license,
            licenseUrl: book.licenseUrl, rightsSource: book.rightsSource
        )
    }

    private func cachedComicLanguage(fileURL: URL, format: BookFormat) -> String? {
        if inspectedComicMetadata.contains(fileURL) { return comicLanguageByURL[fileURL] }
        inspectedComicMetadata.insert(fileURL)
        let language = PublicationUtilities.comicMetadata(fileURL: fileURL, format: format)?.language
        comicLanguageByURL[fileURL] = language
        return language
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
        PublicationUtilities.sha256(fileURL: fileURL, chunkSize: chunkSize)
    }

    static func detectedFormat(fileURL: URL) -> BookFormat? {
        PublicationUtilities.detectedFormat(fileURL: fileURL)
    }

    static func isStructurallyValidPublication(fileURL: URL, format: BookFormat) -> Bool {
        PublicationUtilities.isStructurallyValidPublication(fileURL: fileURL, format: format)
    }

    private func replacingFormat(of book: CatalogBook, with format: BookFormat) -> CatalogBook {
        guard book.format != format else { return book }
        return CatalogBook(
            id: book.id, title: book.title, author: book.author, epubUrl: book.epubUrl,
            coverUrl: book.coverUrl, sourceUrl: book.sourceUrl, isbn: book.isbn,
            libvaultMd5: book.libvaultMd5, format: format,
            blossomSha256: book.blossomSha256, year: book.year, language: book.language,
            rightsStatus: book.rightsStatus, license: book.license,
            licenseUrl: book.licenseUrl, rightsSource: book.rightsSource
        )
    }

}
