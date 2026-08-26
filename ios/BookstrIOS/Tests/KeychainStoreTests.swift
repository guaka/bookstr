import XCTest

final class KeychainStoreTests: XCTestCase {
    func testGetMissingKeyReturnsNil() {
        let service = "bookstr-keychain-missing-" + UUID().uuidString
        let store = KeychainStore(service: service)

        XCTAssertNil(store.get(key: "does-not-exist"))
    }

    func testSetAndGetRoundTrip() {
        let service = "bookstr-keychain-test-" + UUID().uuidString
        let store = KeychainStore(service: service)
        let key = "roundTripKey-" + UUID().uuidString
        let value = "stored-value"

        defer {
            store.set(key: key, value: nil)
        }

        store.set(key: key, value: value)
        XCTAssertEqual(store.get(key: key), value)
        XCTAssertEqual(store.get(key: key), value)
    }

    func testNilValueDeletesStoredKey() {
        let service = "bookstr-keychain-test-" + UUID().uuidString
        let store = KeychainStore(service: service)
        let key = "deleteKey-" + UUID().uuidString

        store.set(key: key, value: "temp")
        XCTAssertEqual(store.get(key: key), "temp")

        store.set(key: key, value: nil)
        XCTAssertNil(store.get(key: key))
    }

    func testSetOverwritesPreviousValue() {
        let service = "bookstr-keychain-overwrite-" + UUID().uuidString
        let store = KeychainStore(service: service)
        let key = "overwrite-" + UUID().uuidString

        store.set(key: key, value: "one")
        store.set(key: key, value: "two")
        XCTAssertEqual(store.get(key: key), "two")

        store.set(key: key, value: nil)
    }
}
