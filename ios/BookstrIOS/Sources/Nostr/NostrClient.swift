import Foundation

struct RelayQueryReport {
    var relay: String
    var events: [NostrEvent]
    var finished: String
    var elapsedMs: Int
    var notices: [String]
    var error: String?

    var dTags: [String] {
        events.compactMap(\.dTag)
    }
}

struct FavoritesQueryResult {
    var event: NostrEvent?
    var reports: [RelayQueryReport]
    var fallbackUsed: Bool
}

final class NostrClient {
    static let defaultInteropRelay = "wss://relay.nomadwiki.org"

    /// Isolated from `URLSession.shared` so closing a catalog/favorites socket cannot
    /// tear down Amber's NIP-46 WebSocket on the same relay.
    private static let relaySession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    private static func close(_ socket: URLSessionWebSocketTask) {
        socket.cancel(with: .normalClosure, reason: nil)
    }

    func publishEvent(_ event: NostrEvent, relays: [String]) async -> Bool {
        var accepted = false
        for relay in relays {
            if await sendEventOnce(event, relayURL: relay) { accepted = true }
        }
        return accepted
    }

    func fetchLatestProgress(pubkey: String, bookId: String, relays: [String]) async -> NostrEvent? {
        let filter: [String: Any] = [
            "kinds": [NostrKinds.progress],
            "authors": [pubkey],
            "#d": [NostrKinds.progressDTag(bookId: bookId)],
            "limit": 1
        ]
        return await latestEvent(filter: filter, relays: relays, subscriptionId: "bookstr-progress")
    }

    func fetchLatestFavorites(pubkey: String, relays: [String]) async -> FavoritesQueryResult {
        let combined = Array(Set(relays + [Self.defaultInteropRelay])).sorted()
        let tagged: [String: Any] = [
            "kinds": [NostrKinds.favorites],
            "authors": [pubkey.lowercased()],
            "#d": [NostrKinds.favoritesDTag]
        ]
        let taggedQuery = await queryRelaysReported(relays: combined, subscriptionId: "bookstr-favorites", filter: tagged)
        if let event = taggedQuery.events.max(by: { $0.createdAt < $1.createdAt }) {
            return FavoritesQueryResult(event: event, reports: taggedQuery.reports, fallbackUsed: false)
        }
        let untagged: [String: Any] = [
            "kinds": [NostrKinds.favorites],
            "authors": [pubkey.lowercased()]
        ]
        let untaggedQuery = await queryRelaysReported(relays: combined, subscriptionId: "bookstr-favorites-all", filter: untagged)
        let matching = untaggedQuery.events.filter { $0.dTag == NostrKinds.favoritesDTag }
        return FavoritesQueryResult(
            event: matching.max { $0.createdAt < $1.createdAt },
            reports: taggedQuery.reports + untaggedQuery.reports,
            fallbackUsed: true
        )
    }

    func fetchReplaceable(pubkey: String, kind: Int, dTag: String, relays: [String]) async -> NostrEvent? {
        let combined = Array(Set(relays + [Self.defaultInteropRelay])).sorted()
        let filter: [String: Any] = [
            "kinds": [kind],
            "authors": [pubkey.lowercased()],
            "#d": [dTag],
            "limit": 1
        ]
        let query = await queryRelaysReported(relays: combined, subscriptionId: "bookstr-dtag", filter: filter)
        return query.events.max { $0.createdAt < $1.createdAt }
    }

    func fetchVocabulary(pubkey: String, relays: [String]) async -> [NostrEvent] {
        let events = await fetchApplicationData(pubkey: pubkey, relays: relays)
        return events.filter { event in
            (event.dTag ?? "").hasPrefix(NostrKinds.vocabularyPrefix)
        }
    }

    func fetchApplicationData(pubkey: String, relays: [String]) async -> [NostrEvent] {
        let filter: [String: Any] = [
            "kinds": [NostrKinds.progress],
            "authors": [pubkey]
        ]
        let collected = await queryRelays(relays: relays, subscriptionId: "bookstr-app-data", filter: filter)
        var byID: [String: NostrEvent] = [:]
        for event in collected {
            let key = event.id ?? event.dTag ?? UUID().uuidString
            if let existing = byID[key], existing.createdAt >= event.createdAt { continue }
            byID[key] = event
        }
        return Array(byID.values)
    }

    private func latestEvent(filter: [String: Any], relays: [String], subscriptionId: String) async -> NostrEvent? {
        await queryRelays(relays: relays, subscriptionId: subscriptionId, filter: filter)
            .max { $0.createdAt < $1.createdAt }
    }

    private func queryRelays(relays: [String], subscriptionId: String, filter: [String: Any]) async -> [NostrEvent] {
        await queryRelaysReported(relays: relays, subscriptionId: subscriptionId, filter: filter).events
    }

    private func queryRelaysReported(relays: [String], subscriptionId: String, filter: [String: Any]) async -> (events: [NostrEvent], reports: [RelayQueryReport]) {
        await withTaskGroup(of: RelayQueryReport.self) { group in
            for relay in Set(relays) {
                group.addTask {
                    await self.queryEvents(relayURL: relay, subscriptionId: subscriptionId, filter: filter)
                }
            }
            var reports: [RelayQueryReport] = []
            var all: [NostrEvent] = []
            for await report in group {
                reports.append(report)
                all.append(contentsOf: report.events)
            }
            return (all, reports.sorted { $0.relay < $1.relay })
        }
    }

    static func progressContent(bookId: String, progression: Double, cfi: String, title: String?, author: String?, updatedAt: Int64) -> String {
        var obj: [String: Any] = [
            "v": 1,
            "bookId": bookId,
            "locator": ["progression": progression, "cfi": cfi],
            "updatedAt": updatedAt
        ]
        if let title, !title.isEmpty { obj["title"] = title }
        if let author, !author.isEmpty { obj["author"] = author }
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    static func parseProgressContent(_ content: String, fallbackBookId: String) -> (bookId: String, progression: Double, cfi: String, title: String?, author: String?, updatedAt: Int64?)? {
        guard
            let data = content.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        if let locator = obj["locator"] as? [String: Any] {
            let bookId = (obj["bookId"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? fallbackBookId
            return (bookId, jsonNumber(locator["progression"]) ?? 0, locator["cfi"] as? String ?? "",
                    obj["title"] as? String, (obj["author"] as? String) ?? (obj["authors"] as? String),
                    jsonInt64(obj["updatedAt"]))
        }
        if obj["progression"] != nil {
            return (fallbackBookId, jsonNumber(obj["progression"]) ?? 0, obj["cfi"] as? String ?? "",
                    obj["title"] as? String, (obj["author"] as? String) ?? (obj["authors"] as? String),
                    jsonInt64(obj["updatedAt"]))
        }
        return nil
    }

    private static func jsonNumber(_ value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue }
        if let value = value as? String { return Double(value) }
        return nil
    }

    private static func jsonInt64(_ value: Any?) -> Int64? {
        guard let number = jsonNumber(value) else { return nil }
        return Int64(number)
    }

    private func queryEvents(relayURL: String, subscriptionId: String, filter: [String: Any]) async -> RelayQueryReport {
        let started = Date()
        guard let socketURL = URL(string: relayURL) else {
            return RelayQueryReport(relay: relayURL, events: [], finished: "bad-url", elapsedMs: 0, notices: [], error: "invalid URL")
        }
        let socket = Self.relaySession.webSocketTask(with: socketURL)
        socket.resume()
        let req: [Any] = ["REQ", subscriptionId, filter]
        guard JSONSerialization.isValidJSONObject(req),
              let data = try? JSONSerialization.data(withJSONObject: req),
              let message = String(data: data, encoding: .utf8)
        else {
            Self.close(socket)
            return RelayQueryReport(relay: relayURL, events: [], finished: "bad-filter", elapsedMs: 0, notices: [], error: "could not encode REQ")
        }

        let collected = EventCollector()
        let once = OnceBox<(events: [NostrEvent], finished: String, notices: [String])>()
        let result = await withCheckedContinuation { continuation in
            Task {
                defer {
                    Self.close(socket)
                    let snap = collected.snapshot()
                    once.resume(
                        continuation,
                        returning: (snap.events, snap.finished == "running" ? "loop-end" : snap.finished, snap.notices)
                    )
                }
                do {
                    try await socket.send(.string(message))
                } catch {
                    collected.finish("send-error")
                    collected.note(error.localizedDescription)
                    return
                }
                let deadline = Date().addingTimeInterval(8)
                while Date() < deadline {
                    let remaining = deadline.timeIntervalSinceNow
                    guard remaining > 0 else {
                        collected.finish("deadline")
                        break
                    }
                    guard let msg = await self.receiveMessage(socket, timeout: remaining) else {
                        collected.finish("receive-timeout")
                        break
                    }
                    guard case let .string(text) = msg,
                          let payload = text.data(using: .utf8),
                          let array = try? JSONSerialization.jsonObject(with: payload) as? [Any],
                          let type = array.first as? String
                    else { continue }
                    if type == "NOTICE" {
                        collected.note(array.dropFirst().map { "\($0)" }.joined(separator: " "))
                        continue
                    }
                    if type == "EOSE" {
                        collected.finish("eose")
                        break
                    }
                    if type == "EVENT", let event = self.parseEventMessage(text) {
                        collected.append(event)
                    }
                }
            }
            Task {
                try? await Task.sleep(nanoseconds: 8_500_000_000)
                Self.close(socket)
            }
            Task {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                let snap = collected.snapshot()
                once.resume(
                    continuation,
                    returning: (snap.events, snap.finished == "running" ? "hard-timeout" : snap.finished, snap.notices)
                )
            }
        }
        return RelayQueryReport(
            relay: relayURL,
            events: result.events,
            finished: result.finished,
            elapsedMs: Int(Date().timeIntervalSince(started) * 1000),
            notices: result.notices,
            error: nil
        )
    }

    private func receiveMessage(_ task: URLSessionWebSocketTask, timeout: TimeInterval) async -> URLSessionWebSocketTask.Message? {
        let once = OnceBox<URLSessionWebSocketTask.Message?>()
        return await withCheckedContinuation { continuation in
            task.receive { result in
                once.resume(continuation, returning: try? result.get())
            }
            Task {
                let nanos = UInt64(max(timeout, 0.05) * 1_000_000_000)
                try? await Task.sleep(nanoseconds: nanos)
                once.resume(continuation, returning: nil)
            }
        }
    }

    private func sendEventOnce(_ event: NostrEvent, relayURL: String) async -> Bool {
        guard let socketURL = URL(string: relayURL) else { return false }
        let task = Self.relaySession.webSocketTask(with: socketURL)
        task.resume()
        defer { Self.close(task) }
        guard let eventData = try? JSONEncoder().encode(event),
              let eventObj = try? JSONSerialization.jsonObject(with: eventData),
              let payloadData = try? JSONSerialization.data(withJSONObject: ["EVENT", eventObj]),
              let payload = String(data: payloadData, encoding: .utf8) else { return false }
        do {
            try await task.send(.string(payload))
            for _ in 0..<8 {
                let msg = try await task.receive()
                if case let .string(text) = msg, text.contains("\"OK\"") { return true }
            }
        } catch {
            return false
        }
        return false
    }

    private func parseEventMessage(_ text: String) -> NostrEvent? {
        guard
            let data = text.data(using: .utf8),
            let array = try? JSONSerialization.jsonObject(with: data) as? [Any],
            array.count >= 3,
            (array[0] as? String) == "EVENT",
            let eventObj = array[2] as? [String: Any]
        else { return nil }
        return NostrEvent.fromRelayObject(eventObj)
    }
}

private final class EventCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [NostrEvent] = []
    private var notices: [String] = []
    private var finished = "running"

    func append(_ event: NostrEvent) {
        lock.lock()
        defer { lock.unlock() }
        events.append(event)
    }

    func note(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        notices.append(String(trimmed.prefix(180)))
    }

    func finish(_ reason: String) {
        lock.lock()
        defer { lock.unlock() }
        if finished == "running" {
            finished = reason
        }
    }

    func snapshot() -> (events: [NostrEvent], finished: String, notices: [String]) {
        lock.lock()
        defer { lock.unlock() }
        return (events, finished, notices)
    }
}

private final class OnceBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var resumed = false

    func resume(_ continuation: CheckedContinuation<Value, Never>, returning value: Value) {
        lock.lock()
        defer { lock.unlock() }
        guard !resumed else { return }
        resumed = true
        continuation.resume(returning: value)
    }
}
