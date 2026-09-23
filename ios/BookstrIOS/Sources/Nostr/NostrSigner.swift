import Foundation
import CryptoKit
import NostrCore

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

extension PrivateCatalogCrypto {
    static let native = PrivateCatalogCrypto(ephemeralSigner: {
        let key = try KeyPair()
        return LocalNsecSigner(nsec: try key.nsec, publicKeyHex: key.publicKeyHex)
    }, verify: { event in
        guard let data = try? JSONEncoder().encode(event),
              let signed = try? JSONDecoder().decode(Event.self, from: data) else { return false }
        return (try? signed.verify()) == true
    })
}
