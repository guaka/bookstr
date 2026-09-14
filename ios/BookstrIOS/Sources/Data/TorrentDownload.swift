import Foundation
import CryptoKit
import Combine
#if canImport(TorrentEngine)
import TorrentEngine
#endif

struct TorrentEdition {
    let md5: String
    let catalogID: Int
    let expectedSize: Int64?
    var metadataURL: URL {
        URL(string: "https://annas-archive.gl/dyn/small_file/torrents/external/libgen_rs_non_fic/r_\(catalogID / 1000 * 1000).torrent")!
    }
    init(record: [String: Any], expectedMD5: String) throws {
        guard expectedMD5.count == 32, expectedMD5.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              (record["md5"] as? String)?.lowercased() == expectedMD5,
              let value = record["id"] ?? record["libgen_id"],
              let id = Int(String(describing: value)), id > 0, id < 9_007_199_254_740_991 else {
            throw TorrentDownloadError.invalidEdition
        }
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
        case .busy: return "Another book is downloading."
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
    private var engine: BookTorrentEngine?
    private var active = false
    private var downloading = false

    init(root: URL, makeEngine: @escaping (URL) -> BookTorrentEngine,
         fetch: @escaping (URL) async throws -> Data = { try await ForegroundTorrentDownloader.fetchMetadata($0) },
         sleep: @escaping () async throws -> Void = { try await Task.sleep(nanoseconds: 500_000_000) }) {
        self.root = root; self.makeEngine = makeEngine; self.fetch = fetch; self.sleep = sleep
    }
    func setActive(_ value: Bool) { active = value; engine?.setActive(value) }

    func download(_ edition: TorrentEdition, progress: (String) -> Void) async throws -> URL {
        guard !downloading else { throw TorrentDownloadError.busy }
        downloading = true
        defer { engine?.stop(); engine = nil; downloading = false }
        let directory = root.appendingPathComponent(edition.md5, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let metadataFile = directory.appendingPathComponent("book.torrent")
        let metadata: Data
        if let cached = try? Data(contentsOf: metadataFile), !cached.isEmpty { metadata = cached }
        else {
            progress("Finding torrent…")
            metadata = try await fetch(edition.metadataURL)
            guard !metadata.isEmpty, metadata.count <= 16 * 1024 * 1024, metadata.first == 100 else { throw TorrentDownloadError.invalidMetadata }
            try metadata.write(to: metadataFile, options: .atomic)
        }
        let driver = makeEngine(directory); engine = driver
        driver.setActive(active)
        do { try driver.start(metadata: metadata, md5: edition.md5) }
        catch { try? FileManager.default.removeItem(at: metadataFile); throw error }
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
                    engine = nil
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

/// Owns transfers independently of Search's view lifetime. Downloads run serially
/// because the native engine selects one edition at a time.
final class BookDownloadQueue: ObservableObject {
    struct Job: Identifiable {
        let result: BookSearchResult
        var id: String { result.id }
        var status = "Queued"
        var book: CatalogBook?
        var failed = false
    }
    @Published private(set) var jobs: [Job] = []
    private var worker: Task<Void, Never>?

    @MainActor func enqueue(_ result: BookSearchResult, prepare: @escaping (BookSearchResult, @escaping (String) -> Void) async throws -> CatalogBook) {
        if let index = jobs.firstIndex(where: { $0.id == result.id }) {
            guard jobs[index].failed else { return }
            jobs[index] = Job(result: result)
        } else {
            jobs.append(Job(result: result))
        }
        guard worker == nil else { return }
        worker = Task { @MainActor in
            while let index = jobs.firstIndex(where: { $0.book == nil && !$0.failed }) {
                let id = jobs[index].id
                jobs[index].status = "Starting…"
                do {
                    let book = try await prepare(jobs[index].result) { text in
                        Task { @MainActor in
                            if let current = self.jobs.firstIndex(where: { $0.id == id }), self.jobs[current].book == nil, !self.jobs[current].failed {
                                self.jobs[current].status = text
                            }
                        }
                    }
                    jobs[index].book = book
                    jobs[index].status = "Downloaded"
                } catch {
                    jobs[index].failed = true
                    jobs[index].status = error.localizedDescription
                }
            }
            worker = nil
        }
    }
}
