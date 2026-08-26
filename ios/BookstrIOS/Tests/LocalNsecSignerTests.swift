import XCTest
import NostrCore
@testable import BookstrIOS

final class LocalNsecSignerTests: XCTestCase {
    func testLocalNsecSignerSignsEventWithExpectedShape() async throws {
        let keyPair = try KeyPair()
        let signer = LocalNsecSigner(nsec: keyPair.nsec, publicKeyHex: keyPair.publicKeyHex)

        let unsigned = NostrEvent(
            id: nil,
            pubkey: keyPair.publicKeyHex,
            createdAt: 1_700_000_000,
            kind: NostrKinds.progress,
            tags: [["t", "read"]],
            content: "signed-content",
            sig: nil
        )

        let signed = try await signer.sign(unsigned)

        XCTAssertEqual(signed.kind, NostrKinds.progress)
        XCTAssertEqual(signed.pubkey, keyPair.publicKeyHex)
        XCTAssertEqual(signed.tags, [["t", "read"]])
        XCTAssertNotNil(signed.sig)
    }

    func testLocalNsecSignerEncryptAndDecryptRoundTrip() async throws {
        let keyPair = try KeyPair()
        let signer = LocalNsecSigner(nsec: keyPair.nsec, publicKeyHex: keyPair.publicKeyHex)
        let plaintext = "hello local signer"

        let ciphertext = try await signer.nip44Encrypt(plaintext, to: keyPair.publicKeyHex)
        let decrypted = try await signer.nip44Decrypt(ciphertext, from: keyPair.publicKeyHex)

        XCTAssertEqual(decrypted, plaintext)
    }

    func testLocalNsecSignerRejectsInvalidNsecFormat() async {
        let signer = LocalNsecSigner(nsec: "invalid-nsec", publicKeyHex: String(repeating: "a", count: 64))
        let unsigned = NostrEvent(
            id: nil,
            pubkey: signer.publicKeyHex,
            createdAt: 1,
            kind: NostrKinds.progress,
            tags: [],
            content: "",
            sig: nil
        )

        do {
            _ = try await signer.sign(unsigned)
            XCTFail("Expected invalid nsec to throw")
        } catch {
            XCTAssertTrue(error is Error)
        }
    }
}
