import Foundation
import XCTest
@testable import BookstrIOS

final class BlossomAuthorizationTests: XCTestCase {
    func testSignerStoreReturnsCorrectSignerByMode() {
        let suiteName = "bookstr-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let settings = SettingsRepository(defaults: defaults)
        let signerStore = SignerStore(nip46Service: Nip46Service())

        XCTAssertNil(signerStore.signer(from: settings))

        settings.authMode = .nsec
        settings.nsec = "nsec1test"
        XCTAssertNil(signerStore.signer(from: settings))

        settings.pubkeyHex = String(repeating: "AA", count: 16)
        XCTAssertTrue(signerStore.signer(from: settings) is LocalNsecSigner)

        settings.authMode = .nip46
        settings.nsec = nil
        XCTAssertTrue(signerStore.signer(from: settings) is Nip46Signer)

        settings.authMode = .none
        XCTAssertNil(signerStore.signer(from: settings))
    }

    func testSignerStoreReturnsNip46WhenAuthModeNip46EvenWithNsecSet() {
        let suiteName = "bookstr-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let settings = SettingsRepository(defaults: defaults)
        let signerStore = SignerStore(nip46Service: Nip46Service())

        settings.authMode = .nsec
        settings.pubkeyHex = String(repeating: "a", count: 64)
        settings.nsec = "nsec1test"
        XCTAssertTrue(signerStore.signer(from: settings) is LocalNsecSigner)

        settings.authMode = .nip46
        XCTAssertTrue(signerStore.signer(from: settings) is Nip46Signer)
    }

    func testSignerStoreRequiresNsecCredentials() {
        let suiteName = "bookstr-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let settings = SettingsRepository(defaults: defaults)
        settings.nsec = nil
        let signerStore = SignerStore(nip46Service: Nip46Service())

        settings.authMode = .nsec
        settings.pubkeyHex = String(repeating: "AA", count: 16)
        XCTAssertNil(signerStore.signer(from: settings))

        settings.nsec = "nsec1test"
        settings.pubkeyHex = nil
        XCTAssertNil(signerStore.signer(from: settings))
    }

    func testSignerStoreReturnsNilForNip46WithoutPubkey() {
        let suiteName = "bookstr-tests-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let settings = SettingsRepository(defaults: defaults)
        let signerStore = SignerStore(nip46Service: Nip46Service())

        settings.authMode = .nip46
        XCTAssertNil(signerStore.signer(from: settings))
    }

    func testBlossomAuthorizationRejectsInvalidInputs() async {
        let signer = CapturingSigner()
        let invalidHash = "not-a-hash"
        let invalidServer = "not-a-server/path"

        do {
            _ = try await BlossomAuthorization.get(signer: signer, hash: invalidHash, server: "blossom")
            XCTFail("Expected invalid hash to throw")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("Invalid Blossom SHA-256"))
        }

        do {
            _ = try await BlossomAuthorization.get(signer: signer, hash: String(repeating: "a", count: 64), server: invalidServer)
            XCTFail("Expected invalid server to throw")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("Invalid Blossom server name"))
        }
    }

    func testBlossomAuthorizationRejectsEmptyHash() async {
        let signer = ThrowingSigner()

        do {
            _ = try await BlossomAuthorization.get(signer: signer, hash: "", server: "blossom")
            XCTFail("Expected empty hash to throw")
        } catch {
            let asNSError = error as NSError
            XCTAssertEqual(asNSError.domain, "BlossomAuthorization")
            XCTAssertEqual(asNSError.code, 1)
            XCTAssertTrue(asNSError.localizedDescription.contains("Invalid Blossom SHA-256"))
        }
    }

    func testBlossomAuthorizationAllowsUppercaseHashAndUsesDeterministicTimestamp() async throws {
        let signer = CapturingSigner()
        let now: Int64 = 1_700_000_000
        let token = try await BlossomAuthorization.get(
            signer: signer,
            hash: String(repeating: "B", count: 64),
            server: "blossom",
            now: now,
        )

        let signed = try XCTUnwrap(signer.seenSignatures.last)
        XCTAssertEqual(token.hasPrefix("Nostr "), true)
        XCTAssertEqual(signed.tags[1].first, "expiration")
        XCTAssertEqual(signed.tags[1].last, String(now + 120))
        XCTAssertEqual(signed.tags[3], ["x", String(repeating: "b", count: 64)])
    }

    func testBlossomAuthorizationUsesBase64WithoutPadding() async throws {
        let signer = CapturingSigner()

        let token = try await BlossomAuthorization.get(
            signer: signer,
            hash: String(repeating: "c", count: 64),
            server: "blossom",
            now: 1_700_000_001,
        )

        let encoded = token.replacingOccurrences(of: "Nostr ", with: "")
        XCTAssertFalse(encoded.contains("="))

        guard let decodedData = Data(base64Encoded: encoded) else {
            XCTFail("Expected valid base64 payload")
            return
        }

        let decodedObject = try JSONSerialization.jsonObject(with: decodedData) as? [String: Any]
        let tags = decodedObject?["tags"] as? [[String]]
        let hashTag = tags?.first(where: { $0.first == "x" })

        XCTAssertEqual(hashTag, ["x", String(repeating: "c", count: 64)])
    }

    func testBlossomAuthorizationRejectsEmptyServer() async {
        let signer = CapturingSigner()
        do {
            _ = try await BlossomAuthorization.get(signer: signer, hash: String(repeating: "a", count: 64), server: "")
            XCTFail("Expected empty server to throw")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("Invalid Blossom server name"))
        }
    }

    func testBlossomAuthorizationBubblesSignerFailure() async {
        let signer = ThrowingSigner()
        do {
            _ = try await BlossomAuthorization.get(
                signer: signer,
                hash: String(repeating: "a", count: 64),
                server: "blossom",
            )
            XCTFail("Expected signer failure to throw")
        } catch {
            XCTAssertEqual((error as NSError).domain, "SignerFailure")
            XCTAssertEqual((error as NSError).code, 9)
        }
    }

    func testBlossomAuthorizationRejectsWhitespacePrefixedHash() async {
        let signer = CapturingSigner()

        do {
            _ = try await BlossomAuthorization.get(
                signer: signer,
                hash: "  \(String(repeating: "a", count: 64))",
                server: "blossom",
            )
            XCTFail("Expected invalid hash to throw")
        } catch {
            XCTAssertTrue((error as NSError).localizedDescription.contains("Invalid Blossom SHA-256"))
        }
    }

    func testBlossomAuthorizationBuildsSignedToken() async throws {
        let signer = CapturingSigner()
        let token = try await BlossomAuthorization.get(
            signer: signer,
            hash: String(repeating: "a", count: 64),
            server: "blossom",
        )

        XCTAssertTrue(token.hasPrefix("Nostr "))
        XCTAssertEqual(signer.publicKeyHex, signer.seenSignatures.last?.pubkey)
        XCTAssertEqual(signer.seenSignatures.last?.kind, 24_242)
        XCTAssertEqual(signer.seenSignatures.last?.tags.first, ["t", "get"])
        XCTAssertEqual(signer.seenSignatures.last?.tags.count, 4)
    }
}

private final class CapturingSigner: NostrSigner {
    let publicKeyHex = String(repeating: "a", count: 64)
    var seenSignatures: [NostrEvent] = []

    func sign(_ event: NostrEvent) async throws -> NostrEvent {
        var signed = event
        signed.sig = "captured-signature"
        seenSignatures.append(signed)
        return signed
    }

    func nip44Encrypt(_ plaintext: String, to recipientPubkey: String) async throws -> String {
        "nip44:\(recipientPubkey):\(plaintext)"
    }

    func nip44Decrypt(_ ciphertext: String, from senderPubkey: String) async throws -> String {
        "nip44:\(senderPubkey):\(ciphertext)"
    }
}

private final class ThrowingSigner: NostrSigner {
    let publicKeyHex = String(repeating: "b", count: 64)

    func sign(_ event: NostrEvent) async throws -> NostrEvent {
        struct Failure: LocalizedError {
            var errorDescription: String? {
                "deterministic signer failure"
            }
        }
        throw NSError(domain: "SignerFailure", code: 9, userInfo: [NSLocalizedDescriptionKey: Failure().localizedDescription])
    }

    func nip44Encrypt(_ plaintext: String, to recipientPubkey: String) async throws -> String {
        throw NSError(domain: "SignerFailure", code: 10, userInfo: [NSLocalizedDescriptionKey: "Signer failure"])
    }

    func nip44Decrypt(_ ciphertext: String, from senderPubkey: String) async throws -> String {
        throw NSError(domain: "SignerFailure", code: 10, userInfo: [NSLocalizedDescriptionKey: "Signer failure"])
    }
}
