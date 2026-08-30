import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class DeviceTransferCoreTests: XCTestCase {
    func testReadinessGuidesAccountPairingAndTransferUI() {
        XCTAssertEqual(DeviceTransferCore.readiness(accountConnected: false, devices: []), .connectAccount)
        XCTAssertEqual(DeviceTransferCore.readiness(accountConnected: true, devices: []), .pairDevice)
        XCTAssertEqual(
            DeviceTransferCore.readiness(accountConnected: true, devices: [VerifiedDevice(id: "phone-1", name: "Phone")]),
            .ready
        )
    }

    func testRequestOnlyContainsNormalizedBookAndDeviceIds() {
        XCTAssertEqual(
            DeviceTransferCore.request(bookId: " book-1 ", recipientDeviceId: " phone-1 "),
            DeviceTransferRequest(bookId: "book-1", recipientDeviceId: "phone-1")
        )
        XCTAssertNil(DeviceTransferCore.request(bookId: " ", recipientDeviceId: "phone-1"))
        XCTAssertNil(DeviceTransferCore.request(bookId: "book-1", recipientDeviceId: nil))
        XCTAssertNil(DeviceTransferCore.request(bookId: "book\n1", recipientDeviceId: "phone-1"))
        XCTAssertNil(DeviceTransferCore.request(bookId: String(repeating: "b", count: 257), recipientDeviceId: "phone-1"))
        XCTAssertNil(DeviceTransferCore.request(bookId: "book-1", recipientDeviceId: String(repeating: "p", count: 129)))
    }

    func testReadinessIgnoresMalformedDeviceIdentifiers() {
        XCTAssertEqual(
            DeviceTransferCore.readiness(
                accountConnected: true,
                devices: [VerifiedDevice(id: " \n ", name: "Unnamed"), VerifiedDevice(id: "bad\u{0000}id", name: "Bad")]
            ),
            .pairDevice
        )
        XCTAssertEqual(
            DeviceTransferCore.readiness(
                accountConnected: true,
                devices: [VerifiedDevice(id: "  device-2 ", name: "Phone")]
            ),
            .ready
        )
    }
}
