import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class DeviceTransferTransportTests: XCTestCase {
    func testMapperOnlyReturnsUserSafeTransferState() {
        let update = TransferUpdateMapper.safe(requestId: "request-1", phase: "transferring", completedBytes: -2, totalBytes: -1)
        XCTAssertEqual(update?.phase, .transferring)
        XCTAssertEqual(update?.completedBytes, 0)
        XCTAssertNil(TransferUpdateMapper.safe(requestId: "", phase: "completed"))
        XCTAssertNil(TransferUpdateMapper.safe(requestId: "request-1", phase: "unknown"))
    }
}
