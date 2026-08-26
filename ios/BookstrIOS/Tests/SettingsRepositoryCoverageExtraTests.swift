import XCTest
@testable import BookstrIOS

final class SettingsRepositoryCoverageExtraTests: XCTestCase {
    func testCachedNostrCollectionsReturnsEmptySnapshotForMalformedStoredData() {
        let suite = "bookstr-settings-collections-malformed-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        defaults.set(Data("not-json".utf8), forKey: "nostr_collections_" + "abc".lowercased())
        let snapshot = repository.cachedNostrCollections(pubkey: "ABC")

        XCTAssertTrue(snapshot.collections.isEmpty)
        XCTAssertTrue(snapshot.tombstones.isEmpty)
        defaults.removePersistentDomain(forName: suite)
    }

    func testCachedNostrCollectionsUsesCaseInsensitivePubkeyLookup() {
        let suite = "bookstr-settings-collections-casing-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: "bookstr-collection-" + String(repeating: "a", count: 32),
                title: "Reading",
                description: "local",
                updatedAt: 1,
                items: []
            )
        ])

        repository.cacheNostrCollections(pubkey: "AbCdEf", snapshot: snapshot)

        XCTAssertEqual(repository.cachedNostrCollections(pubkey: "abcdef").collections.count, 1)
        XCTAssertEqual(repository.cachedNostrCollections(pubkey: "ABCDEF").collections.first?.id, snapshot.collections.first?.id)
        XCTAssertEqual(repository.cachedNostrCollections(pubkey: "xyz").collections.count, 0)

        defaults.removePersistentDomain(forName: suite)
    }

    func testConnectNip46LowercasesPubkeyAndResetsSignerPackage() {
        let suite = "bookstr-settings-connect-nip46-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Could not create isolated UserDefaults")
            return
        }
        defaults.removePersistentDomain(forName: suite)
        let repository = SettingsRepository(defaults: defaults)

        repository.signerPackage = "Com.Example.Amber"
        repository.connectNip46(pubkeyHex: "AaBbCcDd", bunkerURL: "bunker://relay", clientSecret: "secret")

        XCTAssertEqual(repository.authMode, .nip46)
        XCTAssertEqual(repository.pubkeyHex, "aabbccdd")
        XCTAssertNil(repository.signerPackage)
        XCTAssertEqual(repository.nip46BunkerURL, "bunker://relay")
        XCTAssertEqual(repository.nip46ClientSecret, "secret")
        XCTAssertEqual(repository.nip46ClientPubkey, "aabbccdd")

        defaults.removePersistentDomain(forName: suite)
    }
}
