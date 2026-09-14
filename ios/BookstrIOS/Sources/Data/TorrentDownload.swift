import Foundation
import CryptoKit
import Combine
#if canImport(TorrentEngine)
import TorrentEngine
#endif

struct TorrentEdition: Codable {
    let md5: String
    let catalogID: Int
    let expectedSize: Int64?
    let collection: String
    var metadataURL: URL { metadataURLs[0] }
    var metadataURLs: [URL] {
        let collections = collection.isEmpty ? ["nonfiction", "fiction", "comics"] : [collection]
        return collections.map { kind in
            let batch = catalogID / 1000 * 1000
            let folder = kind == "fiction" ? "libgen_rs_fic" : kind == "comics" ? "libgen_li_comics" : "libgen_rs_non_fic"
            let prefix = kind == "fiction" ? "f_" : kind == "comics" ? "c_" : "r_"
            let number = kind == "nonfiction" && batch == 0 ? "000" : String(batch)
            return URL(string: "https://annas-archive.gl/dyn/small_file/torrents/external/\(folder)/\(prefix)\(number).torrent")!
        }
    }
    init(record: [String: Any], expectedMD5: String) throws {
        guard expectedMD5.count == 32, expectedMD5.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              (record["md5"] as? String)?.lowercased() == expectedMD5,
              let value = record["libgen_id"] ?? record["id"],
              let id = Int(String(describing: value)), id > 0, id < 9_007_199_254_740_991 else {
            throw TorrentDownloadError.invalidEdition
        }
        let kind = (record["collection"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard ["", "nonfiction", "fiction", "comics"].contains(kind) else { throw TorrentDownloadError.invalidEdition }
        collection = kind
        md5 = expectedMD5; catalogID = id
        let rawSize = record["filesize_bytes"] ?? record["filesize"]
        if let rawSize, let size = Int64(String(describing: rawSize)), size != 0 {
            guard size > 0, size <= 8 * 1024 * 1024 * 1024 else { throw TorrentDownloadError.invalidEdition }
            expectedSize = size
        } else { expectedSize = nil }
    }
}

enum TorrentDownloadError: LocalizedError {
    case invalidEdition, invalidMetadata, busy, unsafePath, verification, engine(String)
    var errorDescription: String? {
        switch self {
        case .invalidEdition: return "This edition has no valid torrent metadata."
        case .invalidMetadata: return "Could not load this edition’s torrent. Tap the book to retry."
        case .busy: return "This book is already downloading."
        case .unsafePath: return "The torrent returned an invalid file path."
        case .verification: return "The downloaded file does not match this edition. Tap the book to retry."
        case .engine(let message): return message
        }
    }
}

protocol BookTorrentEngine: AnyObject {
    func start(metadata: Data, md5: String) throws
    func snapshot() -> [String: Any]
    func setActive(_ active: Bool)
    func stop()
}

#if canImport(TorrentEngine)
final class NativeBookTorrentEngine: BookTorrentEngine {
    private let engine: BTTorrentSession
    private let queue = DispatchQueue(label: "app.bookstr.torrent-engine")
    init(root: URL) { engine = BTTorrentSession(root: root.path) }
    func start(metadata: Data, md5: String) throws { try queue.sync { try engine.startTorrent(metadata, expectedMD5: md5) } }
    func snapshot() -> [String: Any] { queue.sync { engine.snapshot() } }
    func setActive(_ active: Bool) { queue.sync { engine.setActive(active) } }
    func stop() { queue.sync { engine.stop() } }
}
#endif

actor ForegroundTorrentDownloader {
#if canImport(TorrentEngine)
    static let shared = ForegroundTorrentDownloader(
        root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("bookstr-torrents"),
        makeEngine: { NativeBookTorrentEngine(root: $0) })
#endif
    private let root: URL
    private let makeEngine: (URL) -> BookTorrentEngine
    private let fetch: (URL) async throws -> Data
    private let sleep: () async throws -> Void
    private var engines: [String: BookTorrentEngine] = [:]
    private var active = false

    init(root: URL, makeEngine: @escaping (URL) -> BookTorrentEngine,
         fetch: @escaping (URL) async throws -> Data = { try await ForegroundTorrentDownloader.fetchMetadata($0) },
         sleep: @escaping () async throws -> Void = { try await Task.sleep(nanoseconds: 500_000_000) }) {
        self.root = root; self.makeEngine = makeEngine; self.fetch = fetch; self.sleep = sleep
    }
    func setActive(_ value: Bool) {
        active = value
        for engine in engines.values { engine.setActive(value) }
    }

    func download(_ edition: TorrentEdition, progress: (String) -> Void) async throws -> URL {
        guard engines[edition.md5] == nil else { throw TorrentDownloadError.busy }
        defer { engines.removeValue(forKey: edition.md5)?.stop() }
        let directory = root.appendingPathComponent(edition.md5, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let metadataFile = directory.appendingPathComponent("book.torrent")
        let driver = makeEngine(directory); engines[edition.md5] = driver
        driver.setActive(active)
        var started = false
        if let cached = try? Data(contentsOf: metadataFile), !cached.isEmpty {
            do { try driver.start(metadata: cached, md5: edition.md5); started = true }
            catch { try? FileManager.default.removeItem(at: metadataFile) }
        }
        if !started {
            var lastError: Error = TorrentDownloadError.invalidMetadata
            for url in edition.metadataURLs {
                try Task.checkCancellation()
                progress("Finding torrent…")
                let metadata: Data
                do {
                    metadata = try await fetch(url)
                    guard !metadata.isEmpty, metadata.count <= 16 * 1024 * 1024, metadata.first == 100 else { throw TorrentDownloadError.invalidMetadata }
                } catch {
                    if error is CancellationError { throw error }
                    lastError = error
                    continue
                }
                do { try driver.start(metadata: metadata, md5: edition.md5) }
                catch {
                    let native = error as NSError
                    // Older catalogs omit collection. Only try another collection
                    // when the exact MD5 is absent, never after a validation error.
                    guard native.domain == "BookstrTorrent", native.code == 2 else { throw error }
                    lastError = error
                    continue
                }
                try metadata.write(to: metadataFile, options: .atomic)
                started = true
                break
            }
            if !started { throw lastError }
        }
        while true {
            try Task.checkCancellation()
            let status = driver.snapshot()
            switch status["state"] as? String {
            case "ready":
                guard let raw = status["path"] as? String else { throw TorrentDownloadError.unsafePath }
                let file = URL(fileURLWithPath: raw).resolvingSymlinksInPath()
                let realDirectory = directory.resolvingSymlinksInPath().path + "/"
                guard file.path.hasPrefix(realDirectory) else { throw TorrentDownloadError.unsafePath }
                progress("Verifying…")
                driver.setActive(false)
                do {
                    try await Task.detached(priority: .userInitiated) { try Self.verify(file, edition: edition) }.value
                } catch {
                    // Invalid bytes cannot be reused on retry; valid partials
                    // are retained on cancellation and foreground transitions.
                    driver.stop()
                    engines.removeValue(forKey: edition.md5)
                    try? FileManager.default.removeItem(at: file)
                    try? FileManager.default.removeItem(at: directory.appendingPathComponent("resume.dat"))
                    throw error
                }
                return file
            case "failed": throw TorrentDownloadError.engine(status["error"] as? String ?? "Torrent download failed. Tap the book to retry.")
            default:
                if !active { progress("Paused · reopen the app to resume") }
                else {
                    let done = (status["bytes"] as? NSNumber)?.doubleValue ?? 0
                    let total = (status["size"] as? NSNumber)?.doubleValue ?? 0
                    if done > 0, total > 0 { progress("Downloading · \(min(100, Int(done / total * 100)))% · \(ByteCountFormatter.string(fromByteCount: Int64(done), countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: Int64(total), countStyle: .file)) · \((status["peers"] as? NSNumber)?.intValue ?? 0) peers") }
                    else { progress("Finding peers…") }
                }
            }
            try await sleep()
        }
    }
    static func verify(_ file: URL, edition: TorrentEdition) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber, size.int64Value > 0,
              size.int64Value <= 8 * 1024 * 1024 * 1024,
              edition.expectedSize == nil || edition.expectedSize == size.int64Value else { throw TorrentDownloadError.verification }
        let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
        var hash = Insecure.MD5()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hash.update(data: data) }
        guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == edition.md5 else { throw TorrentDownloadError.verification }
    }
    static func fetchMetadata(_ url: URL, session: URLSession = .shared) async throws -> Data {
        var request = URLRequest(url: url); request.timeoutInterval = 60
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              response.expectedContentLength <= 16 * 1024 * 1024 else { throw TorrentDownloadError.invalidMetadata }
        var result = Data()
        for try await byte in bytes {
            guard result.count < 16 * 1024 * 1024 else { throw TorrentDownloadError.invalidMetadata }
            result.append(byte)
        }
        return result
    }
}

/// Keeps each transfer alive independently of Search, and restores unfinished
/// downloads from an atomic manifest on the next app launch.
final class BookDownloadQueue: ObservableObject {
    struct Job: Identifiable, Codable {
        let result: BookSearchResult
        var id: String { result.id }
        var status = "Starting…"
        var book: CatalogBook?
        var failed = false
    }
    typealias Prepare = (BookSearchResult, @escaping (String) -> Void) async throws -> CatalogBook
    @Published private(set) var jobs: [Job] = []
    @Published private(set) var persistenceError: String?
    private let fileURL: URL?
    private var tasks: [String: Task<Void, Never>] = [:]

    init(fileURL: URL? = nil) {
        self.fileURL = fileURL
        guard let fileURL, FileManager.default.fileExists(atPath: fileURL.path) else { return }
        do { jobs = try JSONDecoder().decode([Job].self, from: Data(contentsOf: fileURL)) }
        catch { persistenceError = "Could not restore downloads: \(error.localizedDescription)" }
    }

    @MainActor func resume(prepare: @escaping Prepare) {
        for job in jobs where job.book == nil && !job.failed {
            start(job.result, prepare: prepare)
        }
    }

    @MainActor func enqueue(_ result: BookSearchResult, prepare: @escaping Prepare) {
        if let index = jobs.firstIndex(where: { $0.id == result.id }) {
            guard tasks[result.id] == nil, jobs[index].book == nil else { return }
            jobs[index] = Job(result: result)
        } else {
            jobs.append(Job(result: result))
        }
        save()
        start(result, prepare: prepare)
    }

    @MainActor private func start(_ result: BookSearchResult, prepare: @escaping Prepare) {
        guard tasks[result.id] == nil else { return }
        tasks[result.id] = Task { @MainActor in
            let index = jobs.firstIndex(where: { $0.id == result.id })!
            jobs[index].status = "Starting…"
            do {
                let book = try await prepare(result) { text in
                    Task { @MainActor in
                        if self.tasks[result.id] != nil {
                            self.jobs[index].status = text
                        }
                    }
                }
                jobs[index].book = book
                jobs[index].status = "Downloaded"
            } catch is CancellationError {
                jobs[index].status = "Paused"
            } catch {
                jobs[index].failed = true
                jobs[index].status = error.localizedDescription
            }
            tasks[result.id] = nil
            save()
        }
    }

    @MainActor private func save() {
        guard let fileURL else { return }
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(jobs).write(to: fileURL, options: .atomic)
            persistenceError = nil
        } catch { persistenceError = "Could not save downloads: \(error.localizedDescription)" }
    }
}
