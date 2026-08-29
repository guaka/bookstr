import Foundation

final class SnippetRepository {
    private let fileStore: JSONFileStore
    private var cache: [String: BookSnippet]

    init(fileStore: JSONFileStore) {
        self.fileStore = fileStore
        let items = fileStore.load("book_snippets.json", as: [BookSnippet].self, fallback: [])
        self.cache = Dictionary(uniqueKeysWithValues: items.map { ($0.syncId, $0) })
    }

    func all() -> [BookSnippet] {
        cache.values.filter { !$0.deleted }.sorted { $0.updatedAt > $1.updatedAt }
    }

    func snippet(syncId: String) -> BookSnippet? {
        cache[syncId]
    }

    @discardableResult
    func saveMark(
        text: String,
        bookId: String,
        bookTitle: String,
        author: String,
        isbn: String?,
        format: BookFormat,
        locator: String
    ) -> BookSnippet {
        let snippet = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let entry = BookSnippet(
            syncId: UUID().uuidString.lowercased(),
            text: snippet,
            bookId: bookId,
            bookTitle: bookTitle,
            author: author,
            isbn: isbn,
            format: format,
            locator: locator,
            createdAt: now,
            updatedAt: now,
            deleted: false
        )
        cache[entry.syncId] = entry
        flush()
        return entry
    }

    @discardableResult
    func mergeRemote(_ snippet: BookSnippet) -> Bool {
        let existing = cache[snippet.syncId]
        if existing == nil || snippet.updatedAt >= existing!.updatedAt {
            cache[snippet.syncId] = snippet
            return true
        }
        return false
    }

    @discardableResult
    func remove(syncId: String) -> BookSnippet? {
        guard let existing = cache[syncId], !existing.deleted else { return nil }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let tombstone = BookSnippet(
            syncId: existing.syncId,
            text: existing.text,
            bookId: existing.bookId,
            bookTitle: existing.bookTitle,
            author: existing.author,
            isbn: existing.isbn,
            format: existing.format,
            locator: existing.locator,
            createdAt: existing.createdAt,
            updatedAt: now,
            deleted: true
        )
        cache[syncId] = tombstone
        flush()
        return tombstone
    }

    func persist() {
        flush()
    }

    static func parseRemote(_ json: [String: Any]) -> BookSnippet? {
        let syncId = (json["syncId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? (json["id"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        guard let syncId else { return nil }
        let text = (json["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !text.isEmpty else { return nil }
        guard let bookId = json["bookId"] as? String, !bookId.isEmpty else { return nil }
        let bookTitle = (json["bookTitle"] as? String)
            ?? (json["title"] as? String)
            ?? ""
        let formatRaw = json["format"] as? String ?? BookFormat.epub.rawValue
        let format = BookFormat(rawValue: formatRaw) ?? .epub
        let createdAt = int64(json["createdAt"]) ?? 0
        let updatedAt = int64(json["updatedAt"]) ?? int64(json["lastSeenAt"]) ?? createdAt
        return BookSnippet(
            syncId: syncId.lowercased(),
            text: text,
            bookId: bookId,
            bookTitle: bookTitle,
            author: json["author"] as? String ?? "",
            isbn: json["isbn"] as? String,
            format: format,
            locator: json["locator"] as? String ?? "",
            createdAt: createdAt,
            updatedAt: updatedAt,
            deleted: json["deleted"] as? Bool ?? false
        )
    }

    private static func int64(_ value: Any?) -> Int64? {
        if let value = value as? Int64 { return value }
        if let value = value as? Int { return Int64(value) }
        if let value = value as? Double { return Int64(value) }
        if let value = value as? NSNumber { return value.int64Value }
        if let value = value as? String { return Int64(value) }
        return nil
    }

    private func flush() {
        fileStore.save("book_snippets.json", value: Array(cache.values))
    }
}
