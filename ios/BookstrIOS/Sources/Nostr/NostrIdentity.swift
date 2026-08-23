import Foundation
import NostrCore

enum NostrIdentity {
    static func hexPublicKey(from value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.lowercased().hasPrefix("npub1"), let key = try? PublicKey(npub: trimmed) {
            return key.hex.lowercased()
        }
        if let key = try? PublicKey(hex: trimmed) {
            return key.hex.lowercased()
        }
        return nil
    }

    static func npub(fromHex hex: String) -> String? {
        guard let normalized = hexPublicKey(from: hex) else { return nil }
        return try? PublicKey(hex: normalized).npub
    }
}
