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

    func testTransportControlAndEveryLifecycleStateRemainUIOpaque() {
        _ = TransferControl(opaquePayload: "private-control")
        let phases: [TransferPhase] = [.idle, .preparing, .transferring, .completed, .failed, .cancelled]
        XCTAssertEqual(phases.map(\.rawValue), ["idle", "preparing", "transferring", "completed", "failed", "cancelled"])
        let update = TransferUpdate(requestId: "request-1", phase: .completed, completedBytes: 42, totalBytes: 42, errorCode: nil)
        XCTAssertEqual(update, TransferUpdate(requestId: "request-1", phase: .completed, completedBytes: 42, totalBytes: 42, errorCode: nil))
    }
}
