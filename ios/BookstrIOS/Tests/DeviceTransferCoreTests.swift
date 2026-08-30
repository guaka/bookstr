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
    }
}
