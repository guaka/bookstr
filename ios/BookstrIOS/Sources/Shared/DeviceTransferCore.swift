import Foundation

/// Platform-neutral pairing state for native UI. Transport adapters own all
/// network and file handling; this core has no transport metadata or paths.
enum DeviceTransferReadiness: Equatable {
    case connectAccount
    case pairDevice
    case ready
}

struct VerifiedDevice: Equatable {
    let id: String
    let name: String
}

struct DeviceTransferRequest: Equatable {
    let bookId: String
    let recipientDeviceId: String
}

enum DeviceTransferCore {
    private static func identifier(_ value: String?, maxLength: Int) -> String? {
        let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !normalized.isEmpty,
              normalized.count <= maxLength,
              normalized.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else { return nil }
        return normalized
    }

    static func readiness(accountConnected: Bool, devices: [VerifiedDevice]) -> DeviceTransferReadiness {
        guard accountConnected else { return .connectAccount }
        guard devices.contains(where: { identifier($0.id, maxLength: 128) != nil }) else {
            return .pairDevice
        }
        return .ready
    }

    static func request(bookId: String?, recipientDeviceId: String?) -> DeviceTransferRequest? {
        guard let book = identifier(bookId, maxLength: 256),
              let recipient = identifier(recipientDeviceId, maxLength: 128) else { return nil }
        return DeviceTransferRequest(bookId: book, recipientDeviceId: recipient)
    }
}
