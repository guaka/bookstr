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
}
