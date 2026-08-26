import XCTest
@testable import BookstrIOS

final class Nip46SignerTests: XCTestCase {
    func testNip46SignerSignPropagatesNotConnected() async {
        let signer = Nip46Signer(publicKeyHex: String(repeating: "a", count: 64), nip46Service: Nip46Service())

        do {
            _ = try await signer.sign(
                NostrEvent(
                    id: nil,
                    pubkey: nil,
                    createdAt: 1,
                    kind: NostrKinds.progress,
                    tags: [],
                    content: "",
                    sig: nil
                )
            )
            XCTFail("Expected notConnected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testNip46SignerEncryptPropagatesNotConnected() async {
        let signer = Nip46Signer(publicKeyHex: String(repeating: "b", count: 64), nip46Service: Nip46Service())

        do {
            _ = try await signer.nip44Encrypt("plain", to: String(repeating: "c", count: 64))
            XCTFail("Expected notConnected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testNip46SignerDecryptPropagatesNotConnected() async {
        let signer = Nip46Signer(publicKeyHex: String(repeating: "d", count: 64), nip46Service: Nip46Service())

        do {
            _ = try await signer.nip44Decrypt("cipher", from: String(repeating: "e", count: 64))
            XCTFail("Expected notConnected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }
}
