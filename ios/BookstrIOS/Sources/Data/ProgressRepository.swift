import Foundation

final class ProgressRepository {
    private let fileStore: JSONFileStore
    private var cache: [String: BookProgress]

    init(fileStore: JSONFileStore) {
        self.fileStore = fileStore
        let items = fileStore.load("book_progress.json", as: [BookProgress].self, fallback: [])
        self.cache = Dictionary(uniqueKeysWithValues: items.map { ($0.bookId, $0) })
    }

    func all() -> [BookProgress] {
        cache.values.sorted { $0.updatedAt > $1.updatedAt }
    }

    func get(bookId: String) -> BookProgress {
        cache[bookId] ?? BookProgress(bookId: bookId, progression: 0, cfi: "", updatedAt: 0)
    }

    func save(bookId: String, progression: Double, cfi: String) {
        merge(
            bookId: bookId,
            progression: progression,
            cfi: cfi,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000),
            onlyIfNewer: false
        )
    }

    @discardableResult
    func mergeRemote(bookId: String, progression: Double, cfi: String, updatedAt: Int64) -> Bool {
        let milliseconds = updatedAt < 10_000_000_000 ? updatedAt * 1_000 : updatedAt
        return merge(
            bookId: bookId,
            progression: progression,
            cfi: cfi,
            updatedAt: milliseconds,
            onlyIfNewer: true
        )
    }

    @discardableResult
    private func merge(
        bookId: String,
        progression: Double,
        cfi: String,
        updatedAt: Int64,
        onlyIfNewer: Bool
    ) -> Bool {
        if let current = cache[bookId] {
            if onlyIfNewer, current.updatedAt > updatedAt { return false }
            if current.progression == progression,
               current.cfi == cfi,
               current.updatedAt == updatedAt {
                return false
            }
        }
        cache[bookId] = BookProgress(
            bookId: bookId,
            progression: progression,
            cfi: cfi,
            updatedAt: updatedAt
        )
        fileStore.save("book_progress.json", value: Array(cache.values))
        return true
    }
}
