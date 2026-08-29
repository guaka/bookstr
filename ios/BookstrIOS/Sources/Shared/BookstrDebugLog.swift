import Foundation

struct BookstrDebugLogEntry: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    let at: Date
    let category: String
    let message: String

    init(id: UUID = UUID(), at: Date = Date(), category: String, message: String) {
        self.id = id
        self.at = at
        self.category = category
        self.message = message
    }
}

/// In-app ring of recent debug lines with time and count caps.
final class BookstrDebugLog: @unchecked Sendable {
    static let shared = BookstrDebugLog()
    static let speech = "speech"
    static let retentionInterval: TimeInterval = 36 * 60 * 60
    static let maxEntries = 400

    private let lock = NSLock()
    private let store: JSONFileStore
    private let filename: String
    private var entries: [BookstrDebugLogEntry]
    private let retention: TimeInterval
    private let capacity: Int

    init(
        store: JSONFileStore = JSONFileStore(subdirectory: "bookstr/debug"),
        filename: String = "debug-log.json",
        retention: TimeInterval = BookstrDebugLog.retentionInterval,
        capacity: Int = BookstrDebugLog.maxEntries,
        seed: [BookstrDebugLogEntry] = []
    ) {
        self.store = store
        self.filename = filename
        self.retention = retention
        self.capacity = max(1, capacity)
        if seed.isEmpty {
            entries = store.load(filename, as: [BookstrDebugLogEntry].self, fallback: [])
            pruneLocked(now: Date())
            persistLocked()
        } else {
            entries = seed
        }
    }

    func record(_ message: String, category: String = BookstrDebugLog.speech, now: Date = Date()) {
        lock.lock()
        defer { lock.unlock() }
        entries.append(BookstrDebugLogEntry(at: now, category: category, message: message))
        pruneLocked(now: now)
        persistLocked()
    }

    func snapshot(category: String? = nil) -> [BookstrDebugLogEntry] {
        lock.lock()
        defer { lock.unlock() }
        pruneLocked(now: Date())
        persistLocked()
        guard let category else { return entries }
        return entries.filter { $0.category == category }
    }

    func exportText(category: String? = nil) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return snapshot(category: category).map { entry in
            "\(formatter.string(from: entry.at)) [\(entry.category)] \(entry.message)"
        }.joined(separator: "\n")
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        entries.removeAll()
        persistLocked()
    }

    private func pruneLocked(now: Date) {
        let cutoff = now.addingTimeInterval(-retention)
        entries.removeAll { $0.at < cutoff }
        if entries.count > capacity {
            entries.removeFirst(entries.count - capacity)
        }
    }

    private func persistLocked() {
        store.save(filename, value: entries)
    }
}
