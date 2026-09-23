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

    func publicationFiles() -> [URL] {
        let dir = root.appendingPathComponent("books", isDirectory: true)
        return (try? FileManager.default.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        )) ?? []
    }

    private var coversDirectory: URL {
        root.appendingPathComponent("covers", isDirectory: true)
    }

    func ensureCoversDirectory() {
        try? FileManager.default.createDirectory(at: coversDirectory, withIntermediateDirectories: true)
    }

    func coverFileURL(bookId: String, ext: String) -> URL {
        coversDirectory.appendingPathComponent("\(bookId).\(ext)")
    }

    func discoveredCoverFileURL(key: String) -> URL {
        let directory = root.appendingPathComponent("discovered-covers", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("\(key).jpg")
    }

    func discoveredCoverURLs() -> [String: URL] {
        let directory = root.appendingPathComponent("discovered-covers", isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey])) ?? []
        return Dictionary(uniqueKeysWithValues: files.filter { $0.pathExtension == "jpg" }.map {
            ($0.deletingPathExtension().lastPathComponent, $0)
        })
    }

    /// Lowercased book id → cached cover file URL, loaded in one directory
    /// scan so list builds never stat per book.
    func cachedCoverURLs() -> [String: URL] {
        let files = (try? FileManager.default.contentsOfDirectory(at: coversDirectory, includingPropertiesForKeys: nil)) ?? []
        return Dictionary(
            files.map { ($0.deletingPathExtension().lastPathComponent.lowercased(), $0) },
            uniquingKeysWith: { first, _ in first }
        )
    }
}
