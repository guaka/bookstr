import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class CatalogConnectionTests: XCTestCase {
    struct TestSigner: NostrSigner {
        let publicKeyHex: String
        func sign(_ event: NostrEvent) async throws -> NostrEvent {
            var signed = event
            signed.pubkey = publicKeyHex
            signed.id = try PrivateCatalogWire.id(signed)
            signed.sig = String(repeating: "f", count: 128)
            return signed
        }
        func nip44Encrypt(_ plaintext: String, to recipientPubkey: String) async throws -> String { plaintext }
        func nip44Decrypt(_ ciphertext: String, from senderPubkey: String) async throws -> String { ciphertext }
    }

    final class TestSocket: PrivateCatalogSocket {
        var maximumMessageSize = 0
        var state: URLSessionTask.State = .suspended
        var sent: [URLSessionWebSocketTask.Message] = []
        var resumed = false
        var cancellations: [URLSessionWebSocketTask.CloseCode] = []
        var receiveHandler: ((TestSocket) async throws -> URLSessionWebSocketTask.Message)!
        func resume() { resumed = true; state = .running }
        func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) { cancellations.append(closeCode); state = .canceling }
        func send(_ message: URLSessionWebSocketTask.Message) async throws { sent.append(message) }
        func receive() async throws -> URLSessionWebSocketTask.Message { try await receiveHandler(self) }

        func frame(at index: Int) throws -> [Any] {
            guard case .string(let text) = sent[index],
                  let frame = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [Any] else {
                throw PrivateCatalogError.invalidResponse
            }
            return frame
        }
    }

    struct Fixture: Decodable { let uri:String; let npub:String; let pubkey:String; let name:String; let relays:[String] }
    func fixture() throws -> Fixture {
        let root=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try JSONDecoder().decode(Fixture.self,from:Data(contentsOf:root.appendingPathComponent("shared/fixtures/catalog-invitation-v1.json")))
    }
    func testInvitationAndPersistence() throws {
        let f=try fixture()
        let connection=try XCTUnwrap(CatalogConnection(url:URL(string:f.uri)!,decodeNPub:{$0 == f.npub ? f.pubkey : nil}))
        XCTAssertEqual(connection.name,f.name);XCTAssertEqual(connection.relays,f.relays);XCTAssertEqual(connection.id,f.uri)
        let suite="catalog-invitation-\(UUID().uuidString)";let defaults=UserDefaults(suiteName:suite)!
        defer{defaults.removePersistentDomain(forName:suite)}
        let settings=SettingsRepository(defaults:defaults)
        XCTAssertNil(settings.catalogConnection)
        let relays=settings.relays
        settings.catalogConnection=connection
        XCTAssertEqual(SettingsRepository(defaults:defaults).catalogConnection,connection)
        XCTAssertEqual(settings.relays,relays)
        settings.catalogConnection=nil;XCTAssertNil(settings.catalogConnection)
        defaults.set(Data("invalid".utf8),forKey:"catalog_connection_v1");XCTAssertNil(settings.catalogConnection)
        let duplicate=try XCTUnwrap(CatalogConnection(url:URL(string:f.uri+"&relay=wss%3A%2F%2Frelay.example")!,decodeNPub:{_ in f.pubkey}))
        XCTAssertEqual(duplicate.relays,f.relays)
    }
    func testInvalidInvitationsDoNotProduceSettings() throws {
        let f=try fixture()
        let invalid=["bookstr://catalog",f.uri.replacingOccurrences(of:"bookstr:",with:"https:"),f.uri.replacingOccurrences(of:"catalog?",with:"catalog/path?"),f.uri+"#fragment",f.uri+"&nsec=secret",f.uri+"&v=1",f.uri.replacingOccurrences(of:"v=1",with:"v=2"),f.uri.replacingOccurrences(of:"My+Libcat",with:""),f.uri.replacingOccurrences(of:"My+Libcat",with:"%00"),f.uri.replacingOccurrences(of:"My+Libcat",with:String(repeating:"a",count:81)),f.uri.replacingOccurrences(of:"relay=wss%3A%2F%2Frelay.example",with:""),f.uri+"&relay=wss://a&relay=wss://b&relay=wss://c",f.uri+String(repeating:"a",count:2048),f.uri.replacingOccurrences(of:f.npub,with:"bad"),f.uri.replacingOccurrences(of:"//catalog",with:"//user:pass@catalog"),f.uri.replacingOccurrences(of:"//catalog",with:"//catalog:9")]
        for value in invalid {XCTAssertNil(CatalogConnection(url:URL(string:value)!,decodeNPub:{_ in f.pubkey}),value)}
        for address in ["http://relay.example","wss://user:pass@relay.example","wss://relay.example/#x","wss://relay.example/?token=x","wss://relay.example/space here","wss://","wss://relay.example/"+String(repeating:"a",count:256)] {
            var components=URLComponents(string:f.uri)!;components.queryItems=components.queryItems!.filter{$0.name != "relay"}+[URLQueryItem(name:"relay",value:address)]
            XCTAssertNil(CatalogConnection(url:components.url!,decodeNPub:{_ in f.pubkey}),address)
        }
        XCTAssertNil(CatalogConnection(url:URL(string:f.uri)!,decodeNPub:{_ in nil}))
        XCTAssertNil(CatalogConnection(url:URL(string:f.uri)!,decodeNPub:{_ in "bad"}))
    }

    func testPrivateCatalogServiceUsesConfirmedInvitation() throws {
        let f = try fixture()
        let connection = try XCTUnwrap(CatalogConnection(url: URL(string: f.uri)!, decodeNPub: { _ in f.pubkey }))
        let service = try XCTUnwrap(PrivateCatalogService(connection: connection))
        XCTAssertEqual(service.pubkey, f.pubkey)
        XCTAssertEqual(service.relay.absoluteString, f.relays[0])
        XCTAssertEqual(PrivateCatalogService.libcat.relay.scheme, "wss")
        let invalid = try JSONDecoder().decode(CatalogConnection.self, from: Data(
            "{\"name\":\"Invalid\",\"npub\":\"npub1bad\",\"pubkey\":\"bad\",\"relays\":[],\"uri\":\"bookstr://catalog\"}".utf8))
        XCTAssertNil(PrivateCatalogService(connection: invalid))
        let live = PrivateCatalogSocketConnection.live(relay: URL(string: "wss://relay.example")!)
        live.close()
    }

    func testPrivateCatalogWireWrapsAndUnwrapsAuthenticatedPayloads() async throws {
        let userKey = String(repeating: "1", count: 64)
        let serviceKey = String(repeating: "2", count: 64)
        let ephemeralKey = String(repeating: "3", count: 64)
        let user = TestSigner(publicKeyHex: userKey)
        let serviceSigner = TestSigner(publicKeyHex: serviceKey)
        let ephemeral = TestSigner(publicKeyHex: ephemeralKey)
        let service = PrivateCatalogService(pubkey: serviceKey, relay: URL(string: "wss://relay.example")!)
        let crypto = PrivateCatalogCrypto(ephemeralSigner: { ephemeral }, verify: { $0.sig != nil })

        let request = try await PrivateCatalogWire.wrap(
            payload: ["type": "libcat.search", "request_id": "request"],
            service: service, signer: user, crypto: crypto, now: 1_000)
        XCTAssertEqual(request.kind, 1059)
        XCTAssertEqual(request.pubkey, ephemeralKey)
        XCTAssertEqual(request.tags.first, ["p", serviceKey])
        XCTAssertEqual(try PrivateCatalogWire.json(["b": 2, "a": 1]), "{\"a\":1,\"b\":2}")
        XCTAssertFalse(try PrivateCatalogWire.encode(request).isEmpty)
        XCTAssertFalse(try PrivateCatalogWire.id(NostrEvent(createdAt: 1, kind: 1, tags: [], content: "")).isEmpty)

        var rumor = NostrEvent(pubkey: serviceKey, createdAt: 1_001, kind: 14,
                               tags: [["p", userKey]],
                               content: try PrivateCatalogWire.json([
                                "type": "libcat.search.result", "request_id": "request",
                                "status": "ready", "books": []
                               ]))
        rumor.id = try PrivateCatalogWire.id(rumor)
        let seal = try await serviceSigner.sign(NostrEvent(createdAt: 1_001, kind: 13, tags: [],
                                                           content: try PrivateCatalogWire.encode(rumor)))
        let wrapped = try await ephemeral.sign(NostrEvent(createdAt: 1_001, kind: 1059,
                                                          tags: [["p", userKey]],
                                                          content: try PrivateCatalogWire.encode(seal)))
        let response = try await PrivateCatalogWire.unwrap(
            wrapped, service: service, signer: user, crypto: crypto,
            requestID: "request", type: "libcat.search")
        XCTAssertEqual(response?["status"] as? String, "ready")

        var wrongKind = wrapped; wrongKind.kind = 1
        let rejectedKind = try await PrivateCatalogWire.unwrap(wrongKind, service: service, signer: user,
            crypto: crypto, requestID: "request", type: "libcat.search")
        XCTAssertNil(rejectedKind)
        let unverified = PrivateCatalogCrypto(ephemeralSigner: { ephemeral }, verify: { _ in false })
        let rejectedSignature = try await PrivateCatalogWire.unwrap(wrapped, service: service, signer: user,
            crypto: unverified, requestID: "request", type: "libcat.search")
        XCTAssertNil(rejectedSignature)
        let rejectedRequest = try await PrivateCatalogWire.unwrap(wrapped, service: service, signer: user,
            crypto: crypto, requestID: "other", type: "libcat.search")
        XCTAssertNil(rejectedRequest)
        var invalidSeal = seal; invalidSeal.kind = 1
        let invalidWrapped = try await ephemeral.sign(NostrEvent(createdAt: 1_001, kind: 1059,
            tags: [["p", userKey]], content: try PrivateCatalogWire.encode(invalidSeal)))
        let rejectedSeal = try await PrivateCatalogWire.unwrap(invalidWrapped, service: service, signer: user,
            crypto: crypto, requestID: "request", type: "libcat.search")
        XCTAssertNil(rejectedSeal)
    }

    func testPrivateCatalogErrorsAndInvalidServiceFailBeforeNetworking() async throws {
        XCTAssertEqual(PrivateCatalogError.invalidResponse.localizedDescription, "Invalid private catalog response")
        XCTAssertEqual(PrivateCatalogError.rejected("No access").localizedDescription, "No access")
        XCTAssertEqual(PrivateCatalogError.unavailable.localizedDescription, "Private catalog unavailable. Try again.")
        let signer = TestSigner(publicKeyHex: String(repeating: "1", count: 64))
        let crypto = PrivateCatalogCrypto(ephemeralSigner: { signer }, verify: { _ in true })
        let invalid = PrivateCatalogService(pubkey: String(repeating: "2", count: 64), relay: URL(string: "https://relay.example")!)
        do {
            let client = PrivateCatalogClient(crypto: crypto, socketFactory: { _ in
                PrivateCatalogSocketConnection(socket: TestSocket(), close: {})
            })
            _ = try await client.request(["type": "libcat.search"], signer: signer, service: invalid)
            XCTFail("Expected invalid service")
        } catch {
            XCTAssertEqual(error as? PrivateCatalogError, .invalidResponse)
        }
    }

    func testPrivateCatalogClientPublishesAfterEOSEAndAcceptsReadyResponse() async throws {
        let userKey = String(repeating: "1", count: 64)
        let serviceKey = String(repeating: "2", count: 64)
        let user = TestSigner(publicKeyHex: userKey)
        let serviceSigner = TestSigner(publicKeyHex: serviceKey)
        let ephemeral = TestSigner(publicKeyHex: String(repeating: "3", count: 64))
        let service = PrivateCatalogService(pubkey: serviceKey, relay: URL(string: "wss://relay.example")!)
        let crypto = PrivateCatalogCrypto(ephemeralSigner: { ephemeral }, verify: { $0.sig != nil })
        let socket = TestSocket()
        var receives = 0
        socket.receiveHandler = { socket in
            let requestID = try XCTUnwrap(socket.frame(at: 0)[1] as? String)
            receives += 1
            if receives == 1 { return .string(try PrivateCatalogWire.json(["NOTICE", "ignored"])) }
            if receives == 2 { return .string("not json") }
            if receives == 3 {
                return .string(try PrivateCatalogWire.json(["EOSE", requestID]))
            }
            var rumor = NostrEvent(pubkey: serviceKey, createdAt: 2_000, kind: 14,
                tags: [["p", userKey]], content: try PrivateCatalogWire.json([
                    "type": "libcat.search.result", "request_id": requestID,
                    "status": "ready", "books": []
                ]))
            rumor.id = try PrivateCatalogWire.id(rumor)
            let seal = try await serviceSigner.sign(NostrEvent(createdAt: 2_000, kind: 13, tags: [],
                content: try PrivateCatalogWire.encode(rumor)))
            let wrapped = try await ephemeral.sign(NostrEvent(createdAt: 2_000, kind: 1059,
                tags: [["p", userKey]], content: try PrivateCatalogWire.encode(seal)))
            let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(wrapped))
            return .data(Data(try PrivateCatalogWire.json(["EVENT", requestID, object]).utf8))
        }
        var closed = false
        let client = PrivateCatalogClient(crypto: crypto, socketFactory: { relay in
            XCTAssertEqual(relay, service.relay)
            return PrivateCatalogSocketConnection(socket: socket, close: { closed = true })
        })
        let response = try await client.request(["type": "libcat.search", "query": "history"], signer: user, service: service)
        XCTAssertEqual(response["status"] as? String, "ready")
        XCTAssertTrue(socket.resumed)
        XCTAssertEqual(socket.maximumMessageSize, 1024 * 1024)
        XCTAssertEqual(socket.sent.count, 2)
        let requestFrame = try socket.frame(at: 0)
        let eventFrame = try socket.frame(at: 1)
        XCTAssertEqual(requestFrame[0] as? String, "REQ")
        XCTAssertEqual(eventFrame[0] as? String, "EVENT")
        XCTAssertTrue(closed)
        XCTAssertEqual(socket.cancellations.last, .normalClosure)
    }

    func testPrivateCatalogClientReportsRelayRejectionAndClosedSubscription() async throws {
        let user = TestSigner(publicKeyHex: String(repeating: "1", count: 64))
        let service = PrivateCatalogService(pubkey: String(repeating: "2", count: 64), relay: URL(string: "wss://relay.example")!)
        let crypto = PrivateCatalogCrypto(ephemeralSigner: { TestSigner(publicKeyHex: String(repeating: "3", count: 64)) }, verify: { _ in true })

        let rejected = TestSocket()
        var rejectedReads = 0
        rejected.receiveHandler = { socket in
            let requestID = try XCTUnwrap(socket.frame(at: 0)[1] as? String)
            rejectedReads += 1
            if rejectedReads == 1 { return .string(try PrivateCatalogWire.json(["EOSE", requestID])) }
            let event = try XCTUnwrap(socket.frame(at: 1)[1] as? [String: Any])
            let eventID = try XCTUnwrap(event["id"] as? String)
            return .string(try PrivateCatalogWire.json(["OK", eventID, false, "denied"]))
        }
        do {
            _ = try await PrivateCatalogClient(crypto: crypto, socketFactory: { _ in
                PrivateCatalogSocketConnection(socket: rejected, close: {})
            }).request(["type": "libcat.search"], signer: user, service: service)
            XCTFail("Expected relay rejection")
        } catch {
            XCTAssertEqual(error as? PrivateCatalogError, .rejected("Relay rejected the private catalog request"))
        }

        let closed = TestSocket()
        closed.receiveHandler = { socket in
            let requestID = try XCTUnwrap(socket.frame(at: 0)[1] as? String)
            return .string(try PrivateCatalogWire.json(["CLOSED", requestID, "closed"]))
        }
        do {
            _ = try await PrivateCatalogClient(crypto: crypto, socketFactory: { _ in
                PrivateCatalogSocketConnection(socket: closed, close: {})
            }).request(["type": "libcat.search"], signer: user, service: service)
            XCTFail("Expected closed subscription")
        } catch {
            XCTAssertEqual(error as? PrivateCatalogError, .unavailable)
        }

        let ended = TestSocket()
        ended.receiveHandler = { socket in
            socket.state = .completed
            return .string(try PrivateCatalogWire.json(["NOTICE", "ended"]))
        }
        do {
            _ = try await PrivateCatalogClient(crypto: crypto, socketFactory: { _ in
                PrivateCatalogSocketConnection(socket: ended, close: {})
            }).request(["type": "libcat.search"], signer: user, service: service)
            XCTFail("Expected ended connection")
        } catch {
            XCTAssertEqual(error as? PrivateCatalogError, .unavailable)
        }
    }

    func testPrivateCatalogClientRejectsCatalogErrorAndHandlesTimeoutAndCancellation() async throws {
        let userKey = String(repeating: "1", count: 64)
        let serviceKey = String(repeating: "2", count: 64)
        let user = TestSigner(publicKeyHex: userKey)
        let serviceSigner = TestSigner(publicKeyHex: serviceKey)
        let ephemeral = TestSigner(publicKeyHex: String(repeating: "3", count: 64))
        let service = PrivateCatalogService(pubkey: serviceKey, relay: URL(string: "wss://relay.example")!)
        let crypto = PrivateCatalogCrypto(ephemeralSigner: { ephemeral }, verify: { $0.sig != nil })

        let failed = TestSocket()
        var reads = 0
        failed.receiveHandler = { socket in
            let requestID = try XCTUnwrap(socket.frame(at: 0)[1] as? String)
            reads += 1
            if reads == 1 { return .string(try PrivateCatalogWire.json(["EOSE", requestID])) }
            var rumor = NostrEvent(pubkey: serviceKey, createdAt: 3_000, kind: 14,
                tags: [["p", userKey]], content: try PrivateCatalogWire.json([
                    "type": "libcat.search.result", "request_id": requestID,
                    "status": "failed"
                ]))
            rumor.id = try PrivateCatalogWire.id(rumor)
            let seal = try await serviceSigner.sign(NostrEvent(createdAt: 3_000, kind: 13, tags: [],
                content: try PrivateCatalogWire.encode(rumor)))
            let wrapped = try await ephemeral.sign(NostrEvent(createdAt: 3_000, kind: 1059,
                tags: [["p", userKey]], content: try PrivateCatalogWire.encode(seal)))
            let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(wrapped))
            return .string(try PrivateCatalogWire.json(["EVENT", requestID, object]))
        }
        do {
            _ = try await PrivateCatalogClient(crypto: crypto, socketFactory: { _ in
                PrivateCatalogSocketConnection(socket: failed, close: {})
            }).request(["type": "libcat.search"], signer: user, service: service)
            XCTFail("Expected catalog failure")
        } catch {
            XCTAssertEqual(error as? PrivateCatalogError, .rejected("Catalog request failed"))
        }

        let timedOut = TestSocket()
        timedOut.receiveHandler = { socket in
            while !socket.cancellations.contains(.goingAway) { try await Task.sleep(nanoseconds: 100_000) }
            throw PrivateCatalogError.unavailable
        }
        do {
            _ = try await PrivateCatalogClient(crypto: crypto, socketFactory: { _ in
                PrivateCatalogSocketConnection(socket: timedOut, close: {})
            }, timeoutNanoseconds: 1).request(["type": "libcat.search"], signer: user, service: service)
            XCTFail("Expected timeout")
        } catch {
            XCTAssertTrue(timedOut.cancellations.contains(.goingAway))
        }

        let cancelled = TestSocket()
        cancelled.receiveHandler = { _ in try await Task.sleep(nanoseconds: 5_000_000_000); throw CancellationError() }
        let task = Task {
            try await PrivateCatalogClient(crypto: crypto, socketFactory: { _ in
                PrivateCatalogSocketConnection(socket: cancelled, close: {})
            }).request(["type": "libcat.search"], signer: user, service: service)
        }
        while !cancelled.resumed { await Task.yield() }
        task.cancel()
        _ = try? await task.value
        XCTAssertTrue(cancelled.cancellations.contains(.goingAway))
    }
}
