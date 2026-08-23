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
        cache[bookId] = BookProgress(
            bookId: bookId,
            progression: progression,
            cfi: cfi,
            updatedAt: Int64(Date().timeIntervalSince1970 * 1000)
        )
        fileStore.save("book_progress.json", value: Array(cache.values))
    }
}
