import Foundation
import CryptoKit

protocol NostrSigner {
    var publicKeyHex: String { get }
    func sign(_ event: NostrEvent) async throws -> NostrEvent
    func nip44Encrypt(_ plaintext: String, to recipientPubkey: String) async throws -> String
    func nip44Decrypt(_ ciphertext: String, from senderPubkey: String) async throws -> String
}

struct PrivateCatalogCrypto {
    let ephemeralSigner: () throws -> NostrSigner
    let verify: (NostrEvent) -> Bool
}

struct PrivateCatalogService {
    let pubkey: String
    let relay: URL
    static let libcat = PrivateCatalogService(
        pubkey: "83503e3e82744479362b04881a8f240bd6d838b78430035868f1c0826ec3876f",
        relay: URL(string: "wss://relay.nomadwiki.org")!)
}

enum PrivateCatalogError: LocalizedError {
    case invalidResponse, rejected(String), unavailable
    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid private catalog response"
        case .rejected(let message): return message
        case .unavailable: return "Private catalog unavailable. Try again."
        }
    }
}

// The wire codec is independent of the socket and signing implementation, so
// authentication, request correlation and malformed responses are testable.
struct PrivateCatalogWire {
    static func json(_ value: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes]), as: UTF8.self)
    }
    static func encode(_ event: NostrEvent) throws -> String {
        String(decoding: try JSONEncoder().encode(event), as: UTF8.self)
    }
    static func id(_ event: NostrEvent) throws -> String {
        let wire = try json([0, event.pubkey ?? "", event.createdAt, event.kind, event.tags, event.content])
        return SHA256.hash(data: Data(wire.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    static func wrap(payload: [String: Any], service: PrivateCatalogService, signer: NostrSigner,
                     crypto: PrivateCatalogCrypto, now: Int64) async throws -> NostrEvent {
        var rumor = NostrEvent(pubkey: signer.publicKeyHex, createdAt: now, kind: 14,
                              tags: [["p", service.pubkey]], content: try json(payload))
        rumor.id = try id(rumor)
        let sealText = try await signer.nip44Encrypt(encode(rumor), to: service.pubkey)
        let seal = try await signer.sign(NostrEvent(createdAt: now - Int64.random(in: 0...172800), kind: 13, tags: [], content: sealText))
        let ephemeral = try crypto.ephemeralSigner()
        let wrapText = try await ephemeral.nip44Encrypt(encode(seal), to: service.pubkey)
        return try await ephemeral.sign(NostrEvent(createdAt: now - Int64.random(in: 0...172800), kind: 1059,
            tags: [["p", service.pubkey], ["expiration", String(now + 600)]], content: wrapText))
    }
    static func unwrap(_ wrapped: NostrEvent, service: PrivateCatalogService, signer: NostrSigner,
                       crypto: PrivateCatalogCrypto, requestID: String, type: String) async throws -> [String: Any]? {
        guard wrapped.kind == 1059, wrapped.tags.contains(["p", signer.publicKeyHex]),
              crypto.verify(wrapped), let ephemeral = wrapped.pubkey else { return nil }
        let sealText = try await signer.nip44Decrypt(wrapped.content, from: ephemeral)
        let seal = try JSONDecoder().decode(NostrEvent.self, from: Data(sealText.utf8))
        guard seal.kind == 13, seal.pubkey == service.pubkey, crypto.verify(seal) else { return nil }
        let rumorText = try await signer.nip44Decrypt(seal.content, from: service.pubkey)
        let rumor = try JSONDecoder().decode(NostrEvent.self, from: Data(rumorText.utf8))
        guard rumor.kind == 14, rumor.pubkey == service.pubkey, rumor.sig == nil,
              rumor.tags.contains(["p", signer.publicKeyHex]), rumor.id == (try id(rumor)),
              let payload = try JSONSerialization.jsonObject(with: Data(rumor.content.utf8)) as? [String: Any],
              payload["request_id"] as? String == requestID, payload["type"] as? String == type + ".result" else { return nil }
        return payload
    }
}

final class PrivateCatalogClient {
    private let crypto: PrivateCatalogCrypto
    init(crypto: PrivateCatalogCrypto) { self.crypto = crypto }

    func request(_ payload: [String: Any], signer: NostrSigner,
                 service: PrivateCatalogService = .libcat) async throws -> [String: Any] {
        guard let type = payload["type"] as? String, service.relay.scheme == "wss" else { throw PrivateCatalogError.invalidResponse }
        let requestID = UUID().uuidString
        var body = payload; body["request_id"] = requestID; body["version"] = 1
        let now = Int64(Date().timeIntervalSince1970)
        let wrap = try await PrivateCatalogWire.wrap(payload: body, service: service, signer: signer, crypto: crypto, now: now)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 45
        let session = URLSession(configuration: configuration)
        let socket = session.webSocketTask(with: service.relay)
        socket.maximumMessageSize = 1024 * 1024
        socket.resume()
        let deadline = Task {
            do { try await Task.sleep(nanoseconds: 45_000_000_000); socket.cancel(with: .goingAway, reason: nil) } catch {}
        }
        defer { deadline.cancel(); socket.cancel(with: .normalClosure, reason: nil); session.invalidateAndCancel() }
        return try await withTaskCancellationHandler {
            let filter: [String: Any] = ["kinds": [1059], "#p": [signer.publicKeyHex], "limit": 0]
            try await socket.send(.string(PrivateCatalogWire.json(["REQ", requestID, filter])))
            var published = false
            while true {
                try Task.checkCancellation()
                let message = try await socket.receive()
                let data: Data
                switch message {
                case .string(let text): data = Data(text.utf8)
                case .data(let bytes): data = bytes
                @unknown default: continue
                }
                guard let frame = try? JSONSerialization.jsonObject(with: data) as? [Any], let action = frame.first as? String else { continue }
                if action == "EOSE", frame.count >= 2, frame[1] as? String == requestID, !published {
                    // Subscribe before publishing, so fast replies cannot be lost.
                    published = true
                    let eventObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(wrap))
                    try await socket.send(.string(PrivateCatalogWire.json(["EVENT", eventObject])))
                } else if action == "OK", frame.count >= 4, frame[1] as? String == wrap.id, frame[2] as? Bool == false {
                    throw PrivateCatalogError.rejected("Relay rejected the private catalog request")
                } else if action == "CLOSED", frame.count >= 2, frame[1] as? String == requestID {
                    throw PrivateCatalogError.unavailable
                } else if action == "EVENT", frame.count >= 3, frame[1] as? String == requestID,
                          let eventData = try? JSONSerialization.data(withJSONObject: frame[2]),
                          let event = try? JSONDecoder().decode(NostrEvent.self, from: eventData),
                          let response = try? await PrivateCatalogWire.unwrap(event, service: service, signer: signer,
                              crypto: crypto, requestID: requestID, type: type) {
                    guard response["status"] as? String == "ready" else {
                        throw PrivateCatalogError.rejected(response["error"] as? String ?? "Catalog request failed")
                    }
                    return response
                }
            }
        } onCancel: { socket.cancel(with: .goingAway, reason: nil) }
    }
}
