import XCTest
@testable import BookstrIOS

final class Nip46ServiceTests: XCTestCase {
    private func makeSettings(authMode: NostrAuthMode) -> (SettingsRepository, String) {
        let suite = "bookstr-nip46-service-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let settings = SettingsRepository(defaults: defaults)
        settings.authMode = authMode
        return (settings, suite)
    }

    func testHasLiveSignerStartsFalse() async {
        let service = Nip46Service()
        XCTAssertFalse(await service.hasLiveSigner())
    }

    func testDisconnectIsIdempotentWithoutSession() async {
        let service = Nip46Service()
        await service.disconnect()
        XCTAssertFalse(await service.hasLiveSigner())
    }

    func testRestoreStatusForNoCredentialsThenReconnect() async {
        let (settings, suite) = makeSettings(authMode: .nip46)
        defer { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }

        let service = Nip46Service()

        await service.restore(from: settings)
        XCTAssertTrue((await service.restoreStatus()).hasPrefix("missing credentials"))

        settings.nip46ClientSecret = "client-secret"
        settings.nip46BunkerURL = "not-a-bunker://url"
        await service.reconnect(from: settings)

        XCTAssertTrue((await service.restoreStatus()).hasPrefix("restore failed:"))
    }

    func testBunkerURLRejectsInvalidPubkey() async {
        let service = Nip46Service()
        let relay = URL(string: "wss://relay.nomadwiki.org")!

        do {
            _ = try await service.bunkerURL(remoteSignerPubkey: "zz", relays: [relay])
            XCTFail("Expected invalid pubkey to throw")
        } catch {
            XCTAssertTrue(error is Error)
        }
    }

    func testHasLiveSignerAfterStartQrSessionWithEmptyRelaysReturnsErrorAndFalse() async {
        let service = Nip46Service()
        XCTAssertFalse(await service.hasLiveSigner())
        do {
            _ = try await service.startQrSession(relays: [])
            XCTFail("Expected missing relay")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .missingRelay)
        }
        XCTAssertFalse(await service.hasLiveSigner())
    }

    func testRestoreStatusStartsAsNotAttempted() async {
        let service = Nip46Service()
        XCTAssertEqual(await service.restoreStatus(), "not attempted")
    }

    func testRestoreWithoutNip46CredentialsRecordsMissingCredentialStatus() async {
        let (settings, suite) = makeSettings(authMode: .nip46)
        let service = Nip46Service()
        defer {
            settings.nip46ClientSecret = nil
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
        }

        await service.restore(from: settings)
        XCTAssertEqual(await service.restoreStatus(), "missing credentials secret=false bunker=missing")
        XCTAssertFalse(await service.hasLiveSigner())
    }

    func testRestoreWithOnlySecretRecordsMissingBunkerStatus() async {
        let (settings, suite) = makeSettings(authMode: .nip46)
        let service = Nip46Service()
        defer {
            settings.nip46ClientSecret = nil
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
        }

        settings.nip46ClientSecret = "client-secret"
        await service.restore(from: settings)

        XCTAssertEqual(await service.restoreStatus(), "missing credentials secret=true bunker=missing")
        XCTAssertFalse(await service.hasLiveSigner())
    }

    func testRestoreWithWrongAuthModeOnlyReportsMode() async {
        let (settings, suite) = makeSettings(authMode: .none)
        let service = Nip46Service()
        defer {
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
        }

        await service.restore(from: settings)
        XCTAssertEqual(await service.restoreStatus(), "auth mode is none")
        XCTAssertFalse(await service.hasLiveSigner())
    }

    func testAwaitConnectionRequiresSessionStarted() async {
        let service = Nip46Service()
        do {
            _ = try await service.awaitConnection()
            XCTFail("Expected sessionNotStarted")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .sessionNotStarted)
        }
    }

    func testStartQrSessionRequiresRelayURLs() async {
        let service = Nip46Service()
        do {
            _ = try await service.startQrSession(relays: [])
            XCTFail("Expected missingRelay")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .missingRelay)
        }
    }

    func testStartQrSessionFiltersInvalidRelayURLs() async {
        let service = Nip46Service()
        do {
            let session = try await service.startQrSession(
                relays: ["not a relay", "wss://relay.nomadwiki.org"],
            )

            XCTAssertEqual(session.relays.count, 1)
            XCTAssertEqual(session.relays.first?.absoluteString, "wss://relay.nomadwiki.org")
            XCTAssertTrue(await service.hasLiveSigner())

            await service.disconnect()
            XCTAssertFalse(await service.hasLiveSigner())
        } catch {
            XCTFail("Expected startQrSession to succeed with one valid relay")
        }
    }

    func testStartQrSessionRejectsOnlyInvalidRelayURLs() async {
        let service = Nip46Service()
        do {
            _ = try await service.startQrSession(relays: ["not a relay", ":::not-a-url", " "])
            XCTFail("Expected missingRelay")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .missingRelay)
        }
    }

    func testReconnectWithoutCredentialsReturnsMissingCredentialsStatus() async {
        let (settings, suite) = makeSettings(authMode: .nip46)
        defer {
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
        }

        let service = Nip46Service()

        await service.reconnect(from: settings)
        XCTAssertEqual(await service.restoreStatus(), "missing credentials secret=false bunker=missing")
    }

    func testRestoreWithValidCredentialsCreatesLiveSigner() async throws {
        let (settings, suite) = makeSettings(authMode: .nip46)
        defer {
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
        }

        let service = Nip46Service()
        let keyPair = try KeyPair()
        let bunkerURL = try service.bunkerURL(remoteSignerPubkey: String(repeating: "ab", count: 32), relays: [
            URL(string: "wss://relay.nostr.band")!,
        ])

        settings.nip46ClientSecret = try keyPair.nsec
        settings.nip46BunkerURL = bunkerURL
        await service.restore(from: settings)

        XCTAssertEqual(await service.restoreStatus(), "session ready (connect deferred)")
        XCTAssertTrue(await service.hasLiveSigner())
        await service.disconnect()
        XCTAssertFalse(await service.hasLiveSigner())
    }

    func testRestoreKeepsExistingSignerWhenAlreadyLive() async throws {
        let (settings, suite) = makeSettings(authMode: .nip46)
        defer {
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
        }

        let service = Nip46Service()
        let keyPair = try KeyPair()
        let bunkerURL = try service.bunkerURL(
            remoteSignerPubkey: String(repeating: "ab", count: 32),
            relays: [URL(string: "wss://relay.nostr.band")!],
        )

        settings.nip46ClientSecret = try keyPair.nsec
        settings.nip46BunkerURL = bunkerURL

        await service.restore(from: settings)
        XCTAssertTrue(await service.hasLiveSigner())

        await service.restore(from: settings)

        XCTAssertTrue(await service.hasLiveSigner())
        XCTAssertEqual(await service.restoreStatus(), "already live")
    }

    func testBunkerURLBuildsBunkerSchemeForValidInputs() async {
        let service = Nip46Service()
        do {
            let relay = URL(string: "wss://relay.nomadwiki.org")!
            let bunkerURL = try await service.bunkerURL(remoteSignerPubkey: String(repeating: "ab", count: 32), relays: [relay])
            XCTAssertTrue(bunkerURL.hasPrefix("bunker://"))
            XCTAssertNotNil(URL(string: bunkerURL))
        } catch {
            XCTFail("Unexpected error building bunker URL: \(error)")
        }
    }

    func testUserPublicKeyThrowsWhenSignerUnavailable() async {
        let service = Nip46Service()
        do {
            _ = try await service.userPublicKey()
            XCTFail("Expected notConnected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testNip44DecryptThrowsWhenSignerUnavailable() async {
        let service = Nip46Service()
        do {
            _ = try await service.nip44Decrypt("ciphertext", from: "00".repeating(32))
            XCTFail("Expected notConnected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testNip44EncryptThrowsWhenSignerUnavailable() async {
        let service = Nip46Service()
        do {
            _ = try await service.nip44Encrypt("plaintext", to: "00".repeating(32))
            XCTFail("Expected notConnected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }
}
