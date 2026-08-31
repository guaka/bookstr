import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class SettingsRepositoryTests: XCTestCase {
    private final class MemorySecureStore: SecureStringStore {
        var values: [String: String] = [:]

        @discardableResult
        func set(key: String, value: String?) -> Bool {
            values[key] = value
            return true
        }

        func get(key: String) -> String? {
            values[key]
        }
    }

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

    func testReaderTypographyDefaultsToArialAndJustified() {
        let suite = "bookstr-type-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let first = SettingsRepository(defaults: defaults)
        XCTAssertEqual(first.readerFont, .arial)
        XCTAssertEqual(first.readerAlignment, .justified)
        XCTAssertEqual(ReaderFont.arial.label, "Arial")
        XCTAssertEqual(ReaderFont.georgia.label, "Georgia")
        XCTAssertEqual(ReaderFont.palatino.label, "Palatino")
        XCTAssertEqual(ReaderFont.system.label, "System")
        XCTAssertEqual(ReaderAlignment.justified.label, "Justified")
        XCTAssertEqual(ReaderAlignment.left.label, "Left")
        first.readerFont = .georgia
        first.readerAlignment = .left
        let second = SettingsRepository(defaults: defaults)
        XCTAssertEqual(second.readerFont, .georgia)
        XCTAssertEqual(second.readerAlignment, .left)
        XCTAssertEqual(ReaderFont(rawValue: "unknown") ?? .arial, .arial)
        XCTAssertEqual(ReaderAlignment(rawValue: "unknown") ?? .justified, .justified)
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

    func testNip46ClientSecretIsStoredOnlyInSecureStore() {
        let suite = "bookstr-nip46-secret-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let secureStore = MemorySecureStore()
        let repo = SettingsRepository(defaults: defaults, keychain: secureStore)

        repo.nip46ClientSecret = "secret-value"

        XCTAssertEqual(repo.nip46ClientSecret, "secret-value")
        XCTAssertNil(defaults.string(forKey: "nip46_client_secret"))
        defaults.removePersistentDomain(forName: suite)
    }

    func testNip46ClientSecretMigratesOutOfLegacyDefaults() {
        let suite = "bookstr-nip46-migration-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.set("legacy-secret", forKey: "nip46_client_secret")
        let secureStore = MemorySecureStore()
        let repo = SettingsRepository(defaults: defaults, keychain: secureStore)

        XCTAssertEqual(repo.nip46ClientSecret, "legacy-secret")
        XCTAssertEqual(secureStore.values["nip46_client_secret"], "legacy-secret")
        XCTAssertNil(defaults.string(forKey: "nip46_client_secret"))
        defaults.removePersistentDomain(forName: suite)
    }

    func testSpeechLanguageSettingsPersistAndResolvePerLanguage() {
        let suite = "bookstr-speech-lang-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let first = SettingsRepository(defaults: defaults)
        XCTAssertEqual(first.speechChoice(for: "en").voiceIdentifier, SpeechVoiceID.systemDefault)
        XCTAssertNil(first.speechChoice(for: "en").neuralEngine)
        XCTAssertEqual(first.speechChoice(for: "pt").voiceIdentifier, SpeechVoiceID.systemDefault)
        first.setSpeechVoice(SpeechEngineID.portuguesePortugal.rawValue, for: "pt-PT")
        first.setSpeechVoice(SpeechEngineID.kokoroEnglish.rawValue, for: "en")
        let second = SettingsRepository(defaults: defaults)
        XCTAssertEqual(second.speechChoice(for: "pt").voiceIdentifier, SpeechEngineID.portuguesePortugal.rawValue)
        XCTAssertEqual(second.speechChoice(for: "pt").neuralEngine, .portuguesePortugal)
        XCTAssertEqual(second.speechChoice(for: "en").voiceIdentifier, SpeechEngineID.kokoroEnglish.rawValue)
        XCTAssertEqual(second.speechChoice(for: "en").engine, .neural(.kokoroEnglish))
        second.setSpeechVoice("", for: "en")
        XCTAssertEqual(
            SettingsRepository(defaults: defaults).speechChoice(for: "en").voiceIdentifier,
            SpeechVoiceID.systemDefault
        )
        defaults.removePersistentDomain(forName: suite)
    }

    func testLegacySpeechEngineMigratesIntoLanguageSettings() {
        let suite = "bookstr-speech-legacy-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        defaults.set("piper_pt_pt", forKey: "speech_engine")
        let repo = SettingsRepository(defaults: defaults)
        XCTAssertEqual(repo.speechChoice(for: "pt").neuralEngine, .portuguesePortugal)
        XCTAssertEqual(repo.speechChoice(for: "en").engine, .apple)
        defaults.removePersistentDomain(forName: suite)
    }

    func testReadingMetadataSyncTimestampPersists() {
        let suite = "bookstr-reading-meta-sync-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let stamp = Date(timeIntervalSince1970: 1_700_000_000)
        let first = SettingsRepository(defaults: defaults)
        first.lastReadingMetadataSync = stamp
        first.lastApplicationDataSync = stamp
        let second = SettingsRepository(defaults: defaults)
        XCTAssertEqual(second.lastReadingMetadataSync?.timeIntervalSince1970, stamp.timeIntervalSince1970)
        XCTAssertEqual(second.lastApplicationDataSync?.timeIntervalSince1970, stamp.timeIntervalSince1970)
        defaults.removePersistentDomain(forName: suite)
    }
}

private struct JSONFileStoreCoverageValue: Codable, Equatable {
    let value: Int
}

private enum JSONFileStoreCoverageError: Error {
    case expected
}

private struct JSONFileStoreThrowingValue: Encodable {
    func encode(to encoder: Encoder) throws {
        throw JSONFileStoreCoverageError.expected
    }
}

final class JSONFileStoreCoverageTests: XCTestCase {
    func testLoadFallbackAndSaveErrorPaths() {
        let store = JSONFileStore(subdirectory: "bookstr-json-\(UUID().uuidString)")
        let fallback = JSONFileStoreCoverageValue(value: 7)

        XCTAssertEqual(
            store.load("missing.json", as: JSONFileStoreCoverageValue.self, fallback: fallback),
            fallback
        )
        store.save("invalid.json", value: "not the expected object")
        XCTAssertEqual(
            store.load("invalid.json", as: JSONFileStoreCoverageValue.self, fallback: fallback),
            fallback
        )
        store.save("throwing.json", value: JSONFileStoreThrowingValue())
        store.save("missing-directory/value.json", value: fallback)
    }

    func testSaveListsFilesAndBuildsBookURLs() {
        let store = JSONFileStore(subdirectory: "bookstr-json-\(UUID().uuidString)")
        store.save("value.json", value: JSONFileStoreCoverageValue(value: 11))

        XCTAssertEqual(store.load("value.json", as: JSONFileStoreCoverageValue.self, fallback: JSONFileStoreCoverageValue(value: 0)).value, 11)
        XCTAssertEqual(store.bookFileURL(bookId: "book-id", format: .epub).pathExtension, "epub")
        XCTAssertEqual(store.bookFileURL(bookId: "book-id", format: .pdf).pathExtension, "pdf")
        store.ensureBooksDirectory()
        try? Data("book".utf8).write(to: store.bookFileURL(bookId: "book-id", format: .epub))
        XCTAssertEqual(store.publicationFiles().map(\.lastPathComponent), ["book-id.epub"])
    }
}

final class SettingsRepositoryCoverageTests: XCTestCase {
    private final class MemorySecureStore: SecureStringStore {
        var values: [String: String] = [:]

        @discardableResult
        func set(key: String, value: String?) -> Bool {
            values[key] = value
            return true
        }

        func get(key: String) -> String? {
            values[key]
        }
    }

    func testSimpleSettingsIdentityAndSecureValues() {
        let suite = "bookstr-settings-coverage-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defer { defaults.removePersistentDomain(forName: suite) }
        let secureStore = MemorySecureStore()
        let repo = SettingsRepository(defaults: defaults, keychain: secureStore)

        XCTAssertEqual(repo.relays, ["wss://relay.nomadwiki.org"])
        repo.relays = [" wss://one ", "", "wss://two"]
        XCTAssertEqual(repo.relays, ["wss://one", "wss://two"])
        defaults.set("wss://three, wss://four\n wss://five", forKey: "relays")
        XCTAssertEqual(repo.relays, ["wss://three", "wss://four", "wss://five"])

        XCTAssertTrue(repo.keepReadingOnLockScreen)
        repo.keepReadingOnLockScreen = false
        XCTAssertFalse(repo.keepReadingOnLockScreen)
        XCTAssertEqual(repo.wordSort, "recent")
        repo.wordSort = "alphabetical"
        repo.dictionarySource = "pt"
        repo.dictionaryTarget = "en"
        XCTAssertEqual(repo.wordSort, "alphabetical")
        XCTAssertEqual(repo.dictionarySource, "pt")
        XCTAssertEqual(repo.dictionaryTarget, "en")

        XCTAssertEqual(repo.authMode, .none)
        repo.authMode = .nip46
        repo.pubkeyHex = "  ABCDEF  "
        XCTAssertEqual(repo.pubkeyHex, "abcdef")
        XCTAssertTrue(repo.hasNostrIdentity)
        repo.pubkeyHex = nil
        XCTAssertFalse(repo.hasNostrIdentity)
        repo.pubkeyHex = "abcdef"
        repo.nip46BunkerURL = "https://example.test"
        XCTAssertFalse(repo.hasNip46SessionCredentials)

        repo.signerPackage = "  package  "
        repo.nsec = "  nsec-value  "
        XCTAssertEqual(repo.signerPackage, "package")
        XCTAssertEqual(repo.nsec, "nsec-value")
        XCTAssertEqual(secureStore.values["nsec"], "nsec-value")

        repo.connectNip46(pubkeyHex: "ABCDEF", bunkerURL: "bunker://example", clientSecret: "secret")
        XCTAssertEqual(repo.authMode, .nip46)
        XCTAssertEqual(repo.pubkeyHex, "abcdef")
        XCTAssertEqual(repo.nip46BunkerURL, "bunker://example")
        XCTAssertEqual(repo.nip46ClientSecret, "secret")
        XCTAssertEqual(repo.nip46ClientPubkey, "abcdef")
        XCTAssertNil(repo.signerPackage)
        XCTAssertNil(repo.nsec)
        XCTAssertTrue(repo.hasNip46SessionCredentials)
    }

    func testSessionCacheOutboxCollectionsAndTimestamps() {
        let suite = "bookstr-settings-cache-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defer { defaults.removePersistentDomain(forName: suite) }
        let repo = SettingsRepository(defaults: defaults, keychain: MemorySecureStore())

        XCTAssertNil(repo.readerSession())
        repo.saveReaderSession(ReaderSession(
            bookId: " ", bookTitle: "", format: .epub, author: nil, year: nil,
            locator: nil, pageIndex: 0, pageOffset: 0, rightsStatus: nil,
            license: nil, licenseUrl: nil, rightsSource: nil
        ))
        XCTAssertNil(repo.readerSession())
        let session = ReaderSession(
            bookId: "book", bookTitle: "Title", format: .epub, author: nil, year: nil,
            locator: "epubcfi(/6/2)", pageIndex: 2, pageOffset: 1, rightsStatus: nil,
            license: nil, licenseUrl: nil, rightsSource: nil
        )
        repo.saveReaderSession(session)
        XCTAssertEqual(repo.readerSession()?.bookId, "book")
        defaults.set(Data([0xff]), forKey: "reader_session")
        XCTAssertNil(repo.readerSession())
        repo.clearReaderSession()

        XCTAssertNil(repo.readerSelection())
        let selection = ReaderSelection(bookId: "comic", format: .cbr, selectedAt: 42)
        repo.saveReaderSelection(selection)
        XCTAssertEqual(repo.readerSelection(), selection)
        defaults.set(Data([0xff]), forKey: "reader_selection")
        XCTAssertNil(repo.readerSelection())

        repo.cacheNostrFavorites(pubkey: "ABC", plaintext: "favorites", eventId: "")
        XCTAssertEqual(repo.cachedNostrFavorites(pubkey: "abc"), "favorites")
        XCTAssertNil(repo.cachedFavoritesEventId(pubkey: "abc"))
        repo.cacheNostrFavorites(pubkey: "ABC", plaintext: "favorites-2", eventId: "event")
        XCTAssertEqual(repo.cachedFavoritesEventId(pubkey: "abc"), "event")

        let snapshot = FavoritePendingSnapshot(refs: [], timestamp: 42)
        XCTAssertNil(repo.favoriteOutbox(pubkey: "ABC"))
        repo.saveFavoriteOutbox(pubkey: "ABC", snapshot: snapshot)
        XCTAssertEqual(repo.favoriteOutbox(pubkey: "abc")?.timestamp, 42)
        repo.clearFavoriteOutbox(pubkey: "abc", timestamp: 41)
        XCTAssertNotNil(repo.favoriteOutbox(pubkey: "abc"))
        repo.clearFavoriteOutbox(pubkey: "abc", timestamp: 42)
        XCTAssertNil(repo.favoriteOutbox(pubkey: "abc"))
        defaults.set(Data([0xff]), forKey: "nostr_favorites_outbox_abc")
        XCTAssertNil(repo.favoriteOutbox(pubkey: "abc"))

        XCTAssertEqual(repo.nextFavoritePublishTimestamp(pubkey: "ABC", wallClock: 100), 100)
        XCTAssertEqual(repo.nextFavoritePublishTimestamp(pubkey: "abc", wallClock: 100), 101)
        XCTAssertEqual(repo.nextFavoritePublishTimestamp(pubkey: "abc", wallClock: 200), 200)

        XCTAssertEqual(repo.cachedNostrCollections(pubkey: "abc").collections, [])
        repo.cacheNostrCollections(pubkey: "ABC", snapshot: CollectionSnapshot())
        XCTAssertEqual(repo.cachedNostrCollections(pubkey: "abc").collections, [])
        defaults.set(Data([0xff]), forKey: "nostr_collections_abc")
        XCTAssertEqual(repo.cachedNostrCollections(pubkey: "abc").collections, [])

        XCTAssertFalse(repo.keepsCollectionDownloaded("one"))
        repo.setKeepCollectionDownloaded("one", enabled: true)
        repo.setKeepCollectionDownloaded("two", enabled: true)
        XCTAssertTrue(repo.keepsCollectionDownloaded("one"))
        repo.setKeepCollectionDownloaded("one", enabled: false)
        XCTAssertFalse(repo.keepsCollectionDownloaded("one"))
        XCTAssertTrue(repo.keepsCollectionDownloaded("two"))
    }
}

final class KeychainStoreCoverageTests: XCTestCase {
    func testKeychainSetDeleteAndMissingReadPaths() {
        let keychain = KeychainStore(service: "bookstr-coverage-\(UUID().uuidString)")
        _ = keychain.set(key: "value", value: "secret")
        _ = keychain.set(key: "value", value: nil)
        XCTAssertNil(keychain.get(key: "value"))
        XCTAssertTrue(keychain.set(key: "missing", value: nil))
        XCTAssertNil(keychain.get(key: "missing"))
    }
}
