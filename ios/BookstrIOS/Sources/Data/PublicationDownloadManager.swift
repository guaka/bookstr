import Foundation
import CryptoKit

// URLSession owns in-progress network transfers. Small durable receipts let a
// later app launch consume a finished download even if its original task died.
final class PublicationDownloadManager: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    static let identifier = "app.bookstr.publication-downloads"
    static let shared = PublicationDownloadManager(
        directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("bookstr-transfer-downloads"))

    struct Receipt: Codable {
        var url: String
        var status: Int?
        var error: String?
    }
    private let directory: URL
    private let lock = NSLock()
    private var receipts: [String: Receipt] = [:]
    private var waiters: [String: [CheckedContinuation<(URL, URLResponse), Error>]] = [:]
    private var session: URLSession!
    private var backgroundCompletion: (() -> Void)?

    init(directory: URL, configuration: URLSessionConfiguration? = nil) {
        self.directory = directory
        if let data = try? Data(contentsOf: directory.appendingPathComponent("receipts.json")),
           let saved = try? JSONDecoder().decode([String: Receipt].self, from: data) { receipts = saved }
        super.init()
        let config: URLSessionConfiguration
        if let configuration { config = configuration }
        else {
#if os(iOS)
            config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
            config.sessionSendsLaunchEvents = true
#else
            config = URLSessionConfiguration.default
#endif
            config.isDiscretionary = false
            config.waitsForConnectivity = true
            config.timeoutIntervalForResource = 24 * 60 * 60
        }
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    private func save() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(receipts).write(to: directory.appendingPathComponent("receipts.json"), options: .atomic)
    }
    private func file(_ id: String) -> URL { directory.appendingPathComponent(id + ".download") }
    private static func key(_ url: URL) -> String {
        SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func result(_ id: String) throws -> (URL, URLResponse) {
        guard let receipt = receipts[id], let status = receipt.status, let url = URL(string: receipt.url),
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else { throw URLError(.badServerResponse) }
        // Each caller owns its temporary copy; concurrent readers never race to
        // move the same file into their library.
        let copy = directory.appendingPathComponent(UUID().uuidString + ".tmp")
        try FileManager.default.copyItem(at: file(id), to: copy)
        return (copy, response)
    }
    func download(for request: URLRequest) async throws -> (URL, URLResponse) {
        guard let url = request.url, ["http", "https"].contains(url.scheme) else { throw URLError(.unsupportedURL) }
        let tasks = await session.allTasks
        return try await withCheckedThrowingContinuation { continuation in
            lock.lock(); defer { lock.unlock() }
            let id = Self.key(url)
            if receipts[id]?.status != nil, FileManager.default.fileExists(atPath: file(id).path) {
                continuation.resume(with: Result { try result(id) })
                return
            }
            waiters[id, default: []].append(continuation)
            if let task = tasks.first(where: { $0.taskDescription == id }), task.state != .completed && task.state != .canceling {
                task.resume()
                return
            }
            // A second caller may have queried allTasks before the first task
            // was registered. A waiter already in this process owns that start.
            if waiters[id]!.count > 1 { return }
            receipts[id] = Receipt(url: url.absoluteString)
            do {
                try save()
                let task = session.downloadTask(with: request)
                task.taskDescription = id
                task.resume()
            } catch { finish(id, error: error) }
        }
    }
    // Called after verification/import. A failed verification must also discard
    // the receipt, otherwise retries would reuse corrupt bytes indefinitely.
    func discard(_ url: URL) {
        lock.lock(); defer { lock.unlock() }
        let id = Self.key(url)
        receipts.removeValue(forKey: id)
        try? FileManager.default.removeItem(at: file(id))
        try? save()
    }
    private func finish(_ id: String, error: Error? = nil) {
        let pending = waiters.removeValue(forKey: id) ?? []
        for waiter in pending {
            if let error { waiter.resume(throwing: error) }
            else { waiter.resume(with: Result { try result(id) }) }
        }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = downloadTask.taskDescription else { return }
        lock.lock(); defer { lock.unlock() }
        guard var receipt = receipts[id], let response = downloadTask.response as? HTTPURLResponse else {
            finish(id, error: URLError(.badServerResponse)); return
        }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: file(id).path) { try FileManager.default.removeItem(at: file(id)) }
            try FileManager.default.moveItem(at: location, to: file(id))
            receipt.status = response.statusCode
            receipts[id] = receipt
            try save()
            finish(id)
        } catch { finish(id, error: error) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, let id = task.taskDescription else { return }
        lock.lock(); defer { lock.unlock() }
        receipts[id]?.error = error.localizedDescription
        try? save()
        finish(id, error: error)
    }
    func handleBackgroundEvents(completion: @escaping () -> Void) {
        lock.lock(); defer { lock.unlock() }
        backgroundCompletion = completion
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        lock.lock()
        let completion = backgroundCompletion
        backgroundCompletion = nil
        lock.unlock()
        DispatchQueue.main.async { completion?() }
    }
    func invalidate() { session.invalidateAndCancel() }
}
