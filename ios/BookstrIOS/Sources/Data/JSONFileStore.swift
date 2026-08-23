import Foundation

final class JSONFileStore {
    private let root: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(subdirectory: String) {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent(subdirectory, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.root = dir
    }

    func load<T: Decodable>(_ filename: String, as type: T.Type, fallback: T) -> T {
        let url = root.appendingPathComponent(filename)
        guard let data = try? Data(contentsOf: url), let value = try? decoder.decode(type, from: data) else {
            return fallback
        }
        return value
    }

    func save<T: Encodable>(_ filename: String, value: T) {
        let url = root.appendingPathComponent(filename)
        guard let data = try? encoder.encode(value) else { return }
        try? data.write(to: url, options: .atomic)
    }

    func bookFileURL(bookId: String, format: BookFormat) -> URL {
        root.appendingPathComponent("books", isDirectory: true).appendingPathComponent("\(bookId).\(format.rawValue)")
    }

    func ensureBooksDirectory() {
        let dir = root.appendingPathComponent("books", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
}
