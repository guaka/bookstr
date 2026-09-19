import XCTest
import CryptoKit
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class TorrentDownloadTests: XCTestCase {
    func zlibRecord(filename: String = "123", torrent: String = "pilimi-zlib-0-119999.torrent") -> [String: Any] {
        ["md5": String(repeating: "a", count: 32), "id": 0, "collection": "zlib", "torrent": [
            "filename": filename,
            "metadata_url": "https://annas-archive.gl/dyn/small_file/torrents/managed_by_aa/zlib/" + torrent]]
    }

    func testZlibEditionValidatesSeparateFileLocator() throws {
        let hash = String(repeating: "a", count: 32)
        let edition = try TorrentEdition(record: zlibRecord(), expectedMD5: hash)
        XCTAssertEqual(edition.catalogID, 123)
        XCTAssertEqual(edition.selectedFilename, "123")
        XCTAssertEqual(edition.metadataURLs, [edition.zlibMetadataURL!])
        XCTAssertEqual(edition.md5, hash)
        for filename in ["0", "-1", "0123", "../123", "120000", "9007199254740991", "999999999999999999999999999"] {
            XCTAssertThrowsError(try TorrentEdition(record: zlibRecord(filename: filename), expectedMD5: hash))
        }
        for name in ["pilimi-zlib2-0-119999.torrent", "../pilimi-zlib-0-119999.torrent", "pilimi-zlib-0-119999.torrent?x=1", "pilimi-zlib-200-300.torrent", "pilimi-zlib-200-100.torrent", "pilimi-zlib-0-999999999999999999999999.torrent", "pilimi-zlib-999999999999999999999999-999999999999999999999999.torrent"] {
            XCTAssertThrowsError(try TorrentEdition(record: zlibRecord(torrent: name), expectedMD5: hash))
        }
        var missing = zlibRecord(); missing.removeValue(forKey: "torrent")
        XCTAssertThrowsError(try TorrentEdition(record: missing, expectedMD5: hash))
        for locator: [String: Any] in [[:], ["filename": "123"], ["filename": "123", "metadata_url": "https://evil.test/pilimi-zlib-0-119999.torrent"], ["filename": "123", "metadata_url": "http://["]] {
            var invalid = zlibRecord(); invalid["torrent"] = locator
            XCTAssertThrowsError(try TorrentEdition(record: invalid, expectedMD5: hash))
        }
        XCTAssertThrowsError(try Engine().start(metadata: Data("de".utf8), md5: hash, filename: "123"))
    }
    @MainActor
    func testQueueContinuesAfterFailureAndRetriesWithoutDuplicating() async throws {
        let queue = BookDownloadQueue()
        func result(_ id: String) -> BookSearchResult {
            BookSearchResult(id: id, source: "test", title: id, author: "Author", year: nil,
                publisher: nil, language: nil, format: .pdf, downloadUrl: "https://example.test/book.pdf",
                coverUrl: nil, rating: 0, editionCount: 1)
        }
        var started: [String] = []
        let prepare: (BookSearchResult, @escaping (String) -> Void) async throws -> CatalogBook = { result, progress in
            started.append(result.id)
            progress("Finding peers…")
            try await Task.sleep(nanoseconds: 10_000_000)
            if result.id == "first" { throw TorrentDownloadError.invalidMetadata }
            return result.asCatalogBook()!
        }
        queue.enqueue(result("first"), prepare: prepare)
        queue.enqueue(result("first"), prepare: prepare)
        queue.enqueue(result("second"), prepare: prepare)
        XCTAssertEqual(queue.jobs.map(\.id), ["second", "first"])
        XCTAssertEqual(queue.jobs.map(\.status), ["Starting…", "Starting…"])
        for _ in 0..<100 where queue.jobs.first(where: { $0.id == "second" })?.book == nil { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(Set(started), ["first", "second"])
        XCTAssertTrue(queue.jobs.first(where: { $0.id == "first" })!.failed)
        XCTAssertEqual(queue.jobs.first(where: { $0.id == "second" })!.status, "Downloaded")
        queue.enqueue(result("first")) { result, _ in result.asCatalogBook()! }
        XCTAssertEqual(queue.jobs.map(\.id), ["first", "second"])
        for _ in 0..<100 where queue.jobs.first(where: { $0.id == "first" })?.book == nil { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(queue.jobs.count, 2)
        XCTAssertEqual(queue.jobs.first?.status, "Downloaded")
        XCTAssertNotNil(queue.jobs.first?.completedAt)
    }

    @MainActor
    func testCompletedDownloadsPruneAfterRetentionAndCanBeDismissed() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let manifest = root.appendingPathComponent("downloads.json")
        let clock = Date(timeIntervalSince1970: 1_700_000_000)
        func result(_ id: String) -> BookSearchResult {
            BookSearchResult(id: id, source: "test", title: id, author: "Author", year: nil,
                publisher: nil, language: nil, format: .pdf, downloadUrl: "https://example.test/book.pdf",
                coverUrl: nil, rating: 0, editionCount: 1)
        }
        func job(_ id: String, book: Bool = false, failed: Bool = false, completedAt: Date? = nil) -> BookDownloadQueue.Job {
            var item = BookDownloadQueue.Job(result: result(id))
            if book {
                item.book = result(id).asCatalogBook()
                item.status = "Downloaded"
                item.completedAt = completedAt
            }
            if failed {
                item.failed = true
                item.status = "boom"
            }
            return item
        }
        let seed = [
            job("fresh", book: true, completedAt: clock),
            job("stale", book: true, completedAt: clock.addingTimeInterval(-(BookDownloadQueue.completedRetention + 1))),
            job("failed", failed: true),
            job("active"),
        ]
        try JSONEncoder().encode(seed).write(to: manifest, options: .atomic)

        let queue = BookDownloadQueue(fileURL: manifest, now: { clock })
        XCTAssertEqual(Set(queue.jobs.map(\.id)), ["fresh", "failed", "active"], "Stale completed rows prune on restore")

        XCTAssertEqual(queue.pruneCompleted(now: clock.addingTimeInterval(BookDownloadQueue.completedRetention + 1)), 1)
        XCTAssertEqual(Set(queue.jobs.map(\.id)), ["failed", "active"])

        queue.dismiss("failed")
        XCTAssertEqual(queue.jobs.map(\.id), ["active"])
        queue.dismiss("active")
        XCTAssertEqual(queue.jobs.map(\.id), ["active"], "In-progress jobs cannot be dismissed")

        // Legacy completed rows without completedAt drop on restore.
        try JSONEncoder().encode([job("legacy", book: true)]).write(to: manifest, options: .atomic)
        let restored = BookDownloadQueue(fileURL: manifest, now: { clock })
        XCTAssertTrue(restored.jobs.isEmpty)
        let saved = try JSONDecoder().decode([BookDownloadQueue.Job].self, from: Data(contentsOf: manifest))
        XCTAssertTrue(saved.isEmpty)
    }

    @MainActor
    func testConcurrentDownloadsPersistAndResumeOnlyUnfinishedBooks() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let manifest = root.appendingPathComponent("downloads.json")
        let downloads = BookDownloadQueue(fileURL: manifest)
        func result(_ id: String) -> BookSearchResult {
            BookSearchResult(id: id, source: "test", title: id, author: "Author", year: nil,
                publisher: nil, language: nil, format: .pdf, downloadUrl: "https://example.test/book.pdf",
                coverUrl: nil, rating: 0, editionCount: 1)
        }
        var pending: [String: CheckedContinuation<CatalogBook, Error>] = [:]
        let prepare: BookDownloadQueue.Prepare = { result, progress in
            progress("Finding peers…")
            return try await withCheckedThrowingContinuation { pending[result.id] = $0 }
        }
        downloads.enqueue(result("first"), prepare: prepare)
        downloads.enqueue(result("second"), prepare: prepare)
        XCTAssertEqual(downloads.jobs.map(\.id), ["second", "first"])
        downloads.resume(prepare: prepare)
        for _ in 0..<100 where pending.count < 2 { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(Set(pending.keys), ["first", "second"], "Both must start before either finishes")
        let saved = try JSONDecoder().decode([BookDownloadQueue.Job].self, from: Data(contentsOf: manifest))
        XCTAssertEqual(saved.map(\.result.author), ["Author", "Author"])
        XCTAssertTrue(saved.allSatisfy { $0.book == nil })
        pending["first"]!.resume(returning: result("first").asCatalogBook()!)
        pending["second"]!.resume(throwing: CancellationError())
        for _ in 0..<100 where downloads.jobs.first(where: { $0.id == "second" })?.status != "Paused" { try await Task.sleep(nanoseconds: 10_000_000) }
        let restored = BookDownloadQueue(fileURL: manifest)
        XCTAssertEqual(restored.jobs.map(\.id), ["second", "first"])
        XCTAssertEqual(restored.jobs.first(where: { $0.id == "first" })?.status, "Downloaded")
        XCTAssertEqual(restored.jobs.first(where: { $0.id == "second" })?.status, "Paused")
        var resumed: [String] = []
        restored.resume { result, _ in resumed.append(result.id); return result.asCatalogBook()! }
        restored.resume { _, _ in XCTFail("Duplicate resume"); throw CancellationError() }
        for _ in 0..<100 where restored.jobs.first(where: { $0.id == "second" })?.book == nil { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(resumed, ["second"])
        restored.enqueue(result("first")) { _, _ in XCTFail("Completed book restarted"); throw CancellationError() }
        XCTAssertTrue(BookDownloadQueue(fileURL: manifest).jobs.allSatisfy { $0.book != nil })
        XCTAssertNil(restored.persistenceError)

        try Data("invalid json".utf8).write(to: manifest)
        XCTAssertNotNil(BookDownloadQueue(fileURL: manifest).persistenceError)
        let cannotSave = BookDownloadQueue(fileURL: manifest.appendingPathComponent("child.json"))
        cannotSave.enqueue(result("failed")) { _, _ in throw TorrentDownloadError.invalidEdition }
        for _ in 0..<100 where !cannotSave.jobs[0].failed { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertNotNil(cannotSave.persistenceError)
        cannotSave.resume { _, _ in XCTFail("Failed job must wait for retry"); throw CancellationError() }
    }

    func testTorrentSessionsRunIndependentlyAndPauseTogether() async throws {
        let (root, _, first) = try fixture()
        let second = try TorrentEdition(record: ["md5": String(repeating: "b", count: 32), "id": 2345], expectedMD5: String(repeating: "b", count: 32))
        let one = Engine(), two = Engine()
        let downloader = ForegroundTorrentDownloader(root: root, makeEngine: { $0.lastPathComponent == first.md5 ? one : two }, fetch: { _ in Data("de".utf8) }, sleep: { try await Task.sleep(nanoseconds: 1_000_000) })
        await downloader.setActive(true)
        let started = expectation(description: "both engines started"); started.expectedFulfillmentCount = 2
        var sawFirst = false, sawSecond = false
        let firstTask = Task { try await downloader.download(first) { text in
            if text == "Finding peers…", !sawFirst { sawFirst = true; started.fulfill() }
        } }
        let secondTask = Task { try await downloader.download(second) { text in
            if text == "Finding peers…", !sawSecond { sawSecond = true; started.fulfill() }
        } }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertEqual(one.starts, 1); XCTAssertEqual(two.starts, 1)
        await downloader.setActive(false)
        XCTAssertEqual(one.active.last, false); XCTAssertEqual(two.active.last, false)
        firstTask.cancel()
        _ = try? await firstTask.value
        XCTAssertEqual(one.stops, 1); XCTAssertEqual(two.stops, 0)
        await downloader.setActive(true)
        XCTAssertEqual(two.active.last, true)
        secondTask.cancel()
        _ = try? await secondTask.value
        XCTAssertEqual(two.stops, 1)
    }

    final class Engine: BookTorrentEngine {
        var states: [[String:Any]] = []
        var active: [Bool] = []
        var starts = 0; var stops = 0
        var startError: Error?
        func start(metadata: Data, md5: String) throws { starts += 1; if let startError { throw startError } }
        func snapshot() -> [String:Any] { states.count > 1 ? states.removeFirst() : states.first ?? ["state":"finding-peers"] }
        func setActive(_ value: Bool) { active.append(value) }
        func stop() { stops += 1 }
    }
    func fixture() throws -> (URL, Data, TorrentEdition) {
        let data = Data("a book downloaded over torrent".utf8)
        let md5 = Insecure.MD5.hash(data:data).map { String(format:"%02x",$0) }.joined()
        let edition = try TorrentEdition(record:["md5":md5,"id":1234,"filesize_bytes":data.count],expectedMD5:md5)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root.appendingPathComponent(md5),withIntermediateDirectories:true)
        addTeardownBlock { try? FileManager.default.removeItem(at:root) }
        return (root,data,edition)
    }
    func testCollectionTorrentURLsAndLegacyCandidateOrder() throws {
        let (_, _, edition) = try fixture()
        for (kind, suffix) in [("nonfiction", "libgen_rs_non_fic/r_1000.torrent"), ("fiction", "libgen_rs_fic/f_1000.torrent"), ("comics", "libgen_li_comics/c_1000.torrent")] {
            let selected = try TorrentEdition(record: ["md5": edition.md5, "id": 1234, "collection": kind], expectedMD5: edition.md5)
            XCTAssertEqual(selected.metadataURLs.count, 1)
            XCTAssertTrue(selected.metadataURL.absoluteString.hasSuffix(suffix))
        }
        XCTAssertEqual(edition.metadataURLs.count, 3)
        XCTAssertThrowsError(try TorrentEdition(record: ["md5": edition.md5, "id": 1234, "collection": "unknown"], expectedMD5: edition.md5))
        let early = try TorrentEdition(record: ["md5": edition.md5, "id": 1234, "libgen_id": 1], expectedMD5: edition.md5)
        XCTAssertTrue(early.metadataURL.absoluteString.hasSuffix("/r_000.torrent"))
    }
    func testMissingCollectionRetriesExactEditionAndReplacesWrongCache() async throws {
        let (root, data, edition) = try fixture()
        let directory = root.appendingPathComponent(edition.md5)
        let file = directory.appendingPathComponent(edition.md5)
        try data.write(to: file)
        try Data("wrong cache".utf8).write(to: directory.appendingPathComponent("book.torrent"))
        let engine = Engine()
        engine.states = [["state": "ready", "path": file.path]]
        engine.startError = NSError(domain: "BookstrTorrent", code: 2)
        var requested: [URL] = []
        let downloader = ForegroundTorrentDownloader(root: root, makeEngine: { _ in engine }, fetch: { url in
            requested.append(url)
            if url.absoluteString.contains("libgen_rs_fic/") { engine.startError = nil }
            return Data("de".utf8)
        })
        _ = try await downloader.download(edition, progress: { _ in })
        XCTAssertEqual(requested, Array(edition.metadataURLs.prefix(2)))
        XCTAssertEqual(engine.starts, 3)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("book.torrent")), Data("de".utf8))
        let cancelled = ForegroundTorrentDownloader(root: root.appendingPathComponent("cancel"), makeEngine: { _ in Engine() }, fetch: { _ in throw CancellationError() })
        do { _ = try await cancelled.download(edition, progress: { _ in }); XCTFail("Expected cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
        let absent = Engine(); absent.startError = NSError(domain: "BookstrTorrent", code: 2)
        let missing = ForegroundTorrentDownloader(root: root.appendingPathComponent("absent"), makeEngine: { _ in absent }, fetch: { _ in Data("de".utf8) })
        do { _ = try await missing.download(edition, progress: { _ in }); XCTFail("Expected absent edition") }
        catch { XCTAssertEqual((error as NSError).code, 2) }
        XCTAssertEqual(absent.starts, 3)
    }

    func testEditionIdentityAndTorrentBatch() throws {
        let (_,data,edition) = try fixture()
        XCTAssertTrue(edition.metadataURL.absoluteString.hasSuffix("/r_1000.torrent"))
        XCTAssertEqual(edition.expectedSize,Int64(data.count))
        for record:[String:Any] in [[:],["md5":edition.md5,"id":0],["md5":"wrong","id":1234],
            ["md5":edition.md5,"id":"bad"],["md5":edition.md5,"id":1234,"filesize":-1],
            ["md5":edition.md5,"id":1234,"filesize":9*1024*1024*1024]] {
            XCTAssertThrowsError(try TorrentEdition(record:record,expectedMD5:edition.md5))
        }
        XCTAssertNil(try TorrentEdition(record:["md5":edition.md5,"libgen_id":"999","filesize":0],expectedMD5:edition.md5).expectedSize)
        XCTAssertThrowsError(try TorrentEdition(record:[:],expectedMD5:"z"))
        for error in [TorrentDownloadError.invalidEdition,.invalidMetadata,.busy,.unsafePath,.verification,.engine("failure")] { XCTAssertFalse(error.localizedDescription.isEmpty) }
    }
    func testForegroundPauseResumeAndCachedMetadata() async throws {
        let (root,data,edition)=try fixture();let file=root.appendingPathComponent(edition.md5).appendingPathComponent(edition.md5)
        try data.write(to:file)
        let engine=Engine();engine.states=[["state":"finding-peers"],["state":"downloading","bytes":5,"size":data.count,"peers":22,"seeds":3,"rate":2048],["state":"ready","path":file.path]]
        var fetches=0;var statuses:[String]=[]
        let downloader=ForegroundTorrentDownloader(root:root,makeEngine:{_ in engine},fetch:{_ in fetches += 1; return Data("d4:infodee".utf8)},sleep:{})
        await downloader.setActive(true)
        let received=try await downloader.download(edition,progress:{statuses.append($0)})
        XCTAssertEqual(received,file);XCTAssertEqual(fetches,1);XCTAssertEqual(engine.stops,1)
        XCTAssertTrue(statuses.contains("Finding peers…"));XCTAssertTrue(statuses.contains("Verifying…"))
        XCTAssertTrue(statuses.contains(where:{$0.contains("22 peers (3 seeds)") && $0.contains("/s")}))
        await downloader.setActive(false)
        _=try await downloader.download(edition,progress:{_ in})
        XCTAssertEqual(fetches,1);XCTAssertEqual(engine.starts,2)
        XCTAssertTrue(engine.active.contains(false))
    }
    func testUnsafePathsCorruptFilesAndEngineFailure() async throws {
        let (root,data,edition)=try fixture();let file=root.appendingPathComponent(edition.md5).appendingPathComponent(edition.md5)
        for status:[String:Any] in [["state":"ready"],["state":"ready","path":"/outside/book"],["state":"failed"],["state":"failed","error":"no peers"],["state":"ready","path":file.path]] {
            try Data(repeating:1,count:data.count).write(to:file)
            let engine=Engine();engine.states=[status]
            let downloader=ForegroundTorrentDownloader(root:root,makeEngine:{_ in engine},fetch:{_ in Data("de".utf8)},sleep:{})
            do { _=try await downloader.download(edition,progress:{_ in});XCTFail("Expected error") } catch {}
            XCTAssertEqual(engine.stops,1)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath:file.path))
        try Data().write(to:file);XCTAssertThrowsError(try ForegroundTorrentDownloader.verify(file,edition:edition))
        try data.write(to:file);try ForegroundTorrentDownloader.verify(file,edition:edition)
    }
    func testCancellationPreservesPartialsAndPausesWhileInactive() async throws {
        let (root,data,edition)=try fixture();let partial=root.appendingPathComponent(edition.md5).appendingPathComponent("partial")
        try data.write(to:partial);let engine=Engine()
        let downloader=ForegroundTorrentDownloader(root:root,makeEngine:{_ in engine},fetch:{_ in Data("de".utf8)},sleep:{try await Task.sleep(nanoseconds:1_000_000)})
        let paused=expectation(description:"paused")
        var reportedPause = false
        let task=Task { try await downloader.download(edition,progress:{if $0.hasPrefix("Paused"), !reportedPause { reportedPause = true; paused.fulfill() }}) }
        await fulfillment(of:[paused],timeout:3)
        do { _=try await downloader.download(edition,progress:{_ in});XCTFail("Expected busy") } catch {}
        await downloader.setActive(true);await downloader.setActive(false)
        task.cancel()
        do { _=try await task.value;XCTFail("Expected cancellation") } catch {}
        XCTAssertTrue(FileManager.default.fileExists(atPath:partial.path));XCTAssertEqual(engine.stops,1)
    }
    func testMetadataFailuresCanRetry() async throws {
        let (root,_,edition)=try fixture()
        for data in [Data(),Data("invalid".utf8)] {
            let downloader=ForegroundTorrentDownloader(root:root,makeEngine:{_ in Engine()},fetch:{_ in data},sleep:{})
            do { _=try await downloader.download(edition,progress:{_ in});XCTFail("Expected metadata rejection") } catch {}
        }
        let engine=Engine();engine.startError=TorrentDownloadError.invalidMetadata
        let downloader=ForegroundTorrentDownloader(root:root,makeEngine:{_ in engine},fetch:{_ in Data("de".utf8)},sleep:{})
        do { _=try await downloader.download(edition,progress:{_ in});XCTFail("Expected engine rejection") } catch {}
        XCTAssertFalse(FileManager.default.fileExists(atPath:root.appendingPathComponent(edition.md5).appendingPathComponent("book.torrent").path))
    }
}

extension TorrentDownloadTests {
    final class MetadataProtocol: URLProtocol {
        static var status = 200
        static var body = Data("de".utf8)
        static var declaredSize: Int?
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            let headers = Self.declaredSize.map { ["Content-Length": String($0)] } ?? [:]
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Self.body)
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }
    func testDefaultMetadataLoaderAndPolling() async throws {
        let (root, data, edition) = try fixture()
        let file = root.appendingPathComponent(edition.md5).appendingPathComponent(edition.md5)
        try data.write(to: file)
        let engine = Engine()
        engine.states = [["state": "finding-peers"], ["state": "ready", "path": file.path]]
        MetadataProtocol.status = 200; MetadataProtocol.body = Data("de".utf8); MetadataProtocol.declaredSize = nil
        URLProtocol.registerClass(MetadataProtocol.self)
        defer { URLProtocol.unregisterClass(MetadataProtocol.self) }
        let downloader = ForegroundTorrentDownloader(root: root, makeEngine: { _ in engine })
        await downloader.setActive(true)
        let received = try await downloader.download(edition, progress: { _ in })
        XCTAssertEqual(received, file)
    }
    func testMetadataHTTPValidationAndStreaming() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MetadataProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); MetadataProtocol.status = 200; MetadataProtocol.body = Data("de".utf8); MetadataProtocol.declaredSize = nil }
        let url = URL(string: "https://fixture.test/book.torrent")!
        MetadataProtocol.status = 200
        let received = try await ForegroundTorrentDownloader.fetchMetadata(url, session: session)
        XCTAssertEqual(received, Data("de".utf8))
        MetadataProtocol.status = 403
        do { _ = try await ForegroundTorrentDownloader.fetchMetadata(url, session: session); XCTFail("Expected HTTP rejection") } catch {}
        MetadataProtocol.status = 200; MetadataProtocol.declaredSize = 17 * 1024 * 1024
        do { _ = try await ForegroundTorrentDownloader.fetchMetadata(url, session: session); XCTFail("Expected size rejection") } catch {}
        MetadataProtocol.declaredSize = nil; MetadataProtocol.body = Data(repeating: 100, count: 16 * 1024 * 1024 + 1)
        do { _ = try await ForegroundTorrentDownloader.fetchMetadata(url, session: session); XCTFail("Expected streamed size rejection") } catch {}
    }
}

#if !SWIFT_PACKAGE
import Network
extension TorrentDownloadTests {
    final class SeedServer {
        let listener: NWListener
        let files: [String:Data]
        init(files: [String:Data]) throws {
            self.files=files; listener=try NWListener(using:.tcp,on:.any)
            listener.newConnectionHandler = { [weak self] connection in
                connection.start(queue:.global())
                connection.receive(minimumIncompleteLength:1,maximumLength:8192) { data,_,_,_ in
                    guard let self, let data, let request=String(data:data,encoding:.utf8),
                          let path=request.components(separatedBy:" ").dropFirst().first,
                          let bytes=self.files[URL(string:"http://localhost"+path)!.lastPathComponent] else {
                        connection.cancel();return
                    }
                    var lower=0;var upper=bytes.count-1;var partial=false
                    if let line=request.components(separatedBy:"\r\n").first(where:{$0.lowercased().hasPrefix("range: bytes=")}) {
                        let parts=line.components(separatedBy:"=")[1].split(separator:"-",omittingEmptySubsequences:false)
                        lower=Int(parts[0]) ?? 0;upper=parts.count>1 ? Int(parts[1]) ?? upper : upper;partial=true
                    }
                    guard lower>=0,upper<bytes.count,lower<=upper else {connection.cancel();return}
                    var headers="HTTP/1.1 \(partial ? "206 Partial Content" : "200 OK")\r\nContent-Length: \(upper-lower+1)\r\nConnection: close\r\n"
                    if partial {headers += "Content-Range: bytes \(lower)-\(upper)/\(bytes.count)\r\n"}
                    let response=Data((headers+"\r\n").utf8)+bytes[lower...upper]
                    connection.send(content:response,completion:.contentProcessed{_ in connection.cancel()})
                }
            }
        }
        func start() async throws -> UInt16 {
            try await withCheckedThrowingContinuation { continuation in
                listener.stateUpdateHandler = { [self] state in
                    switch state {case .ready:continuation.resume(returning:listener.port!.rawValue)
                    case .failed(let error):continuation.resume(throwing:error)
                    default:break}
                }
                listener.start(queue:.global())
            }
        }
    }
    func bencode(_ value:Any) -> Data {
        if let bytes=value as? Data {return Data("\(bytes.count):".utf8)+bytes}
        if let string=value as? String {return bencode(Data(string.utf8))}
        if let number=value as? Int {return Data("i\(number)e".utf8)}
        if let array=value as? [Any] {return Data("l".utf8)+array.reduce(Data()){$0+bencode($1)}+Data("e".utf8)}
        let dictionary=value as! [String:Any]
        return Data("d".utf8)+dictionary.keys.sorted().reduce(Data()){$0+bencode($1)+bencode(dictionary[$1]!)}+Data("e".utf8)
    }
    func testNativeHashFilenamesWithExtensionsAndAmbiguity() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let md5 = String(repeating: "a", count: 32)
        let engine = NativeBookTorrentEngine(root: root)
        engine.setActive(false)
        for suffix in ["", ".pdf", ".epub", ".fb2.zip"] {
            let metadata = bencode(["info": ["name": md5.uppercased() + suffix, "length": 1, "piece length": 16384, "pieces": Data(repeating: 0, count: 20)]])
            try engine.start(metadata: metadata, md5: md5)
            XCTAssertTrue((engine.snapshot()["path"] as? String)?.hasSuffix(md5.uppercased() + suffix) == true)
            engine.stop()
        }
        let duplicate = bencode(["info": ["name": "batch", "piece length": 16384, "pieces": Data(repeating: 0, count: 20), "files": [["length": 1, "path": [md5]], ["length": 1, "path": [md5 + ".pdf"]]]]])
        XCTAssertThrowsError(try engine.start(metadata: duplicate, md5: md5)) { error in
            XCTAssertTrue(error.localizedDescription.contains("Ambiguous"))
        }
        let wrong = bencode(["info": ["name": md5 + "1.pdf", "length": 1, "piece length": 16384, "pieces": Data(repeating: 0, count: 20)]])
        XCTAssertThrowsError(try engine.start(metadata: wrong, md5: md5)) { error in XCTAssertEqual((error as NSError).code, 2) }
    }

    func testNativeZlibSelectsExactIDAndRejectsUnsafeOrAmbiguousNames() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let engine = NativeBookTorrentEngine(root: root)
        let md5 = String(repeating: "a", count: 32)
        let metadata = bencode(["info": ["name": "123", "length": 1, "piece length": 16384, "pieces": Data(repeating: 0, count: 20)]])
        engine.setActive(false)
        try engine.start(metadata: metadata, md5: md5, filename: "123")
        XCTAssertTrue((engine.snapshot()["path"] as? String)?.hasSuffix("/123") == true)
        for filename in ["", "../123", "x", "12345678901234567"] {
            XCTAssertThrowsError(try engine.start(metadata: metadata, md5: md5, filename: filename))
        }
        XCTAssertThrowsError(try engine.start(metadata: metadata, md5: md5, filename: "12"))
        let duplicate = bencode(["info": ["name": "batch", "piece length": 16384, "pieces": Data(repeating: 0, count: 20), "files": [["length": 1, "path": ["one", "123"]], ["length": 1, "path": ["two", "123"]]]]])
        XCTAssertThrowsError(try engine.start(metadata: duplicate, md5: md5, filename: "123"))
    }

    func testNativeZlibDownloadVerifiesPayloadAndResumesCachedMetadata() async throws {
        let bytes = Data(repeating: 42, count: 32 * 1024)
        let other = Data(repeating: 17, count: 16 * 1024)
        let md5 = Insecure.MD5.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let seeder = try SeedServer(files: ["123": bytes, "other": other]); let port = try await seeder.start()
        defer { seeder.listener.cancel() }
        let contents = bytes + other
        var pieces = Data()
        for offset in stride(from: 0, to: contents.count, by: 16384) { pieces.append(contentsOf: Insecure.SHA1.hash(data: contents[offset..<min(offset + 16384, contents.count)])) }
        let torrent = bencode(["url-list": "http://127.0.0.1:\(port)/", "info": ["name": "fixture", "piece length": 16384, "pieces": pieces, "files": [["length": bytes.count, "path": ["123"]], ["length": other.count, "path": ["other"]]]]])
        var record = zlibRecord(); record["md5"] = md5; record["filesize_bytes"] = bytes.count
        let edition = try TorrentEdition(record: record, expectedMD5: md5)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let downloader = ForegroundTorrentDownloader(root: root, makeEngine: { NativeBookTorrentEngine(root: $0) }, fetch: { _ in torrent })
        await downloader.setActive(true)
        let transfer = Task {
            let file = try await downloader.download(edition) { _ in }
            XCTAssertEqual(try Data(contentsOf: file), bytes)
            let again = try await downloader.download(edition) { _ in }
            XCTAssertEqual(file, again)
        }
        let timeout = Task { try await Task.sleep(nanoseconds: 30_000_000_000); transfer.cancel() }
        defer { timeout.cancel() }
        try await transfer.value
    }

    func testNativeSelectedFileDownloadPauseAndDiskResume() async throws {
        let bytes=Data(repeating:42,count:128*1024)
        let other=Data(repeating:17,count:32*1024)
        let md5=Insecure.MD5.hash(data:bytes).map{String(format:"%02x",$0)}.joined()
        let seeder=try SeedServer(files:[md5:bytes,"other":other]);let port=try await seeder.start()
        defer {seeder.listener.cancel()}
        let contents=bytes+other
        var pieces=Data()
        for offset in stride(from:0,to:contents.count,by:16384) {pieces.append(contentsOf:Insecure.SHA1.hash(data:contents[offset..<min(offset+16384,contents.count)]))}
        let torrent=bencode(["url-list":"http://127.0.0.1:\(port)/","info":["name":"fixture","piece length":16384,"pieces":pieces,"files":[["length":bytes.count,"path":[md5]],["length":other.count,"path":["other"]]]]])
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        defer{try? FileManager.default.removeItem(at:root)}
        let engine=NativeBookTorrentEngine(root:root)
        engine.setActive(false)
        try engine.start(metadata:torrent,md5:md5)
        XCTAssertEqual(engine.snapshot()["state"] as? String,"paused")
        engine.setActive(true)
        var completed:[String:Any]=[:]
        for _ in 0..<400 {
            let status=engine.snapshot()
            if status["state"] as? String == "ready" {completed=status;break}
            if status["state"] as? String == "failed" {XCTFail("\(status)");break}
            try await Task.sleep(nanoseconds:50_000_000)
        }
        XCTAssertEqual(completed["state"] as? String,"ready")
        let file=try XCTUnwrap(completed["path"] as? String)
        XCTAssertEqual(try Data(contentsOf:URL(fileURLWithPath:file)),bytes)
        XCTAssertFalse(FileManager.default.fileExists(atPath:root.appendingPathComponent("fixture/other").path))
        engine.setActive(false);engine.stop()
        seeder.listener.cancel()
        try engine.start(metadata:torrent,md5:md5);engine.setActive(true)
        for _ in 0..<100 {
            if engine.snapshot()["state"] as? String == "ready" {break}
            try await Task.sleep(nanoseconds:50_000_000)
        }
        XCTAssertEqual(engine.snapshot()["state"] as? String,"ready")
        engine.stop()
        XCTAssertEqual(engine.snapshot()["state"] as? String, "idle")
        engine.setActive(false)
        XCTAssertThrowsError(try engine.start(metadata:Data(),md5:md5))
        XCTAssertThrowsError(try engine.start(metadata:torrent,md5:"x"))
        XCTAssertThrowsError(try engine.start(metadata:Data("invalid".utf8),md5:md5))
        XCTAssertThrowsError(try engine.start(metadata:torrent,md5:String(repeating:"a",count:32)))
        let oversized = 8 * 1024 * 1024 * 1024 + 1
        let huge = bencode(["info": ["name": md5, "length": oversized, "piece length": 16384,
            "pieces": Data(repeating: 0, count: ((oversized + 16383) / 16384) * 20)]])
        XCTAssertThrowsError(try engine.start(metadata: huge, md5: md5)) { error in
            XCTAssertTrue(error.localizedDescription.contains("Unsupported torrent file"))
        }
        let invalidRoot = root.appendingPathComponent("not-a-directory")
        try Data("file".utf8).write(to: invalidRoot)
        let invalidEngine = NativeBookTorrentEngine(root: invalidRoot)
        try invalidEngine.start(metadata: torrent, md5: md5)
        for _ in 0..<100 {
            if invalidEngine.snapshot()["state"] as? String == "failed" { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(invalidEngine.snapshot()["state"] as? String, "failed")
        invalidEngine.stop()

    }
}
#endif
