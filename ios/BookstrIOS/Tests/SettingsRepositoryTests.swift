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
}
