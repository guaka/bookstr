import XCTest
@testable import BookstrIOS

final class SettingsRepositoryTests: XCTestCase {
    func testThemePersistsAcrossInstances() {
        let suite = "bookstr-theme-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let first = SettingsRepository(defaults: defaults)
        first.theme = .night
        let second = SettingsRepository(defaults: defaults)
        XCTAssertEqual(second.theme, .night)
        defaults.removePersistentDomain(forName: suite)
    }

    func testFavoritesCacheStoresEventId() {
        let suite = "bookstr-fav-cache-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repo = SettingsRepository(defaults: defaults)
        repo.cacheNostrFavorites(pubkey: "ABC", plaintext: "[[\"e\",\"1\"]]", eventId: "evt-1")
        XCTAssertEqual(repo.cachedNostrFavorites(pubkey: "abc"), "[[\"e\",\"1\"]]")
        XCTAssertEqual(repo.cachedFavoritesEventId(pubkey: "ABC"), "evt-1")
        defaults.removePersistentDomain(forName: suite)
    }

    func testCachedFavoritesEventIdRequiresMatchingPubkey() {
        let suite = "bookstr-fav-cache-event-mismatch-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.cacheNostrFavorites(pubkey: "ABC", plaintext: "[[\"e\",\"1\"]]", eventId: "evt-1")
        XCTAssertEqual(repository.cachedNostrFavorites(pubkey: "ABC"), "[[\"e\",\"1\"]]")
        XCTAssertEqual(repository.cachedFavoritesEventId(pubkey: "ABC"), "evt-1")
        XCTAssertNil(repository.cachedFavoritesEventId(pubkey: "DEF"))

        defaults.removePersistentDomain(forName: suite)
    }

    func testCachedFavoritesEventIdMatchesCaseInsensitivePubkey() {
        let suite = "bookstr-fav-cache-event-case-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.cacheNostrFavorites(pubkey: "AbC", plaintext: "[\"e\",\"1\"]", eventId: "evt-1")
        XCTAssertEqual(repository.cachedFavoritesEventId(pubkey: "abc"), "evt-1")
        XCTAssertEqual(repository.cachedFavoritesEventId(pubkey: "ABC"), "evt-1")

        defaults.removePersistentDomain(forName: suite)
    }

    func testCacheNostrFavoritesWithoutEventIdKeepsExistingEventId() {
        let suite = "bookstr-fav-cache-event-id-sticky-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.cacheNostrFavorites(pubkey: "abc", plaintext: "[\"old\"]", eventId: "evt-old")
        repository.cacheNostrFavorites(pubkey: "abc", plaintext: "[\"new\"]")

        XCTAssertEqual(repository.cachedFavoritesEventId(pubkey: "ABC"), "evt-old")
        XCTAssertEqual(repository.cachedNostrFavorites(pubkey: "ABC"), "[\"new\"]")

        defaults.removePersistentDomain(forName: suite)
    }

    func testRelaysTrimAndSplitOnLoadAndPersistOnSet() {
        let suite = "bookstr-relays-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("wss://a.io\n  \n wss://b.io,   ,wss://c.io", forKey: "relays")
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertEqual(repository.relays, ["wss://a.io", "wss://b.io", "wss://c.io"])
        repository.relays = ["wss://x.io", "wss://y.io"]
        XCTAssertEqual(defaults.string(forKey: "relays"), "wss://x.io\nwss://y.io")
        defaults.removePersistentDomain(forName: suite)
    }

    func testSpeechRateDefaultsWhenMissingAndClampsStoredValue() {
        let suite = "bookstr-speech-rate-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set(1.2, forKey: "speech_rate")
        var repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.speechRate, 0.6)
        repository.speechRate = 0.1
        repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.speechRate, 0.35)
        defaults.removePersistentDomain(forName: suite)
    }

    func testSpeechRatePersistsAndClampsExcessiveValues() {
        let suite = "bookstr-speech-rate-max-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        defaults.set(0.99, forKey: "speech_rate")
        XCTAssertEqual(SettingsRepository(defaults: defaults).speechRate, 0.60)

        repository.speechRate = 1.0
        XCTAssertEqual(repository.speechRate, 1.0)
        defaults.removePersistentDomain(forName: suite)
    }

    func testSpeechRateReloadClampsPersistedValue() {
        let suite = "bookstr-speech-rate-reload-clamp-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let repository = SettingsRepository(defaults: defaults)
        repository.speechRate = 1.0
        XCTAssertEqual(repository.speechRate, 1.0)

        let reloaded = SettingsRepository(defaults: defaults)
        XCTAssertEqual(reloaded.speechRate, 0.6)

        defaults.removePersistentDomain(forName: suite)
    }

    func testSpeechRatePersistsNegativeValueAndClampsOnReload() {
        let suite = "bookstr-speech-rate-negative-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set(-0.2, forKey: "speech_rate")
        XCTAssertEqual(SettingsRepository(defaults: defaults).speechRate, 0.35)

        let repository = SettingsRepository(defaults: defaults)
        repository.speechRate = -0.8
        XCTAssertEqual(SettingsRepository(defaults: defaults).speechRate, 0.35)

        defaults.removePersistentDomain(forName: suite)
    }

    func testSpeechRateDefaultsTo48WhenStoredValueIsZero() {
        let suite = "bookstr-speech-rate-zero-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set(0, forKey: "speech_rate")

        XCTAssertEqual(SettingsRepository(defaults: defaults).speechRate, 0.48)
        defaults.removePersistentDomain(forName: suite)
    }

    func testSpeechRatePersistsAcrossInstances() {
        let suite = "bookstr-speech-rate-instance-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        var repository = SettingsRepository(defaults: defaults)

        repository.speechRate = 0.42
        XCTAssertEqual(repository.speechRate, 0.42)
        repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.speechRate, 0.42)

        defaults.removePersistentDomain(forName: suite)
    }

    func testNsecTrimmedValueCanBeClearedAcrossInstances() {
        let suite = "bookstr-nsec-trim-instance-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defer { SettingsRepository(defaults: defaults).nsec = nil }

        let repository = SettingsRepository(defaults: defaults)
        repository.nsec = "   shared-secret   "
        XCTAssertEqual(repository.nsec, "shared-secret")

        repository.nsec = "   "
        XCTAssertNil(repository.nsec)

        XCTAssertNil(SettingsRepository(defaults: defaults).nsec)
        defaults.removePersistentDomain(forName: suite)
    }

    func testLastApplicationDataSyncPersistsAcrossInstances() {
        let suite = "bookstr-app-sync-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)
        let syncDate = Date(timeIntervalSince1970: 1_700_000_000)

        repository.lastApplicationDataSync = syncDate
        XCTAssertEqual(SettingsRepository(defaults: defaults).lastApplicationDataSync, syncDate)

        defaults.removePersistentDomain(forName: suite)
    }

    func testLastApplicationDataSyncClearsStoredValue() {
        let suite = "bookstr-app-sync-clear-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.lastApplicationDataSync = Date(timeIntervalSinceNow: -3600)
        XCTAssertNotNil(repository.lastApplicationDataSync)

        repository.lastApplicationDataSync = nil
        XCTAssertNil(repository.lastApplicationDataSync)

        defaults.removePersistentDomain(forName: suite)
    }

    func testKeepDownloadedCollectionsRoundTrips() {
        let suite = "bookstr-collections-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertFalse(repository.keepsCollectionDownloaded("book-1"))
        repository.setKeepCollectionDownloaded("book-1", enabled: true)
        XCTAssertTrue(repository.keepsCollectionDownloaded("book-1"))
        repository.setKeepCollectionDownloaded("book-1", enabled: false)
        XCTAssertFalse(repository.keepsCollectionDownloaded("book-1"))
        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionPersistsThenClears() {
        let suite = "bookstr-reader-session-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)
        let session = ReaderSession(
            bookId: "book-1",
            bookTitle: "Local",
            format: .epub,
            author: "Author",
            year: "2025",
            locator: "{\"cfi\":\"/6/2\"}",
            pageIndex: -1,
            pageOffset: -2,
        )

        repository.saveReaderSession(session)
        let loaded = repository.readerSession()
        XCTAssertNotNil(loaded)
        XCTAssertEqual(loaded?.bookId, "book-1")
        XCTAssertEqual(loaded?.pageIndex, 0)
        XCTAssertEqual(loaded?.pageOffset, 0)

        repository.clearReaderSession()
        XCTAssertNil(repository.readerSession())
        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilForMalformedStoredData() {
        let suite = "bookstr-reader-session-malformed-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set(Data("not-json".utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)

        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNostrIdentityMatchesNsecAndAmberRequirements() {
        let suite = "bookstr-has-nostr-id-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .none
        repository.nsec = "nsec"
        repository.pubkeyHex = "ABC"
        repository.signerPackage = "com.example.amber"
        XCTAssertFalse(repository.hasNostrIdentity)

        repository.authMode = .nsec
        XCTAssertFalse(repository.hasNostrIdentity)
        repository.nsec = nil
        repository.nsec = "nsec1"
        XCTAssertTrue(repository.hasNostrIdentity)

        repository.authMode = .amber
        XCTAssertFalse(repository.hasNostrIdentity)
        repository.signerPackage = "com.example.amber"
        XCTAssertFalse(repository.hasNostrIdentity)
        repository.pubkeyHex = "abc"
        XCTAssertTrue(repository.hasNostrIdentity)
        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNostrIdentityDependsOnAuthModeEvenWhenDataExists() {
        let suite = "bookstr-has-identity-mode-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.nsec = "nsec-value"
        repository.pubkeyHex = "abc"
        repository.signerPackage = "com.example.amber"
        repository.authMode = .none

        XCTAssertFalse(repository.hasNostrIdentity)

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNip46SessionCredentialsChecksAllInputs() {
        let suite = "bookstr-nip46-credentials-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .nip46
        repository.nip46ClientSecret = "secret"
        repository.nip46BunkerURL = "https://example.com/bunker"
        XCTAssertFalse(repository.hasNip46SessionCredentials)

        repository.nip46BunkerURL = "bunker://b2"
        XCTAssertTrue(repository.hasNip46SessionCredentials)

        repository.authMode = .none
        XCTAssertFalse(repository.hasNip46SessionCredentials)
        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNip46SessionCredentialsRequiresSecret() {
        let suite = "bookstr-nip46-credentials-secret-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .nip46
        repository.nip46BunkerURL = "bunker://relay"
        repository.nip46ClientSecret = ""
        XCTAssertFalse(repository.hasNip46SessionCredentials)

        repository.nip46ClientSecret = "secret"
        XCTAssertTrue(repository.hasNip46SessionCredentials)

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNostrIdentityForNip46RequiresModeAndPubkey() {
        let suite = "bookstr-has-identity-nip46-mode-requirement-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .none
        repository.pubkeyHex = "ABC"
        XCTAssertFalse(repository.hasNostrIdentity)

        repository.authMode = .nip46
        repository.pubkeyHex = "   "
        XCTAssertFalse(repository.hasNostrIdentity)

        repository.pubkeyHex = "abc"
        XCTAssertTrue(repository.hasNostrIdentity)

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNostrIdentityForNip46RequiresBunkerUrlPrefix() {
        let suite = "bookstr-has-identity-nip46-bunker-prefix-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .nip46
        repository.pubkeyHex = "abc"
        repository.nip46ClientSecret = nil

        repository.nip46BunkerURL = "https://example.com/bunker"
        repository.nip46ClientSecret = "secret"
        XCTAssertFalse(repository.hasNostrIdentity)

        repository.nip46BunkerURL = "bunker://relay"
        XCTAssertTrue(repository.hasNostrIdentity)

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNostrIdentityForNip46RequiresClientSecret() {
        let suite = "bookstr-has-identity-nip46-secret-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .nip46
        repository.pubkeyHex = "abc"
        repository.nip46BunkerURL = "bunker://relay"
        repository.nip46ClientSecret = nil
        XCTAssertFalse(repository.hasNostrIdentity)

        repository.nip46ClientSecret = "  secret  "
        XCTAssertEqual(repository.nip46ClientSecret, "secret")
        XCTAssertTrue(repository.hasNostrIdentity)

        defaults.removePersistentDomain(forName: suite)
    }

    func testNip46ClientSecretClearRemovesStoredValue() {
        let suite = "bookstr-nip46-secret-clear-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.nip46ClientSecret = "secret"
        XCTAssertEqual(repository.nip46ClientSecret, "secret")

        repository.nip46ClientSecret = ""
        XCTAssertNil(repository.nip46ClientSecret)

        defaults.removePersistentDomain(forName: suite)
    }

    func testNip46ClientSecretTrimsWhitespaceBeforePersisting() {
        let suite = "bookstr-nip46-secret-whitespace-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.nip46ClientSecret = "  secret-key  "
        XCTAssertEqual(repository.nip46ClientSecret, "secret-key")

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46NormalizesPubkeysAndClearsLegacyCredentials() {
        let suite = "bookstr-connect-nip46-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.signerPackage = "com.example.amber"
        repository.pubkeyHex = "OLDKEY"
        repository.nsec = "nsec1"
        repository.connectNip46(pubkeyHex: "AABBCC", bunkerURL: "bunker://abc", clientSecret: "secret", clientPubkey: "DDEEFF")

        XCTAssertEqual(repository.authMode, .nip46)
        XCTAssertEqual(repository.pubkeyHex, "aabbcc")
        XCTAssertNil(repository.signerPackage)
        XCTAssertNil(repository.nsec)
        XCTAssertEqual(repository.nip46ClientPubkey, "ddeeff")
        XCTAssertEqual(repository.nip46BunkerURL, "bunker://abc")
        XCTAssertEqual(repository.nip46ClientSecret, "secret")
        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46PostsIdentityDidChangeNotification() {
        let suite = "bookstr-connect-nip46-notification-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        var observed = false
        let token = NotificationCenter.default.addObserver(forName: .bookstrIdentityDidChange, object: nil, queue: nil) { _ in
            observed = true
        }

        repository.connectNip46(pubkeyHex: "a1b2", bunkerURL: "bunker://relay", clientSecret: "secret")

        NotificationCenter.default.removeObserver(token)
        XCTAssertTrue(observed)
        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46DefaultsMissingClientPubkeyForSessionAuth() {
        let suite = "bookstr-connect-nip46-default-client-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.connectNip46(pubkeyHex: "AaBb", bunkerURL: "bunker://server", clientSecret: "secret")

        XCTAssertEqual(repository.nip46ClientPubkey, "aabb")
        XCTAssertEqual(repository.pubkeyHex, "aabb")
        XCTAssertEqual(repository.nip46BunkerURL, "bunker://server")
        XCTAssertEqual(repository.nip46ClientSecret, "secret")

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectAmberClearsNsecAndNormalizesPubkey() {
        let suite = "bookstr-connect-amber-test-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.nsec = "nsec-value"
        repository.nsec = nil
        repository.authMode = .amber
        repository.pubkeyHex = "AaBbCc"
        repository.signerPackage = "com.example.amber"
        XCTAssertEqual(repository.authMode, .amber)
        XCTAssertEqual(repository.pubkeyHex, "aabbcc")
        XCTAssertEqual(repository.signerPackage, "com.example.amber")
        XCTAssertNil(repository.nsec)
        XCTAssertTrue(repository.hasNostrIdentity)

        defaults.removePersistentDomain(forName: suite)
    }

    func testNsecNormalizesAndClearsWithWhitespace() {
        let suite = "bookstr-nsec-normalize-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.nsec = "   nsec-value   "
        XCTAssertEqual(repository.nsec, "nsec-value")
        repository.nsec = "   "
        XCTAssertNil(repository.nsec)

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectAmberEmulationClearsLegacyNip46State() {
        let suite = "bookstr-connect-amber-emulation-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.nsec = "nsec-legacy"
        repository.signerPackage = "com.example.amber-old"
        repository.pubkeyHex = "111"
        repository.authMode = .nip46
        repository.nip46ClientSecret = "secret"
        repository.nip46BunkerURL = "bunker://relay"

        repository.nsec = nil
        repository.pubkeyHex = "AaBbCc"
        repository.signerPackage = "  com.example.amber-new  "
        repository.authMode = .amber
        repository.nip46ClientSecret = nil
        repository.nip46BunkerURL = nil

        XCTAssertEqual(repository.pubkeyHex, "aabbcc")
        XCTAssertEqual(repository.signerPackage, "com.example.amber-new")
        XCTAssertEqual(repository.authMode, .amber)
        XCTAssertNil(repository.nip46ClientSecret)
        XCTAssertNil(repository.nip46BunkerURL)

        defaults.removePersistentDomain(forName: suite)
    }

    func testCacheNostrFavoritesKeepsExistingEventIdWhenBlankUpdateSent() {
        let suite = "bookstr-fav-blank-eventid-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.cacheNostrFavorites(pubkey: "ABC", plaintext: "[\"e\",\"1\"]", eventId: "evt-1")
        repository.cacheNostrFavorites(pubkey: "abc", plaintext: "[\"e\",\"2\"]", eventId: "")

        XCTAssertEqual(repository.cachedFavoritesEventId(pubkey: "ABC"), "evt-1")
        XCTAssertEqual(repository.cachedNostrFavorites(pubkey: "ABC"), "[\"e\",\"2\"]")

        defaults.removePersistentDomain(forName: suite)
    }


    func testAuthModeDefaultsToNoneForInvalidStoredValue() {
        let suite = "bookstr-auth-mode-invalid-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("invalid-mode", forKey: "auth_mode")
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertEqual(repository.authMode, .none)

        defaults.removePersistentDomain(forName: suite)
    }

    func testAuthModeDefaultsToNoneForUppercaseStoredValue() {
        let suite = "bookstr-auth-mode-uppercase-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("NSEC", forKey: "auth_mode")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.authMode, .none)

        defaults.removePersistentDomain(forName: suite)
    }

    func testAuthModeDefaultsToNoneForWhitespaceStoredValue() {
        let suite = "bookstr-auth-mode-whitespace-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("   ", forKey: "auth_mode")
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertEqual(repository.authMode, .none)

        defaults.removePersistentDomain(forName: suite)
    }

    func testAuthModeDefaultsToNoneForEmptyStoredValue() {
        let suite = "bookstr-auth-mode-empty-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("", forKey: "auth_mode")
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertEqual(repository.authMode, .none)

        defaults.removePersistentDomain(forName: suite)
    }

    func testAuthModeDefaultsToNoneForWhitespaceStoredValueAndLegacyNsec() {
        let suite = "bookstr-auth-mode-whitespace-with-nsec-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("   ", forKey: "auth_mode")
        let repository = SettingsRepository(defaults: defaults)
        repository.nsec = "legacy"

        XCTAssertEqual(repository.authMode, .none)

        defaults.removePersistentDomain(forName: suite)
    }

    func testAuthModeFallsBackToNsecWhenAuthModeKeyIsMissing() {
        let suite = "bookstr-auth-mode-legacy-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.nsec = "legacy"
        XCTAssertEqual(repository.authMode, .nsec)

        repository.nsec = nil
        XCTAssertEqual(repository.authMode, .none)

        defaults.removePersistentDomain(forName: suite)
    }

    func testAuthModePersistsAcrossInstances() {
        let suite = "bookstr-auth-mode-instance-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let first = SettingsRepository(defaults: defaults)
        first.authMode = .nip46

        let second = SettingsRepository(defaults: defaults)
        XCTAssertEqual(second.authMode, .nip46)

        defaults.removePersistentDomain(forName: suite)
    }

    func testFavoritesCacheDoesNotStoreEventIdWhenNotProvided() {
        let suite = "bookstr-fav-cache-no-event-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.cacheNostrFavorites(pubkey: "abc", plaintext: "[[\"e\",\"2\"]]")
        XCTAssertEqual(repository.cachedNostrFavorites(pubkey: "ABC"), "[[\"e\",\"2\"]]")
        XCTAssertNil(repository.cachedFavoritesEventId(pubkey: "ABC"))
        defaults.removePersistentDomain(forName: suite)
    }

    func testRelaysDefaultsToNomadWikiWhenMissingAndPersistsCustomList() {
        let suite = "bookstr-relays-default-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertEqual(repository.relays, ["wss://relay.nomadwiki.org"])
        repository.relays = ["wss://one", "  ", "wss://two", ""]
        XCTAssertEqual(repository.relays, ["wss://one", "wss://two"])
        XCTAssertEqual(defaults.string(forKey: "relays"), "wss://one\nwss://two")
        defaults.removePersistentDomain(forName: suite)
    }

    func testRelaysParsesEmptyStringAsEmptyList() {
        let suite = "bookstr-relays-empty-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("", forKey: "relays")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.relays, [])

        defaults.removePersistentDomain(forName: suite)
    }

    func testRelaysParsesOnlyCommasAndWhitespaceAsEmptyList() {
        let suite = "bookstr-relays-commas-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set(" ,,,   ", forKey: "relays")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.relays, [])

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNostrIdentityRequiresNsecToBeSetWhenModeIsNsec() {
        let suite = "bookstr-has-nostr-id-nsec-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .nsec
        repository.nsec = ""
        XCTAssertFalse(repository.hasNostrIdentity)
        repository.nsec = "  nsec  "
        XCTAssertTrue(repository.hasNostrIdentity)

        defaults.removePersistentDomain(forName: suite)
    }

    func testPubkeyAndSignerPackageTrimAndClear() {
        let suite = "bookstr-repo-trim-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.pubkeyHex = "  AbC123  "
        repository.signerPackage = "  com.example.amber  "
        XCTAssertEqual(repository.pubkeyHex, "abc123")
        XCTAssertEqual(repository.signerPackage, "com.example.amber")

        repository.pubkeyHex = "   "
        repository.signerPackage = ""
        XCTAssertNil(repository.pubkeyHex)
        XCTAssertNil(repository.signerPackage)

        defaults.removePersistentDomain(forName: suite)
    }

    func testThemeDefaultsToPaperForInvalidRawValue() {
        let suite = "bookstr-theme-invalid-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("neon", forKey: "theme")
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertEqual(repository.theme, .paper)

        defaults.removePersistentDomain(forName: suite)
    }

    func testThemeDefaultsToPaperWhenMissingFromStorage() {
        let suite = "bookstr-theme-missing-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertEqual(repository.theme, .paper)

        defaults.removePersistentDomain(forName: suite)
    }

    func testThemeDefaultsToPaperForEmptyRawValue() {
        let suite = "bookstr-theme-empty-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("", forKey: "theme")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.theme, .paper)

        defaults.removePersistentDomain(forName: suite)
    }

    func testThemeDefaultsToPaperForWhitespaceRawValue() {
        let suite = "bookstr-theme-whitespace-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("   ", forKey: "theme")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.theme, .paper)

        defaults.removePersistentDomain(forName: suite)
    }

    func testThemeDefaultsToPaperForUppercaseRawValue() {
        let suite = "bookstr-theme-uppercase-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("NIGHT", forKey: "theme")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.theme, .paper)

        defaults.removePersistentDomain(forName: suite)
    }

    func testThemePersistsCustomValueAcrossInstances() {
        let suite = "bookstr-theme-roundtrip-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let first = SettingsRepository(defaults: defaults)
        first.theme = .night
        XCTAssertEqual(first.theme, .night)

        let second = SettingsRepository(defaults: defaults)
        XCTAssertEqual(second.theme, .night)

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilForStoredDataWithInvalidFormat() {
        let suite = "bookstr-reader-session-invalid-format-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-invalid","bookTitle":"Title","format":"mobi","author":"Author","year":"2025","locator":"{\"cfi\":\"/1\"}","pageIndex":10,"pageOffset":5}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilForStoredDataWithUnknownFormatString() {
        let suite = "bookstr-reader-session-unknown-format-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-unknown-format","bookTitle":"Title","format":"txt","author":"Author","year":"2025","locator":"{\"cfi\":\"/1\"}","pageIndex":10,"pageOffset":5}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilForStoredDataMissingRequiredField() {
        let suite = "bookstr-reader-session-missing-required-field-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-missing","bookTitle":"Title","format":"epub","author":"A","year":"2024","locator":"{\\"cfi\\":\\"/1\\"}"}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilWhenStoredDataIsMissingBookTitle() {
        let suite = "bookstr-reader-session-missing-title-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-missing-title","format":"epub","pageIndex":10,"pageOffset":4}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilWhenRequiredBookIdFieldIsMissing() {
        let suite = "bookstr-reader-session-missing-book-id-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookTitle":"Title","format":"epub","pageIndex":10,"pageOffset":4}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionIgnoresUnknownStoredFields() {
        let suite = "bookstr-reader-session-unknown-fields-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-unknown-fields","bookTitle":"Title","format":"epub","pageIndex":1,"pageOffset":2,"mysteryField":"extra"}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")
        let repository = SettingsRepository(defaults: defaults)

        let session = repository.readerSession()
        XCTAssertNotNil(session)
        XCTAssertEqual(session?.bookId, "book-unknown-fields")
        XCTAssertEqual(session?.bookTitle, "Title")
        XCTAssertEqual(session?.pageIndex, 1)
        XCTAssertEqual(session?.pageOffset, 2)

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46TrimsAndNormalizesPubkeyAndClientPubkey() {
        let suite = "bookstr-connect-nip46-trim-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.connectNip46(
            pubkeyHex: "  AbC123 ",
            bunkerURL: "bunker://relay",
            clientSecret: "secret",
            clientPubkey: "  DeF456 "
        )

        XCTAssertEqual(repository.pubkeyHex, "abc123")
        XCTAssertEqual(repository.nip46ClientPubkey, "def456")
        XCTAssertEqual(repository.authMode, .nip46)

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNip46SessionCredentialsRequiresBunkerUrlPrefixAndSecret() {
        let suite = "bookstr-nip46-creds-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .nip46
        repository.nip46ClientSecret = "secret"
        repository.nip46BunkerURL = "https://example.com/bunker"
        XCTAssertFalse(repository.hasNip46SessionCredentials)

        repository.nip46BunkerURL = "bunker://example.com"
        XCTAssertTrue(repository.hasNip46SessionCredentials)

        repository.nip46ClientSecret = ""
        XCTAssertFalse(repository.hasNip46SessionCredentials)

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNip46SessionCredentialsRejectsWhitespaceAroundBunkerURL() {
        let suite = "bookstr-nip46-creds-whitespace-bunker-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .nip46
        repository.nip46ClientSecret = "secret"
        repository.nip46BunkerURL = "  bunker://relay  "

        XCTAssertFalse(repository.hasNip46SessionCredentials)

        repository.nip46BunkerURL = "bunker://relay"
        XCTAssertTrue(repository.hasNip46SessionCredentials)

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46TrimsAndPersistsClientSecret() {
        let suite = "bookstr-connect-nip46-trim-secret-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.connectNip46(
            pubkeyHex: "  a1b2  ",
            bunkerURL: "  bunker://relay.example  ",
            clientSecret: "  super-secret  ",
            clientPubkey: nil,
        )

        XCTAssertEqual(repository.pubkeyHex, "a1b2")
        XCTAssertEqual(repository.nip46ClientSecret, "super-secret")
        XCTAssertEqual(repository.nip46BunkerURL, "  bunker://relay.example  ")
        XCTAssertFalse(repository.hasNip46SessionCredentials)
        XCTAssertEqual(repository.nip46ClientPubkey, "a1b2")
        defaults.removePersistentDomain(forName: suite)
    }

    func testNip46ClientSecretFallsBackToKeychainAndReplicatesToDefaults() {
        let suite = "bookstr-nip46-secret-keychain-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        var repository = SettingsRepository(defaults: defaults)
        repository.nip46ClientSecret = "secret-value"
        defaults.removeObject(forKey: "nip46_client_secret")

        repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.nip46ClientSecret, "secret-value")
        XCTAssertEqual(defaults.string(forKey: "nip46_client_secret"), "secret-value")

        repository.nip46ClientSecret = nil
        defaults.removePersistentDomain(forName: suite)
    }

    func testNsecFallsBackToKeychainAcrossInstances() {
        let suite = "bookstr-nsec-keychain-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defer { defaults.removePersistentDomain(forName: suite) }

        let first = SettingsRepository(defaults: defaults)
        first.nsec = "secret-for-keychain"
        defer { first.nsec = nil }

        let second = SettingsRepository(defaults: defaults)
        XCTAssertEqual(second.nsec, "secret-for-keychain")

        let third = SettingsRepository(defaults: defaults)
        XCTAssertEqual(third.nsec, "secret-for-keychain")
    }

    func testCachedNostrFavoritesRequiresMatchingPubkey() {
        let suite = "bookstr-fav-matching-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.cacheNostrFavorites(pubkey: "ABC", plaintext: "[\"e\",\"1\"]")
        XCTAssertEqual(repository.cachedNostrFavorites(pubkey: "ABC"), "[\"e\",\"1\"]")
        XCTAssertNil(repository.cachedNostrFavorites(pubkey: "ABCD"))

        defaults.removePersistentDomain(forName: suite)
    }

    func testCachedNostrCollectionsRoundTripsAndDefaultsEmptySnapshot() {
        let suite = "bookstr-collections-cache-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        let snapshot = CollectionSnapshot(
            collections: [BookCollection(id: "list-1", title: "Reading", description: "", updatedAt: 1_234, items: [])],
            tombstones: []
        )
        repository.cacheNostrCollections(pubkey: "ABC", snapshot: snapshot)
        XCTAssertEqual(repository.cachedNostrCollections(pubkey: "abc"), snapshot)
        XCTAssertEqual(repository.cachedNostrCollections(pubkey: "other").collections, [])

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilForCorruptStoredData() {
        let suite = "bookstr-reader-session-corrupt-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("not-a-valid-json-session".data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilForStoredDataWithInvalidNumericFields() {
        let suite = "bookstr-reader-session-invalid-numeric-fields-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-invalid-number","bookTitle":"Title","format":"epub","pageIndex":"10","pageOffset":"5"}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilForStoredDataWithDecimalNumericFields() {
        let suite = "bookstr-reader-session-decimal-numeric-fields-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-decimal-number","bookTitle":"Title","format":"epub","pageIndex":10.5,"pageOffset":4.9}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilForStoredDataMissingFormat() {
        let suite = "bookstr-reader-session-missing-format-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-missing-format","bookTitle":"Title","pageIndex":10,"pageOffset":4}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilForStoredDataWithUppercaseFormat() {
        let suite = "bookstr-reader-session-uppercase-format-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-uppercase-format","bookTitle":"Title","format":"EPUB","pageIndex":10,"pageOffset":4}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilWhenLocatorIsObject() {
        let suite = "bookstr-reader-session-locator-object-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-locator-object","bookTitle":"Title","format":"epub","pageIndex":10,"pageOffset":4,"locator":{"path":"/chapter"}}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilWhenLocatorHasInvalidType() {
        let suite = "bookstr-reader-session-invalid-locator-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-invalid-locator","bookTitle":"Title","format":"epub","pageIndex":10,"pageOffset":4,"locator":123}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilWhenRequiredPageIndexFieldIsMissing() {
        let suite = "bookstr-reader-session-missing-page-index-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-missing-page-index","bookTitle":"Title","format":"epub","pageOffset":4}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilWhenRequiredPageOffsetFieldIsMissing() {
        let suite = "bookstr-reader-session-missing-page-offset-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let payload = """
        {"bookId":"book-missing-page-offset","bookTitle":"Title","format":"epub","pageIndex":10}
        """

        defaults.set(payload.data(using: .utf8), forKey: "reader_session")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionFallsBackToDefaultFieldsWhenMetadataIsBlank() {
        let suite = "bookstr-reader-session-default-fields-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)
        repository.saveReaderSession(
            ReaderSession(
                bookId: "book-empty-meta",
                bookTitle: "",
                format: .epub,
                author: "",
                year: "",
                locator: "",
                pageIndex: 10,
                pageOffset: 20,
            ),
        )

        let loaded = repository.readerSession()
        XCTAssertNotNil(loaded)
        XCTAssertEqual(loaded?.bookTitle, "Book")
        XCTAssertNil(loaded?.author)
        XCTAssertNil(loaded?.year)
        XCTAssertNil(loaded?.locator)
        XCTAssertEqual(loaded?.pageIndex, 10)

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilWhenDataIsMissing() {
        let suite = "bookstr-reader-session-missing-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertNil(repository.readerSession())

        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionIsNilWhenBookIdIsEmpty() {
        let suite = "bookstr-reader-session-empty-id-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)
        repository.saveReaderSession(
            ReaderSession(
                bookId: "",
                bookTitle: "Blank",
                format: .epub,
            ),
        )

        XCTAssertNil(repository.readerSession())
        defaults.removePersistentDomain(forName: suite)
    }

    func testReaderSessionReturnsNilWhenBookIdIsWhitespace() {
        let suite = "bookstr-reader-session-whitespace-id-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.saveReaderSession(
            ReaderSession(
                bookId: "   ",
                bookTitle: "Blank",
                format: .epub,
            ),
        )

        XCTAssertNil(repository.readerSession())
        defaults.removePersistentDomain(forName: suite)
    }

    func testCachedNostrFavoritesTreatsBlankCacheContentAsMissing() {
        let suite = "bookstr-fav-blank-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.cacheNostrFavorites(pubkey: "abc", plaintext: "   ")
        XCTAssertNil(repository.cachedNostrFavorites(pubkey: "ABC"))
        XCTAssertNil(repository.cachedFavoritesEventId(pubkey: "ABC"))

        defaults.removePersistentDomain(forName: suite)
    }

    func testCachedCollectionsFallsBackToEmptySnapshotForMalformedData() {
        let suite = "bookstr-collections-corrupt-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("not-json".data(using: .utf8), forKey: "nostr_collections_abc")

        let repository = SettingsRepository(defaults: defaults)
        let snapshot = repository.cachedNostrCollections(pubkey: "ABC")

        XCTAssertEqual(snapshot.collections, [])
        XCTAssertEqual(snapshot.tombstones, [])

        defaults.removePersistentDomain(forName: suite)
    }

    func testSpeechVoiceIdentifierDefaultsToEmptyAndPersistsCustomValue() {
        let suite = "bookstr-speech-voice-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        XCTAssertEqual(repository.speechVoiceIdentifier, "")

        repository.speechVoiceIdentifier = "com.bookstr.voice"
        XCTAssertEqual(repository.speechVoiceIdentifier, "com.bookstr.voice")
        XCTAssertEqual(defaults.string(forKey: "speech_voice"), "com.bookstr.voice")
        defaults.removePersistentDomain(forName: suite)
    }

    func testKeepsDownloadedCollectionsPersistsAcrossInstances() {
        let suite = "bookstr-collections-instance-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let first = SettingsRepository(defaults: defaults)
        first.setKeepCollectionDownloaded("book-id-1", enabled: true)
        first.setKeepCollectionDownloaded("book-id-2", enabled: true)
        let second = SettingsRepository(defaults: defaults)
        XCTAssertTrue(second.keepsCollectionDownloaded("book-id-1"))
        XCTAssertTrue(second.keepsCollectionDownloaded("book-id-2"))

        first.setKeepCollectionDownloaded("book-id-1", enabled: false)
        let third = SettingsRepository(defaults: defaults)
        XCTAssertFalse(third.keepsCollectionDownloaded("book-id-1"))
        XCTAssertTrue(third.keepsCollectionDownloaded("book-id-2"))

        defaults.removePersistentDomain(forName: suite)
    }

    func testSetKeepCollectionDownloadedSortsPersistedIdentifiers() {
        let suite = "bookstr-collections-sorted-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.setKeepCollectionDownloaded("book-z", enabled: true)
        repository.setKeepCollectionDownloaded("book-a", enabled: true)
        repository.setKeepCollectionDownloaded("book-m", enabled: true)

        XCTAssertEqual(defaults.stringArray(forKey: "keep_downloaded_collections"), ["book-a", "book-m", "book-z"])

        repository.setKeepCollectionDownloaded("book-m", enabled: false)
        XCTAssertEqual(defaults.stringArray(forKey: "keep_downloaded_collections"), ["book-a", "book-z"])

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46DefaultsClientPubkeyForCurrentSession() {
        let suite = "bookstr-connect-nip46-default-client-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.connectNip46(pubkeyHex: "AbC123", bunkerURL: "bunker://relay", clientSecret: "secret")
        XCTAssertEqual(repository.pubkeyHex, "abc123")
        XCTAssertNil(repository.signerPackage)
        XCTAssertNil(repository.nsec)
        XCTAssertEqual(repository.nip46ClientPubkey, "abc123")
        XCTAssertEqual(repository.nip46BunkerURL, "bunker://relay")
        XCTAssertEqual(repository.nip46ClientSecret, "secret")

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46UsesExplicitLowercasedClientPubkey() {
        let suite = "bookstr-connect-nip46-explicit-client-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.connectNip46(
            pubkeyHex: "AbC123",
            bunkerURL: "bunker://relay",
            clientSecret: "secret",
            clientPubkey: "DdE456"
        )
        XCTAssertEqual(repository.pubkeyHex, "abc123")
        XCTAssertEqual(repository.nip46ClientPubkey, "dde456")
        XCTAssertEqual(repository.nip46BunkerURL, "bunker://relay")
        XCTAssertEqual(repository.nip46ClientSecret, "secret")

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNostrIdentityIsTrueForNip46WithPubkey() {
        let suite = "bookstr-has-identity-nip46-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.connectNip46(pubkeyHex: "abc", bunkerURL: "bunker://relay", clientSecret: "secret")
        XCTAssertEqual(repository.authMode, .nip46)
        XCTAssertTrue(repository.hasNostrIdentity)

        repository.connectNip46(pubkeyHex: "   ", bunkerURL: "bunker://relay", clientSecret: "secret")
        XCTAssertFalse(repository.hasNostrIdentity)

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46ClearsLegacyNsecAndSignerPackage() {
        let suite = "bookstr-connect-nip46-clears-legacy-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.signerPackage = "com.example.amber"
        repository.nsec = "legacy-nsec"
        repository.connectNip46(pubkeyHex: "AaBb", bunkerURL: "bunker://relay", clientSecret: "secret")

        XCTAssertEqual(repository.authMode, .nip46)
        XCTAssertEqual(repository.pubkeyHex, "aabb")
        XCTAssertNil(repository.signerPackage)
        XCTAssertNil(repository.nsec)
        XCTAssertEqual(repository.nip46BunkerURL, "bunker://relay")
        XCTAssertEqual(repository.nip46ClientSecret, "secret")
        XCTAssertEqual(repository.nip46ClientPubkey, "aabb")

        defaults.removePersistentDomain(forName: suite)
    }

    func testHasNostrIdentityForNip46DependsOnPubkeyAndModeOnly() {
        let suite = "bookstr-has-identity-nip46-mode-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.authMode = .nip46
        repository.pubkeyHex = nil
        XCTAssertFalse(repository.hasNostrIdentity)

        repository.pubkeyHex = "  "
        XCTAssertFalse(repository.hasNostrIdentity)

        repository.pubkeyHex = "ABC"
        XCTAssertTrue(repository.hasNostrIdentity)

        defaults.removePersistentDomain(forName: suite)
    }

    func testPubkeyHexSetterTrimsWhitespaceAndLowercases() {
        let suite = "bookstr-pubkeyhex-setter-trim-lower-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.pubkeyHex = "  AbC123  "
        XCTAssertEqual(repository.pubkeyHex, "abc123")

        let reloaded = SettingsRepository(defaults: defaults)
        XCTAssertEqual(reloaded.pubkeyHex, "abc123")

        repository.pubkeyHex = "   "
        XCTAssertNil(repository.pubkeyHex)
        XCTAssertNil(SettingsRepository(defaults: defaults).pubkeyHex)

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46TrimsClientPubkeyWhenProvided() {
        let suite = "bookstr-connect-nip46-client-pubkey-trim-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.connectNip46(
            pubkeyHex: "AA11",
            bunkerURL: "bunker://relay",
            clientSecret: "secret",
            clientPubkey: "  Bb22  ",
        )

        XCTAssertEqual(repository.nip46ClientPubkey, "bb22")

        defaults.removePersistentDomain(forName: suite)
    }

    func testSignerPackageSetterTrimsWhitespaceOnlyToEmptyString() {
        let suite = "bookstr-signer-package-whitespace-nil-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.signerPackage = "  com.example.amber  "
        XCTAssertEqual(repository.signerPackage, "com.example.amber")
        repository.signerPackage = "   "
        XCTAssertEqual(repository.signerPackage, "")

        defaults.removePersistentDomain(forName: suite)
    }

    func testLastApplicationDataSyncCanBeClearedWithNil() {
        let suite = "bookstr-app-sync-clear-nil-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)
        let timestamp = Date(timeIntervalSince1970: 1_700_111_111)

        repository.lastApplicationDataSync = timestamp
        XCTAssertEqual(repository.lastApplicationDataSync, timestamp)

        repository.lastApplicationDataSync = nil
        XCTAssertNil(repository.lastApplicationDataSync)

        defaults.removePersistentDomain(forName: suite)
    }

    func testAuthModeCanBeSetToNip46AndPersistedAcrossInstances() {
        let suite = "bookstr-auth-mode-nip46-persist-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        do {
            let repository = SettingsRepository(defaults: defaults)
            repository.authMode = .nip46
            repository.pubkeyHex = "A1B2"
            repository.nip46ClientSecret = "secret"
            repository.nip46BunkerURL = "bunker://relay"
            XCTAssertEqual(repository.authMode, .nip46)
            XCTAssertEqual(repository.nip46BunkerURL, "bunker://relay")
        }

        let reloaded = SettingsRepository(defaults: defaults)
        XCTAssertEqual(reloaded.authMode, .nip46)
        XCTAssertEqual(reloaded.nip46ClientSecret, "secret")
        XCTAssertEqual(reloaded.nip46BunkerURL, "bunker://relay")

        defaults.removePersistentDomain(forName: suite)
    }

    func testRelaysWhitespaceOnlyBecomesEmpty() {
        let suite = "bookstr-relays-whitespace-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("   ,  \n", forKey: "relays")
        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.relays, [])

        repository.relays = []
        XCTAssertEqual(defaults.string(forKey: "relays"), "")

        defaults.removePersistentDomain(forName: suite)
    }

    func testSignerPackageSetterNilClearsStoredValue() {
        let suite = "bookstr-signer-package-nil-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.signerPackage = "com.example.amber"
        XCTAssertEqual(repository.signerPackage, "com.example.amber")
        repository.signerPackage = nil
        XCTAssertNil(repository.signerPackage)
        XCTAssertNil(SettingsRepository(defaults: defaults).signerPackage)

        defaults.removePersistentDomain(forName: suite)
    }

    func testCachedNostrCollectionsUsesCaseInsensitivePubkeyKey() {
        let suite = "bookstr-collections-case-insensitive-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        let snapshot = CollectionSnapshot(collections: [
            BookCollection(id: "A1", title: "Sci Fi", description: "reads", updatedAt: 1, items: []),
        ], tombstones: [])

        repository.cacheNostrCollections(pubkey: "AaB", snapshot: snapshot)
        XCTAssertEqual(repository.cachedNostrCollections(pubkey: "aab"), snapshot)

        defaults.removePersistentDomain(forName: suite)
    }

    func testCachedNostrCollectionsCanOverwriteStoredSnapshot() {
        let suite = "bookstr-collections-overwrite-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        let first = CollectionSnapshot(collections: [
            BookCollection(id: "A", title: "First", description: "old", updatedAt: 1, items: []),
        ], tombstones: [])
        let second = CollectionSnapshot(collections: [
            BookCollection(id: "B", title: "Second", description: "new", updatedAt: 2, items: []),
        ], tombstones: [CollectionTombstone(id: "A", deletedAt: 10)])

        repository.cacheNostrCollections(pubkey: "overwrite", snapshot: first)
        repository.cacheNostrCollections(pubkey: "OVERWRITE", snapshot: second)

        let loaded = repository.cachedNostrCollections(pubkey: "overwrite")
        XCTAssertEqual(loaded.collections.first?.id, "B")
        XCTAssertEqual(loaded.tombstones.first?.id, "A")

        defaults.removePersistentDomain(forName: suite)
    }

    func testCachedNostrCollectionsFallsBackToEmptySnapshotForNondictionaryTypeData() {
        let suite = "bookstr-collections-corrupt-type-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set(["bad-entry"], forKey: "nostr_collections_upper")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.cachedNostrCollections(pubkey: "upper"), CollectionSnapshot())

        defaults.removePersistentDomain(forName: suite)
    }

    func testKeepReadingLockscreenSettingDefaultsAndPersists() {
        let suite = "bookstr-keep-reading-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.keepReadingOnLockScreen, true)

        repository.keepReadingOnLockScreen = false
        XCTAssertEqual(repository.keepReadingOnLockScreen, false)

        defaults.removePersistentDomain(forName: suite)
    }

    func testDictionaryDefaultsAndOverridesPersist() {
        let suite = "bookstr-dictionary-settings-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repository.dictionarySource, "en")
        XCTAssertEqual(repository.dictionaryTarget, "pt")

        repository.dictionarySource = "es"
        repository.dictionaryTarget = "de"

        let reloaded = SettingsRepository(defaults: defaults)
        XCTAssertEqual(reloaded.dictionarySource, "es")
        XCTAssertEqual(reloaded.dictionaryTarget, "de")

        defaults.removePersistentDomain(forName: suite)
    }

    func testWordSortDefaultsAndPersists() {
        let suite = "bookstr-word-sort-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)

        let repository = SettingsRepository(defaults: defaults)
        repository.wordSort = "alpha"

        XCTAssertEqual(repository.wordSort, "alpha")
        XCTAssertEqual(SettingsRepository(defaults: defaults).wordSort, "alpha")

        defaults.removePersistentDomain(forName: suite)
    }

    func testPubkeyHexIsTrimmedAndLowercased() {
        let suite = "bookstr-pubkey-normalize-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.pubkeyHex = "  AbC123  "
        XCTAssertEqual(repository.pubkeyHex, "abc123")

        defaults.removePersistentDomain(forName: suite)
    }
}
