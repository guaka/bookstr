import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class DeviceTransferTransportTests: XCTestCase {
    func testMapperOnlyReturnsUserSafeTransferState() {
        let update = TransferUpdateMapper.safe(
            requestId: "request-1", phase: " TRANSFERRING ", completedBytes: 12, totalBytes: 10, errorCode: "  failed  "
        )
        XCTAssertEqual(update?.phase, .transferring)
        XCTAssertEqual(update?.completedBytes, 10)
        XCTAssertEqual(update?.totalBytes, 10)
        XCTAssertEqual(update?.errorCode, "failed")
        XCTAssertNil(TransferUpdateMapper.safe(requestId: "", phase: "completed"))
        XCTAssertNil(TransferUpdateMapper.safe(requestId: "request-1", phase: "unknown"))
        XCTAssertNil(TransferUpdateMapper.safe(requestId: "request\n1", phase: "completed"))
        XCTAssertNil(TransferUpdateMapper.safe(requestId: String(repeating: "r", count: 129), phase: "completed"))
        XCTAssertNil(TransferUpdateMapper.safe(requestId: "request-1", phase: "failed", errorCode: "bad\nerror")?.errorCode)
    }

    func testTransportControlAndEveryLifecycleStateRemainUIOpaque() {
        let control = TransferControl(opaquePayload: "private-control")
        XCTAssertEqual(control.usePayload { $0 }, "private-control")
        XCTAssertEqual(control.description, "TransferControl(redacted)")
        let phases: [TransferPhase] = [.idle, .preparing, .transferring, .completed, .failed, .cancelled]
        XCTAssertEqual(phases.map(\.rawValue), ["idle", "preparing", "transferring", "completed", "failed", "cancelled"])
        let update = TransferUpdate(requestId: "request-1", phase: .completed, completedBytes: 42, totalBytes: 42, errorCode: nil)
        XCTAssertEqual(update, TransferUpdate(requestId: "request-1", phase: .completed, completedBytes: 42, totalBytes: 42, errorCode: nil))
    }
}
