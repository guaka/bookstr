import Foundation

/// UI-safe native seam for a foreground WebTorrent/WebRTC implementation.
/// Nostr and transport adapters keep their opaque control data outside SwiftUI.
protocol DeviceTransferTransport {
    func start(request: DeviceTransferRequest, control: TransferControl) -> AsyncStream<TransferUpdate>
    func cancel(requestId: String)
}

struct TransferControl: CustomStringConvertible {
    private let opaquePayload: String
    init(opaquePayload: String) { self.opaquePayload = opaquePayload }

    func usePayload<T>(_ body: (String) throws -> T) rethrows -> T {
        try body(opaquePayload)
    }

    var description: String { "TransferControl(redacted)" }
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
        guard !id.isEmpty,
              id.count <= 128,
              id.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }),
              let phase = phase?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              let mappedPhase = TransferPhase(rawValue: phase) else { return nil }
        let total = max(0, totalBytes ?? 0)
        let nonnegativeCompleted = max(0, completedBytes ?? 0)
        let completed = total > 0 ? min(nonnegativeCompleted, total) : nonnegativeCompleted
        let normalizedError = errorCode?.trimmingCharacters(in: .whitespacesAndNewlines)
        let safeError: String? = normalizedError.flatMap { value -> String? in
            guard !value.isEmpty,
                  value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { return nil }
            return String(value.prefix(80))
        }
        return TransferUpdate(requestId: id, phase: mappedPhase, completedBytes: completed, totalBytes: total, errorCode: safeError)
    }
}
