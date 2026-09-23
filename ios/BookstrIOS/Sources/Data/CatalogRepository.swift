import Foundation

/// The web app keeps descriptive book data independently from the favorite
/// locator. Keep the same separation on iOS so compact favorites retain labels.
final class FavoriteMetadataRepository {
    private struct Entry: Codable, Equatable {
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
        var coverUrl: String?
        var updatedAt: Int64
    }

    // Compatibility with the earlier LibVault-backed cache on existing installs.
    private struct LegacyEntry: Codable {
        let book: CatalogBook
        let fetchedAt: Date
    }

    private let fileStore: JSONFileStore
    // Relay sync and foreground library updates share this cache.
    private let entriesLock = NSLock()
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
                    coverUrl: FavoritesParser.remoteCoverURL(book.coverUrl),
                    updatedAt: Int64(pair.value.fetchedAt.timeIntervalSince1970 * 1000)
                )
            }
        }
    }

    func remember(book: CatalogBook, updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        rememberEntries(
            [favoriteRef(for: book)],
            updatedAt: updatedAt,
            refreshUnchangedTimestamp: false
        )
    }

    func remember(books: [CatalogBook], updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        rememberEntries(
            books.map { favoriteRef(for: $0) },
            updatedAt: updatedAt,
            refreshUnchangedTimestamp: false
        )
    }

    private func favoriteRef(for book: CatalogBook) -> SharedFavoriteRef {
        SharedFavoriteRef(
            bookstrId: book.id, libvaultMd5: book.libvaultMd5, isbn: book.isbn,
            url: book.sourceUrl ?? book.epubUrl, title: book.title, author: book.author,
            year: book.year, format: book.format.rawValue,
            rightsStatus: book.rightsStatus, license: book.license,
            licenseUrl: book.licenseUrl, rightsSource: book.rightsSource,
            coverUrl: FavoritesParser.remoteCoverURL(book.coverUrl)
        )
    }

    func remember(_ ref: SharedFavoriteRef, updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        remember([ref], updatedAt: updatedAt)
    }

    func remember(_ refs: [SharedFavoriteRef], updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        rememberEntries(refs, updatedAt: updatedAt, refreshUnchangedTimestamp: true)
    }

    private func rememberEntries(
        _ refs: [SharedFavoriteRef],
        updatedAt: Int64,
        refreshUnchangedTimestamp: Bool
    ) {
        entriesLock.lock()
        defer { entriesLock.unlock() }
        var changed = false
        for ref in refs {
            guard let title = useful(ref.title) else { continue }
            let entry = Entry(
                bookstrId: ref.bookstrId, libvaultMd5: ref.libvaultMd5?.lowercased(), isbn: ref.isbn,
                title: title, author: useful(ref.author), year: useful(ref.year), format: useful(ref.format),
                rightsStatus: ref.rightsStatus, license: ref.license,
                licenseUrl: ref.licenseUrl, rightsSource: ref.rightsSource,
                coverUrl: FavoritesParser.remoteCoverURL(ref.coverUrl),
                updatedAt: updatedAt
            )
            for key in identityKeys(ref) where entries[key]?.updatedAt ?? 0 <= updatedAt {
                if let existing = entries[key] {
                    var entryAtExistingTime = entry
                    entryAtExistingTime.updatedAt = existing.updatedAt
                    if entryAtExistingTime == existing {
                        if refreshUnchangedTimestamp, existing.updatedAt != updatedAt {
                            entries[key] = entry
                            changed = true
                        }
                        continue
                    }
                }
                entries[key] = entry
                changed = true
            }
        }
        if changed { persist() }
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
        entriesLock.lock()
        defer { entriesLock.unlock() }
        return refs.map { ref in
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
            if result.coverUrl == nil { result.coverUrl = cached.coverUrl }
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
    private static let downloadSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 180
        return URLSession(configuration: configuration)
    }()
    private let fileStore: JSONFileStore
    private let settings: SettingsRepository
    private let downloadedBooksLock = NSLock()
    private let comicMetadataLock = NSLock()
    private let searchCacheLock = NSLock()
    private let signerProvider: () -> NostrSigner?
    private let nip46Service: Nip46Service
    private var inspectedComicMetadata = Set<URL>()
    private var comicLanguageByURL: [URL: String] = [:]
    private var downloadedBooksCache: (signature: String, books: [CatalogBook])?
    private var validatedPublicationFingerprints: [String: String] = [:]
    private var searchPageCache: [String: (expires: Date, page: CatalogSearchPage)] = [:]
    private static let searchPageTTL: TimeInterval = 45

    init(fileStore: JSONFileStore, settings: SettingsRepository, signerStore: SignerStore, nip46Service: Nip46Service,
         searchSession: URLSession = .shared,
         signerProvider: (() -> NostrSigner?)? = nil,
         catalogRequest: @escaping ([String: Any], NostrSigner, PrivateCatalogService) async throws -> [String: Any] = {
             try await PrivateCatalogClient(crypto: .native, socketFactory: PrivateCatalogSocketConnection.live)
                 .request($0, signer: $1, service: $2)
         }) {
        self.fileStore = fileStore
        self.settings = settings
        self.signerProvider = signerProvider ?? { signerStore.signer(from: settings) }
        self.nip46Service = nip46Service
        self.searchSession = searchSession
        self.catalogRequest = catalogRequest
        fileStore.ensureBooksDirectory()
        fileStore.ensureCoversDirectory()
        clearStaleNegativeCoverCache()
    }

    /// Earlier extraction misses left `coverUrl == ""` permanently. Clear those
    /// so improved heuristics can rescan local publications once.
    private func clearStaleNegativeCoverCache() {
        var books = rememberedBooks()
        var changed = false
        for index in books.indices where books[index].coverUrl == "" {
            books[index].coverUrl = nil
            changed = true
        }
        guard changed else { return }
        fileStore.save("downloaded-books.json", value: books)
        invalidateDownloadedBooksCache()
    }

    func invalidateDownloadedBooksCache() {
        downloadedBooksLock.lock()
        downloadedBooksCache = nil
        downloadedBooksLock.unlock()
        SpeechLanguageListCache.invalidate()
    }

    /// `downloadedBooksLock` is not recursive, so callers that already hold it
    /// must clear the cache through this variant instead of the public one.
    private func invalidateDownloadedBooksCacheWhileLocked() {
        downloadedBooksCache = nil
        SpeechLanguageListCache.invalidate()
    }

    func downloadedBooks(externalFavorites: [ExternalFavorite] = []) -> [CatalogBook] {
        let signature = downloadedBooksSignature(externalFavorites: externalFavorites)
        downloadedBooksLock.lock()
        if let cached = downloadedBooksCache, cached.signature == signature {
            let books = cached.books
            downloadedBooksLock.unlock()
            return books
        }
        downloadedBooksLock.unlock()

        var byID = Dictionary(uniqueKeysWithValues: rememberedBooks().map { ($0.id.lowercased(), $0) })
        for file in fileStore.publicationFiles() {
            let ext = file.pathExtension.lowercased()
            guard let storedFormat = BookFormat(rawValue: ext) else { continue }
            let embedded = ext == "fb2" ? PublicationUtilities.fb2Metadata(fileURL: file) : nil
            let id = file.deletingPathExtension().lastPathComponent.lowercased()
            // Preserve existing hash-named local files as opaque local identities.
            guard (id.count == 64 || id.count == 32), id.allSatisfy(\.isHexDigit) else { continue }
            let comicLanguage = byID[id]?.language ?? ((storedFormat == .cbr || storedFormat == .cbz)
                ? cachedComicLanguage(fileURL: file, format: storedFormat) : nil)
            if let remembered = byID[id], remembered.format.rawValue != ext {
                var updated = replacingFormat(of: remembered, with: storedFormat)
                updated.language = updated.language ?? comicLanguage
                byID[id] = updated
            } else if var remembered = byID[id] {
                remembered.language = remembered.language ?? comicLanguage
                byID[id] = remembered
            } else if byID[id] == nil {
                byID[id] = CatalogBook(
                    id: id, title: embedded?.title ?? "Downloaded \(ext.uppercased())", author: embedded?.author ?? "Unknown",
                    epubUrl: "", coverUrl: nil,
                    sourceUrl: nil, isbn: nil, libvaultMd5: nil,
                    format: storedFormat, year: embedded?.year,
                    language: comicLanguage
                )
            }
        }
        let coverCache = fileStore.cachedCoverURLs()
        let downloaded = byID.values
            .map { Self.stampCachedCover(into: $0, cache: coverCache) }
            .filter {
                guard let local = localPublication(for: $0) else { return false }
                return isValidatedPublication(fileURL: local.url, format: local.book.format)
            }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        downloaded.forEach(rememberDownloaded)

        // Signature after remember so cover stamps in downloaded-books.json match.
        let finalSignature = downloadedBooksSignature(externalFavorites: externalFavorites)
        downloadedBooksLock.lock()
        downloadedBooksCache = (finalSignature, downloaded)
        downloadedBooksLock.unlock()
        return downloaded
    }

    /// Remote or already-stamped covers win. An empty-string `coverUrl` is the
    /// stored negative result from a prior scan (`nil` means "not scanned yet").
    static func hasUsableCover(_ book: CatalogBook) -> Bool {
        !(book.coverUrl ?? "").isEmpty
    }

    static func shouldScanEmbeddedCover(for book: CatalogBook) -> Bool {
        book.coverUrl == nil
    }

    private static func cachedCoverURL(for book: CatalogBook, cache: [String: URL]) -> URL? {
        for key in publicationIdentityCandidates(for: book).map({ $0.lowercased() }) {
            if let cached = cache[key] { return cached }
        }
        return nil
    }

    private static func stampCachedCover(into book: CatalogBook, cache: [String: URL]) -> CatalogBook {
        guard !hasUsableCover(book), let cached = cachedCoverURL(for: book, cache: cache) else { return book }
        var stamped = book
        stamped.coverUrl = cached.absoluteString
        return stamped
    }

    /// Extracts embedded covers for books without one, off the main thread.
    /// Results are cached under covers/ and persisted on the book record, so
    /// each publication is scanned at most once — including a negative result.
    func ensureEmbeddedCovers(for books: [CatalogBook]) async -> [CatalogBook] {
        var results: [CatalogBook] = []
        for book in books {
            if Task.isCancelled { break }
            results.append(await ensureEmbeddedCover(for: book))
        }
        return results
    }

    func ensureEmbeddedCover(for book: CatalogBook) async -> CatalogBook {
        if Self.hasUsableCover(book) { return book }
        let cache = fileStore.cachedCoverURLs()
        if let cached = Self.cachedCoverURL(for: book, cache: cache) {
            var stamped = book
            stamped.coverUrl = cached.absoluteString
            return stamped
        }
        // Empty string means a previous scan found nothing; do not rescan.
        guard Self.shouldScanEmbeddedCover(for: book) else { return book }
        guard let local = localPublication(for: book) else { return book }
        let sourceURL = local.url
        let format = local.book.format
        let extracted: PublicationUtilities.EmbeddedCover? = await Task.detached(priority: .utility) {
            switch format {
            case .epub:
                return PublicationUtilities.epubCover(fileURL: sourceURL)
            case .pdf:
                // PDFKit page thumbnails are unreliable off the main thread.
                return await MainActor.run {
                    PublicationUtilities.pdfCover(fileURL: sourceURL)
                }
            default:
                return nil
            }
        }.value
        var updated = book
        if let extracted {
            fileStore.ensureCoversDirectory()
            // Prefer the on-disk publication identity so cover files stay stable
            // across catalog and LibVault aliases.
            let target = fileStore.coverFileURL(bookId: local.book.id, ext: extracted.pathExtension)
            if (try? extracted.data.write(to: target, options: .atomic)) != nil {
                updated.coverUrl = target.absoluteString
            }
        }
        if updated.coverUrl == nil {
            updated.coverUrl = ""
        }
        rememberDownloaded(updated)
        return updated
    }

    func rememberedBooks() -> [CatalogBook] {
        fileStore.load("downloaded-books.json", as: [CatalogBook].self, fallback: [])
    }

    private static func isMD5(_ value: String) -> Bool {
        value.count == 32 && value.allSatisfy(\.isHexDigit)
    }

    private let searchSession: URLSession
    private let catalogRequest: ([String: Any], NostrSigner, PrivateCatalogService) async throws -> [String: Any]

    private var catalogService: PrivateCatalogService {
        settings.catalogConnection.flatMap(PrivateCatalogService.init(connection:)) ?? .libcat
    }

    func search(_ query: String, limit: Int = 20) async throws -> [BookSearchResult] {
        try await searchPage(query, limit: limit).books
    }

    func searchPage(_ query: String, offset: Int = 0, limit: Int = 50) async throws -> CatalogSearchPage {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.count >= 2, offset >= 0 else { throw PrivateCatalogError.rejected("Type at least 2 characters to search") }
        let cacheKey = searchPageCacheKey(query: normalized, offset: offset, limit: limit)
        searchCacheLock.lock()
        if let cached = searchPageCache[cacheKey], cached.expires > Date() {
            let page = cached.page
            searchCacheLock.unlock()
            return page
        }
        searchCacheLock.unlock()

        if settings.authMode == .nip46 { await nip46Service.restore(from: settings) }
        guard let signer = signerProvider() else {
            let page = CatalogSearchPage(books: try await publicSearch(normalized, limit: limit))
            storeSearchPage(page, for: cacheKey)
            return page
        }
        // Public results remain usable if the private relay is unavailable.
        async let publicBooks: [BookSearchResult] = offset == 0 ? ((try? await publicSearch(normalized, limit: limit)) ?? []) : []
        do {
            let response = try await catalogRequest(["type": "libcat.search", "query": normalized,
                "search_type": "all", "offset": offset, "limit": min(max(limit, 1), 50)], signer, catalogService)
            var page = CatalogSearchPage.libcat(response, offset: offset)
            page.books = CatalogSearchPage.merge(page.books, await publicBooks)
            storeSearchPage(page, for: cacheKey)
            return page
        } catch {
            try Task.checkCancellation()
            let fallback = await publicBooks
            if fallback.isEmpty { throw error }
            let page = CatalogSearchPage(books: fallback, warning: error.localizedDescription)
            storeSearchPage(page, for: cacheKey)
            return page
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
        let (data, response) = try await searchSession.data(from: url)
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

    func prepareForOpening(result: BookSearchResult, progress: @escaping (String) -> Void = { _ in }) async throws -> CatalogBook {
        guard let book = result.asCatalogBook() else { throw PrivateCatalogError.rejected("This edition has no supported download") }
        if localPublication(for: book) != nil { return try await prepareForOpening(book: book) }
        if book.epubUrl.isEmpty, let md5 = result.libvaultMd5 {
            guard CatalogSearchPage.validHash(md5, length: 32) else { throw TorrentDownloadError.invalidEdition }
            let cacheName = "torrent-edition-\(md5).json"
            var edition = fileStore.load(cacheName, as: TorrentEdition?.self, fallback: nil)
            if edition?.md5 != md5 { edition = nil }
            if edition == nil {
                if settings.authMode == .nip46 { await nip46Service.restore(from: settings) }
                guard let signer = signerProvider() else {
                    throw PrivateCatalogError.rejected("Connect your Nostr identity to download this edition")
                }
                let response = try await catalogRequest(["type": "libcat.resolve", "book": ["md5": md5]], signer, catalogService)
                guard let record = response["book"] as? [String: Any] else { throw TorrentDownloadError.invalidEdition }
                edition = try TorrentEdition(record: record, expectedMD5: md5)
                fileStore.save(cacheName, value: edition)
            }
            let staging = try await ForegroundTorrentDownloader.shared.download(edition!, progress: progress)
            guard let format = Self.detectedFormat(fileURL: staging) else { throw TorrentDownloadError.verification }
            let corrected = replacingFormat(of: book, with: format)
            guard isValidCachedFile(book: corrected, fileURL: staging) else { throw TorrentDownloadError.verification }
            fileStore.ensureBooksDirectory()
            let target = fileStore.bookFileURL(bookId: corrected.id, format: format)
            if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
            try FileManager.default.copyItem(at: staging, to: target)
            rememberDownloaded(corrected)
            // Stamp a cover so the library row updates without waiting for the next cold start.
            return await ensureEmbeddedCover(for: corrected)
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
            if isValidCachedFile(book: corrected, fileURL: target) {
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
        let request = URLRequest(url: remoteURL)
        let (tempURL, response) = try await Self.downloadSession.download(for: request)
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
        guard isValidCachedFile(book: corrected, fileURL: tempURL) else {
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
            return await ensureEmbeddedCover(for: local.book)
        }

        let fileURL = try await ensureDownloaded(book: book)
        guard let actual = Self.detectedFormat(fileURL: fileURL) else {
            throw NSError(domain: "CatalogRepository", code: 10,
                          userInfo: [NSLocalizedDescriptionKey: "This publication is not a readable PDF, EPUB, FB2, CBR, or CBZ"])
        }
        let corrected = replacingFormat(of: book, with: actual)
        guard isValidCachedFile(book: corrected, fileURL: fileURL) else {
            throw NSError(domain: "CatalogRepository", code: 11,
                          userInfo: [NSLocalizedDescriptionKey: "This \(actual.rawValue.uppercased()) is damaged or unsupported"])
        }
        rememberDownloaded(corrected)
        // The reader surfaces this as lock-screen artwork while TTS plays.
        return await ensureEmbeddedCover(for: corrected)
    }

    func publicationFile(book: CatalogBook) -> URL {
        fileStore.bookFileURL(bookId: book.id, format: book.format)
    }

    /// Resolve catalog and LibVault identities to an existing local file before networking.
    func localPublication(for book: CatalogBook) -> (book: CatalogBook, url: URL)? {
        for id in Self.publicationIdentityCandidates(for: book) {
            for format in [book.format] + BookFormat.allCases.filter({ $0 != book.format }) {
                let url = fileStore.bookFileURL(bookId: id, format: format)
                guard FileManager.default.fileExists(atPath: url.path),
                      let actual = Self.detectedFormat(fileURL: url),
                      isValidatedPublication(fileURL: url, format: actual)
                else { continue }

                return (replacingIdentity(of: book, with: id, format: actual), url)
            }
        }
        return nil
    }

    static func publicationIdentityCandidates(for book: CatalogBook) -> [String] {
        PublicationUtilities.publicationIdentityCandidates(for: book)
    }

    static func fromExternalFavorite(_ favorite: ExternalFavorite) -> CatalogBook? {
        PublicationUtilities.fromExternalFavorite(favorite)
    }

    private func rememberDownloaded(_ book: CatalogBook) {
        downloadedBooksLock.lock()
        defer { downloadedBooksLock.unlock() }
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
        invalidateDownloadedBooksCacheWhileLocked()
    }

    /// Deletes the on-device publication, cover cache, and remembered metadata.
    /// Favorites on relays are unchanged — only the local library copy is removed.
    func removeFromLibrary(_ book: CatalogBook) {
        let ids = Self.publicationIdentityCandidates(for: book)
        for id in ids {
            for format in BookFormat.allCases {
                let url = fileStore.bookFileURL(bookId: id, format: format)
                if FileManager.default.fileExists(atPath: url.path) {
                    try? FileManager.default.removeItem(at: url)
                }
            }
            for ext in ["jpg", "jpeg", "png", "gif", "webp"] {
                let cover = fileStore.coverFileURL(bookId: id, ext: ext)
                if FileManager.default.fileExists(atPath: cover.path) {
                    try? FileManager.default.removeItem(at: cover)
                }
            }
        }
        downloadedBooksLock.lock()
        defer { downloadedBooksLock.unlock() }
        var books = fileStore.load("downloaded-books.json", as: [CatalogBook].self, fallback: [])
        let removable = Set(ids.map { $0.lowercased() })
        books.removeAll { removable.contains($0.id.lowercased()) }
        fileStore.save("downloaded-books.json", value: books)
        invalidateDownloadedBooksCacheWhileLocked()
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
            year: book.year, language: book.language,
            rightsStatus: book.rightsStatus, license: book.license,
            licenseUrl: book.licenseUrl, rightsSource: book.rightsSource
        )
    }

    private func cachedComicLanguage(fileURL: URL, format: BookFormat) -> String? {
        comicMetadataLock.lock()
        defer { comicMetadataLock.unlock() }
        if inspectedComicMetadata.contains(fileURL) { return comicLanguageByURL[fileURL] }
        inspectedComicMetadata.insert(fileURL)
        let language = PublicationUtilities.comicMetadata(fileURL: fileURL, format: format)?.language
        comicLanguageByURL[fileURL] = language
        return language
    }

    private func isValidCachedFile(book: CatalogBook, fileURL: URL) -> Bool {
        isValidatedPublication(fileURL: fileURL, format: book.format)
    }

    private func isValidatedPublication(fileURL: URL, format: BookFormat) -> Bool {
        let key = fileURL.path
        let fingerprint = Self.fileFingerprint(fileURL)
        downloadedBooksLock.lock()
        if validatedPublicationFingerprints[key] == fingerprint {
            downloadedBooksLock.unlock()
            return true
        }
        downloadedBooksLock.unlock()
        guard Self.isStructurallyValidPublication(fileURL: fileURL, format: format) else { return false }
        downloadedBooksLock.lock()
        validatedPublicationFingerprints[key] = fingerprint
        downloadedBooksLock.unlock()
        return true
    }

    private func downloadedBooksSignature(externalFavorites: [ExternalFavorite]) -> String {
        let files = fileStore.publicationFiles()
            .map { "\($0.lastPathComponent):\(Self.fileFingerprint($0))" }
            .sorted()
            .joined(separator: "|")
        let covers = fileStore.cachedCoverURLs().keys.sorted().joined(separator: ",")
        let favorites = externalFavorites
            .map { $0.key.lowercased() }
            .sorted()
            .joined(separator: ",")
        let remembered = rememberedBooks()
            .map { "\($0.id):\($0.coverUrl ?? "-")" }
            .sorted()
            .joined(separator: "|")
        return [files, covers, favorites, remembered].joined(separator: "#")
    }

    private func searchPageCacheKey(query: String, offset: Int, limit: Int) -> String {
        let catalog = settings.catalogConnection?.npub ?? "public"
        let auth = settings.authMode.rawValue
        return "\(catalog)|\(auth)|\(query.lowercased())|\(offset)|\(limit)"
    }

    private func storeSearchPage(_ page: CatalogSearchPage, for key: String) {
        searchCacheLock.lock()
        searchPageCache[key] = (Date().addingTimeInterval(Self.searchPageTTL), page)
        searchCacheLock.unlock()
    }

    private static func fileFingerprint(_ fileURL: URL) -> String {
        let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let size = values?.fileSize ?? -1
        let modified = values?.contentModificationDate.map { String($0.timeIntervalSince1970) } ?? "0"
        return "\(size)@\(modified)"
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
            year: book.year, language: book.language,
            rightsStatus: book.rightsStatus, license: book.license,
            licenseUrl: book.licenseUrl, rightsSource: book.rightsSource
        )
    }

}
