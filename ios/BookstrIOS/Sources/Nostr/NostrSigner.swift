import Foundation
import CryptoKit
import NostrCore

protocol NostrSigner {
    var publicKeyHex: String { get }
    func sign(_ event: NostrEvent) async throws -> NostrEvent
    func nip44Encrypt(_ plaintext: String, to recipientPubkey: String) async throws -> String
    func nip44Decrypt(_ ciphertext: String, from senderPubkey: String) async throws -> String
}

struct LocalNsecSigner: NostrSigner {
    let nsec: String
    let publicKeyHex: String

    func sign(_ event: NostrEvent) async throws -> NostrEvent {
        let unsigned = UnsignedEvent(
            pubkey: publicKeyHex,
            createdAt: event.createdAt,
            kind: Event.Kind(rawValue: event.kind),
            rawTags: event.tags,
            content: event.content
        )
        let signed = try EventSigner(nsec: nsec).sign(unsigned)
        return NostrEvent(id: signed.id, pubkey: signed.pubkey, createdAt: signed.createdAt,
                          kind: signed.kind.rawValue, tags: signed.tags, content: signed.content, sig: signed.sig)
    }

    func nip44Encrypt(_ plaintext: String, to recipientPubkey: String) async throws -> String {
        try EventSigner(nsec: nsec).nip44Encrypt(plaintext, to: recipientPubkey)
    }

    func nip44Decrypt(_ ciphertext: String, from senderPubkey: String) async throws -> String {
        try EventSigner(nsec: nsec).nip44Decrypt(ciphertext, from: senderPubkey)
    }
}

final class SignerStore {
    private let nip46Service: Nip46Service

    init(nip46Service: Nip46Service) {
        self.nip46Service = nip46Service
    }

    func signer(from settings: SettingsRepository) -> NostrSigner? {
        if settings.authMode == .nsec, let nsec = settings.nsec, let pubkey = settings.pubkeyHex {
            return LocalNsecSigner(nsec: nsec, publicKeyHex: pubkey)
        }
        if settings.authMode == .nip46, let pubkey = settings.pubkeyHex {
            return Nip46Signer(publicKeyHex: pubkey, nip46Service: nip46Service)
        }
        return nil
    }
}

struct Nip46Signer: NostrSigner {
    let publicKeyHex: String
    let nip46Service: Nip46Service

    func sign(_ event: NostrEvent) async throws -> NostrEvent {
        try await nip46Service.signEvent(event)
    }

    func nip44Encrypt(_ plaintext: String, to recipientPubkey: String) async throws -> String {
        try await nip46Service.nip44Encrypt(plaintext, to: recipientPubkey)
    }

    func nip44Decrypt(_ ciphertext: String, from senderPubkey: String) async throws -> String {
        try await nip46Service.nip44Decrypt(ciphertext, from: senderPubkey)
    }
}

enum BlossomAuthorization {
    static func get(signer: NostrSigner, hash: String, server: String, now: Int64? = nil) async throws -> String {
        guard hash.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil else {
            throw NSError(domain: "BlossomAuthorization", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid Blossom SHA-256"])
        }
        guard !server.isEmpty, !server.contains("/") else {
            throw NSError(domain: "BlossomAuthorization", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid Blossom server name"])
        }
        let timestamp = now ?? Int64(Date().timeIntervalSince1970)
        let event = NostrEvent(
            id: nil,
            pubkey: signer.publicKeyHex,
            createdAt: timestamp,
            kind: 24_242,
            tags: [
                ["t", "get"],
                ["expiration", String(timestamp + 120)],
                ["server", server],
                ["x", hash.lowercased()]
            ],
            content: "Download a Bookstr book",
            sig: nil
        )
        let signed = try await signer.sign(event)
        let encoded = try JSONEncoder().encode(signed).base64EncodedString().replacingOccurrences(of: "=", with: "")
        return "Nostr \(encoded)"
    }
}
