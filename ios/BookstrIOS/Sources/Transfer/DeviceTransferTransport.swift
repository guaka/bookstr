import Foundation

/// UI-safe native seam for a foreground WebTorrent/WebRTC implementation.
/// Nostr and transport adapters keep their opaque control data outside SwiftUI.
protocol DeviceTransferTransport {
    func start(request: DeviceTransferRequest, control: TransferControl) -> AsyncStream<TransferUpdate>
    func cancel(requestId: String)
}

struct TransferControl {
    fileprivate let opaquePayload: String
    init(opaquePayload: String) { self.opaquePayload = opaquePayload }
}

enum TransferPhase: String, Equatable { case idle, preparing, transferring, completed, failed, cancelled }

struct TransferUpdate: Equatable {
    let requestId: String
    let phase: TransferPhase
    let completedBytes: Int64
    let totalBytes: Int64
    let errorCode: String?
}

enum TransferUpdateMapper {
    static func safe(requestId: String?, phase: String?, completedBytes: Int64? = nil, totalBytes: Int64? = nil, errorCode: String? = nil) -> TransferUpdate? {
        let id = requestId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !id.isEmpty, let phase = phase.flatMap(TransferPhase.init(rawValue:)) else { return nil }
        return TransferUpdate(requestId: id, phase: phase, completedBytes: max(0, completedBytes ?? 0), totalBytes: max(0, totalBytes ?? 0), errorCode: errorCode?.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80).description)
    }
}
