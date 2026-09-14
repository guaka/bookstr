import XCTest
import CryptoKit
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class TorrentDownloadTests: XCTestCase {
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
        XCTAssertEqual(queue.jobs.map(\.status), ["Queued", "Queued"])
        for _ in 0..<100 where queue.jobs.last?.book == nil { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(started, ["first", "second"])
        XCTAssertTrue(queue.jobs[0].failed)
        XCTAssertEqual(queue.jobs[1].status, "Downloaded")
        queue.enqueue(result("first")) { result, _ in result.asCatalogBook()! }
        for _ in 0..<100 where queue.jobs[0].book == nil { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(queue.jobs.count, 2)
        XCTAssertEqual(queue.jobs[0].status, "Downloaded")
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
        let engine=Engine();engine.states=[["state":"finding-peers"],["state":"downloading","bytes":5,"size":data.count],["state":"ready","path":file.path]]
        var fetches=0;var statuses:[String]=[]
        let downloader=ForegroundTorrentDownloader(root:root,makeEngine:{_ in engine},fetch:{_ in fetches += 1; return Data("d4:infodee".utf8)},sleep:{})
        await downloader.setActive(true)
        let received=try await downloader.download(edition,progress:{statuses.append($0)})
        XCTAssertEqual(received,file);XCTAssertEqual(fetches,1);XCTAssertEqual(engine.stops,1)
        XCTAssertTrue(statuses.contains("Finding peers…"));XCTAssertTrue(statuses.contains("Verifying…"))
        XCTAssertTrue(statuses.contains(where:{$0.hasPrefix("Downloading ·")}))
        await downloader.setActive(false)
        _=try await downloader.download(edition,progress:{_ in})
        XCTAssertEqual(fetches,1);XCTAssertEqual(engine.starts,2)
        XCTAssertTrue(engine.active.contains(false))
    }
    func testUnsafePathsCorruptFilesAndEngineFailure() async throws {
        let (root,data,edition)=try fixture();let file=root.appendingPathComponent(edition.md5).appendingPathComponent(edition.md5)
        for status:[String:Any] in [["state":"ready"],["state":"ready","path":"/outside/book"],["state":"failed","error":"no peers"],["state":"ready","path":file.path]] {
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
        defer { session.invalidateAndCancel(); MetadataProtocol.status = 200; MetadataProtocol.declaredSize = nil }
        let url = URL(string: "https://fixture.test/book.torrent")!
        MetadataProtocol.status = 200
        let received = try await ForegroundTorrentDownloader.fetchMetadata(url, session: session)
        XCTAssertEqual(received, Data("de".utf8))
        MetadataProtocol.status = 403
        do { _ = try await ForegroundTorrentDownloader.fetchMetadata(url, session: session); XCTFail("Expected HTTP rejection") } catch {}
        MetadataProtocol.status = 200; MetadataProtocol.declaredSize = 17 * 1024 * 1024
        do { _ = try await ForegroundTorrentDownloader.fetchMetadata(url, session: session); XCTFail("Expected size rejection") } catch {}
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
