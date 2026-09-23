import Combine
import CryptoKit
import Foundation
import ImageIO
import UIKit

struct CoverLookupEntry: Codable {
    var bookID: String
    var title: String
    var author: String
    var isbn: String?
    var existingURL: String?
    var priority: Int
    var nextAttempt: Date
    var failures: Int
}

enum CoverSearchMatch {
    private static func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .lowercased()
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .joined(separator: " ")
    }

    /// A search result must identify the same work and author. Conflicting
    /// covers for otherwise identical results are treated as ambiguous.
    static func coverID(title: String, author: String, documents: [OpenLibraryCoverDocument]) -> Int? {
        let wantedTitle = normalized(title)
        let wantedAuthor = normalized(author)
        guard wantedTitle.count >= 4, wantedAuthor.count >= 3 else { return nil }
        let candidates = Set(documents.compactMap { document -> Int? in
            guard normalized(document.title) == wantedTitle,
                  document.authors.contains(where: { normalized($0) == wantedAuthor }),
                  let coverID = document.coverID, coverID > 0 else { return nil }
            return coverID
        })
        return candidates.count == 1 ? candidates.first : nil
    }
}

struct OpenLibraryCoverDocument: Decodable {
    let title: String
    let authors: [String]
    let coverID: Int?

    init(title: String, authors: [String], coverID: Int?) {
        self.title = title
        self.authors = authors
        self.coverID = coverID
    }

    enum CodingKeys: String, CodingKey {
        case title
        case authors = "author_name"
        case coverID = "cover_i"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? ""
        authors = try container.decodeIfPresent([String].self, forKey: .authors) ?? []
        coverID = try container.decodeIfPresent(Int.self, forKey: .coverID)
    }
}

private struct OpenLibraryCoverResults: Decodable {
    let docs: [OpenLibraryCoverDocument]
}

private enum CoverLookupError: Error { case temporaryResponse }

@MainActor
final class CoverDiscoveryService: ObservableObject {
    typealias Fetch = (URL) async throws -> (Data, URLResponse)

    @Published private(set) var cachedURLs: [String: URL] = [:]

    private let fileStore: JSONFileStore
    private let fetch: Fetch
    private var entries: [String: CoverLookupEntry]
    private var worker: Task<Void, Never>?
    private var isActive = true
    private var isCarPlayConnected = false
    private var embeddedLookups: Set<String> = []
    private static let stateFile = "cover-discovery.json"
    private static let requestSpacing: UInt64 = 5_000_000_000

    init(fileStore: JSONFileStore, fetch: @escaping Fetch = { url in
        var request = URLRequest(url: url)
        request.timeoutInterval = 12
        return try await URLSession.shared.data(for: request)
    }) {
        self.fileStore = fileStore
        self.fetch = fetch
        self.entries = fileStore.load(Self.stateFile, as: [String: CoverLookupEntry].self, fallback: [:])
        cachedURLs = fileStore.discoveredCoverURLs()
    }

    static func key(for bookID: String) -> String {
        SHA256.hash(data: Data(bookID.lowercased().utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    func cachedURL(for bookID: String) -> URL? {
        cachedURLs[Self.key(for: bookID)]
    }

    /// Details opens immediately; inspect the exact local edition first and
    /// only fall back to the persisted online lookup queue if it has no cover.
    func prioritize(_ book: CatalogBook, localPublicationURL: URL?) {
        let key = Self.key(for: book.id)
        guard cachedURLs[key] == nil else { return }
        if let existing = BookCoverView.coverURL(book.coverUrl), existing.isFileURL,
           FileManager.default.fileExists(atPath: existing.path) { return }
        guard book.format == .epub, let localPublicationURL,
              FileManager.default.fileExists(atPath: localPublicationURL.path) else {
            prioritizeOnlineLookup(for: book)
            return
        }
        guard embeddedLookups.insert(key).inserted else { return }
        Task { [weak self] in
            let embedded = await Task.detached(priority: .utility) {
                PublicationUtilities.epubCover(fileURL: localPublicationURL)
            }.value
            guard let self else { return }
            self.embeddedLookups.remove(key)
            if let embedded, let image = UIImage(data: embedded.data), self.save(image, for: key) { return }
            self.prioritizeOnlineLookup(for: book)
        }
    }

    private func prioritizeOnlineLookup(for book: CatalogBook) {
        enqueue([book], readingIDs: [book.id])
        let key = Self.key(for: book.id)
        guard var entry = entries[key] else { return }
        entry.priority = 0
        entry.nextAttempt = Date()
        entries[key] = entry
        persist()
        resume()
    }

    func enqueue(_ books: [CatalogBook], readingIDs: Set<String> = [], favoriteIDs: Set<String> = []) {
        let now = Date()
        for book in books {
            let key = Self.key(for: book.id)
            if cachedURLs[key] != nil { continue }
            if let url = BookCoverView.coverURL(book.coverUrl), url.isFileURL,
               FileManager.default.fileExists(atPath: url.path) { continue }
            let priority = readingIDs.contains(book.id) ? 0 : favoriteIDs.contains(book.id) ? 1 : 2
            if var existing = entries[key] {
                existing.priority = priority
                existing.existingURL = book.coverUrl
                entries[key] = existing
            } else {
                entries[key] = CoverLookupEntry(
                    bookID: book.id, title: book.title, author: book.author,
                    isbn: book.isbn, existingURL: book.coverUrl,
                    priority: priority, nextAttempt: now, failures: 0
                )
            }
        }
        persist()
        resume()
    }

    func setActive(_ active: Bool) {
        isActive = active
        if active && !isCarPlayConnected { resume() } else { worker?.cancel(); worker = nil }
    }

    func setCarPlayConnected(_ connected: Bool) {
        isCarPlayConnected = connected
        if connected { worker?.cancel(); worker = nil }
        else { resume() }
    }

    func resume() {
        guard isActive, !isCarPlayConnected, worker == nil else { return }
        worker = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, self.isActive, !self.isCarPlayConnected {
                let now = Date()
                guard let pair = self.entries
                    .filter({ self.cachedURLs[$0.key] == nil && $0.value.nextAttempt <= now })
                    .min(by: { lhs, rhs in
                        lhs.value.priority == rhs.value.priority
                            ? lhs.value.nextAttempt < rhs.value.nextAttempt
                            : lhs.value.priority < rhs.value.priority
                    }) else { break }
                await self.resolve(key: pair.key, entry: pair.value)
                try? await Task.sleep(nanoseconds: Self.requestSpacing)
            }
            self.worker = nil
        }
    }

    private func resolve(key: String, entry: CoverLookupEntry) async {
        do {
            var candidates: [URL] = []
            var temporaryFailure = false
            if let existing = BookCoverView.coverURL(entry.existingURL), !existing.isFileURL {
                candidates.append(existing)
            }
            if let isbn = Self.normalizedISBN(entry.isbn),
               let url = URL(string: "https://covers.openlibrary.org/b/isbn/\(isbn)-M.jpg?default=false") {
                candidates.append(url)
            }
            for url in candidates {
                do {
                    if let image = try await validatedImage(at: url), save(image, for: key) { return }
                } catch {
                    temporaryFailure = true
                }
                if Task.isCancelled { return }
            }
            if let coverID = try await searchedCoverID(for: entry),
               let url = URL(string: "https://covers.openlibrary.org/b/id/\(coverID)-M.jpg?default=false"),
               let image = try await validatedImage(at: url), save(image, for: key) { return }
            if temporaryFailure { throw CoverLookupError.temporaryResponse }
            retry(key: key, entry: entry, after: 30 * 24 * 60 * 60, failure: false)
        } catch {
            retry(key: key, entry: entry, after: min(24 * 60 * 60, Double(60 * (1 << min(entry.failures, 10)))), failure: true)
        }
    }

    private static func normalizedISBN(_ value: String?) -> String? {
        guard let value else { return nil }
        let isbn = value.uppercased().filter { $0.isNumber || $0 == "X" }
        if isbn.count == 13, isbn.allSatisfy(\.isNumber) { return isbn }
        if isbn.count == 10,
           isbn.dropLast().allSatisfy(\.isNumber),
           isbn.last?.isNumber == true || isbn.last == "X" { return isbn }
        return nil
    }

    private func searchedCoverID(for entry: CoverLookupEntry) async throws -> Int? {
        guard !entry.title.isEmpty, !entry.author.isEmpty else { return nil }
        var components = URLComponents(string: "https://openlibrary.org/search.json")!
        components.queryItems = [
            URLQueryItem(name: "title", value: entry.title),
            URLQueryItem(name: "author", value: entry.author),
            URLQueryItem(name: "fields", value: "title,author_name,cover_i"),
            URLQueryItem(name: "limit", value: "5")
        ]
        guard let url = components.url else { return nil }
        let (data, response) = try await fetch(url)
        guard let http = response as? HTTPURLResponse else { throw CoverLookupError.temporaryResponse }
        if http.statusCode == 429 || http.statusCode >= 500 { throw CoverLookupError.temporaryResponse }
        guard (200...299).contains(http.statusCode), data.count <= 256_000 else { return nil }
        let results = try JSONDecoder().decode(OpenLibraryCoverResults.self, from: data)
        return CoverSearchMatch.coverID(title: entry.title, author: entry.author, documents: results.docs)
    }

    private func validatedImage(at url: URL) async throws -> UIImage? {
        let (data, response) = try await fetch(url)
        guard let http = response as? HTTPURLResponse else { throw CoverLookupError.temporaryResponse }
        if http.statusCode == 429 || http.statusCode >= 500 { throw CoverLookupError.temporaryResponse }
        guard (200...299).contains(http.statusCode),
              data.count >= 100, data.count <= 8_000_000,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width >= 32, height >= 32, width * height <= 30_000_000,
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 640
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }

    private func save(_ image: UIImage, for key: String) -> Bool {
        guard !Task.isCancelled, cachedURLs[key] == nil,
              let data = image.jpegData(compressionQuality: 0.82) else { return false }
        let url = fileStore.discoveredCoverFileURL(key: key)
        guard (try? data.write(to: url, options: .atomic)) != nil else { return false }
        cachedURLs[key] = url
        entries[key] = nil
        persist()
        return true
    }

    private func retry(key: String, entry: CoverLookupEntry, after delay: TimeInterval, failure: Bool) {
        var updated = entry
        updated.nextAttempt = Date().addingTimeInterval(delay)
        if failure { updated.failures += 1 }
        entries[key] = updated
        persist()
    }

    private func persist() {
        fileStore.save(Self.stateFile, value: entries)
    }
}
