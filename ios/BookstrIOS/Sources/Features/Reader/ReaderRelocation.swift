import Foundation

enum ReaderRelocation {
    struct Payload: Equatable {
        var cfi: String
        var progression: Double
        var sectionIndex: Int
        var sectionCount: Int
        var source: String?
    }

    static func parse(_ json: String?) -> Payload? {
        guard let json, let data = json.data(using: .utf8),
              let item = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cfi = item["cfi"] as? String
        else { return nil }
        let locator = cfi.trimmingCharacters(in: .whitespacesAndNewlines)
        guard locator.isEmpty == false else { return nil }
        return Payload(
            cfi: locator,
            progression: min(max(jsonDouble(item["progression"]) ?? 0, 0), 1),
            sectionIndex: jsonInt(item["sectionIndex"]) ?? 0,
            sectionCount: max(jsonInt(item["sectionCount"]) ?? 1, 1),
            source: item["source"] as? String
        )
    }

    static func jsonDouble(_ value: Any?) -> Double? {
        guard let value, isBooleanNumber(value) == false else { return nil }
        if let value = value as? Double { return value }
        if let number = value as? NSNumber { return number.doubleValue }
        if let value = value as? String { return Double(value.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return nil
    }

    static func jsonInt(_ value: Any?) -> Int? {
        guard let value, isBooleanNumber(value) == false else { return nil }
        if let value = value as? Int { return value }
        if let number = value as? NSNumber { return number.intValue }
        if let value = value as? String { return Int(value.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return nil
    }

    private static func isBooleanNumber(_ value: Any) -> Bool {
        guard let number = value as? NSNumber else { return value is Bool }
        return CFGetTypeID(number) == CFBooleanGetTypeID()
    }
}

@MainActor
final class ReaderProgressSyncDebouncer {
    private var task: Task<Void, Never>?
    private let delayNanoseconds: UInt64

    init(delayNanoseconds: UInt64 = 1_000_000_000) {
        self.delayNanoseconds = delayNanoseconds
    }

    func schedule(_ operation: @escaping () async -> Void) {
        task?.cancel()
        task = Task { [delayNanoseconds] in
            try? await Task.sleep(nanoseconds: delayNanoseconds)
            guard !Task.isCancelled else { return }
            await operation()
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    deinit {
        task?.cancel()
    }
}
