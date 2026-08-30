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
    static func readiness(accountConnected: Bool, devices: [VerifiedDevice]) -> DeviceTransferReadiness {
        guard accountConnected else { return .connectAccount }
        guard devices.contains(where: { !$0.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            return .pairDevice
        }
        return .ready
    }

    static func request(bookId: String?, recipientDeviceId: String?) -> DeviceTransferRequest? {
        let book = bookId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let recipient = recipientDeviceId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !book.isEmpty, !recipient.isEmpty else { return nil }
        return DeviceTransferRequest(bookId: book, recipientDeviceId: recipient)
    }
}
