import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

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
}
