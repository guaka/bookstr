import XCTest

final class KeychainStoreExtraCoverageTests: XCTestCase {
    func testServicesDoNotShareStoredValues() {
        let serviceA = "bookstr-keychain-extra-coverage-" + UUID().uuidString
        let serviceB = "bookstr-keychain-extra-coverage-" + UUID().uuidString
        let key = "shared-key-" + UUID().uuidString

        let storeA = KeychainStore(service: serviceA)
        let storeB = KeychainStore(service: serviceB)

        storeA.set(key: key, value: "value-a")
        storeB.set(key: key, value: "value-b")
        storeB.set(key: key, value: nil)

        XCTAssertEqual(storeA.get(key: key), "value-a")
        XCTAssertNil(storeB.get(key: key))
        XCTAssertNil(storeA.get(key: "missing-" + UUID().uuidString))

        storeA.set(key: key, value: nil)
        XCTAssertNil(storeA.get(key: key))
    }

    func testStoresNonAsciiValuesWithoutLoss() {
        let service = "bookstr-keychain-extra-unicode-" + UUID().uuidString
        let key = "unicode-key-" + UUID().uuidString
        let value = "line1\nline2-🧪-emoji"
        let store = KeychainStore(service: service)

        defer { store.set(key: key, value: nil) }

        store.set(key: key, value: value)
        XCTAssertEqual(store.get(key: key), value)

        store.set(key: key, value: "")
        XCTAssertEqual(store.get(key: key), "")
    }
}
