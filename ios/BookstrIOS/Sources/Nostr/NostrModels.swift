import Foundation

struct NostrEvent: Codable {
    var id: String?
    var pubkey: String?
    var createdAt: Int64
    var kind: Int
    var tags: [[String]]
    var content: String
    var sig: String?

    enum CodingKeys: String, CodingKey {
        case id, pubkey, kind, tags, content, sig
        case createdAt = "created_at"
    }
}

enum NostrKinds {
    static let progress = 30078
    static let favorites = 30003
    static let favoritesDTag = "libvault-favorites"
    static let favoritesChunkPrefix = "libvault-favorites-chunk"
    static let collectionChunkPrefix = "bookstr-chunk"
    static let collectionIndexDTag = "bookstr-collections"
    static let vocabularyPrefix = "app.bookstr.vocabulary."
    static let comment = 1111
    static let snippetPrefix = "app.bookstr.snippet."

    static func progressDTag(bookId: String) -> String {
        "app.bookstr.progress.\(bookId)"
    }

    static func favoritesChunkDTag(prefix: String = favoritesChunkPrefix, index: Int) -> String {
        "\(prefix)-\(index)"
    }
}

struct BlossomAuthorizationRequest: Equatable {
    let kind: Int
    let createdAt: Int64
    let tags: [[String]]
    let content: String
}

enum BlossomAuthorizationWire {
    static let kind = 24_242

    static func unsignedGetEvent(
        hash: String,
        server: String,
        now: Int64,
        content: String
    ) throws -> BlossomAuthorizationRequest {
        guard hash.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil else {
            throw NSError(domain: "BlossomAuthorization", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid Blossom SHA-256"])
        }
        guard !server.isEmpty, !server.contains("/") else {
            throw NSError(domain: "BlossomAuthorization", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid Blossom server name"])
        }
        return BlossomAuthorizationRequest(
            kind: kind,
            createdAt: now,
            tags: [
                ["t", "get"],
                ["expiration", String(now + 120)],
                ["server", server],
                ["x", hash.lowercased()]
            ],
            content: content
        )
    }
}

enum SnippetVisibility: String, Codable {
    case publicPost
    case privateNote
}

struct BookSnippetPayload: Codable, Equatable {
    let version: Int
    let id: String
    let text: String
    let bookId: String
    let title: String
    let author: String
    let isbn: String?
    let format: BookFormat
    let locator: String
    let createdAt: Int64
}

extension NostrEvent {
    var dTag: String? {
        tags.first { $0.first == "d" }?.dropFirst().first
    }

    static func fromRelayObject(_ eventObj: [String: Any]) -> NostrEvent? {
        let kind = intValue(eventObj["kind"]) ?? 0
        let createdAt = int64Value(eventObj["created_at"]) ?? 0
        let content = eventObj["content"] as? String ?? ""
        return NostrEvent(
            id: eventObj["id"] as? String,
            pubkey: eventObj["pubkey"] as? String,
            createdAt: createdAt,
            kind: kind,
            tags: stringTags(eventObj["tags"]),
            content: content,
            sig: eventObj["sig"] as? String
        )
    }

    private static func stringTags(_ value: Any?) -> [[String]] {
        guard let rows = value as? [Any] else { return [] }
        return rows.compactMap { row in
            guard let parts = row as? [Any], !parts.isEmpty else { return nil }
            return parts.map { part in
                if let string = part as? String { return string }
                if let number = part as? NSNumber { return number.stringValue }
                return "\(part)"
            }
        }
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let value = int64Value(value) { return Int(value) }
        return nil
    }

    private static func int64Value(_ value: Any?) -> Int64? {
        if let value = value as? Int64 { return value }
        if let value = value as? Int { return Int64(value) }
        if let value = value as? Double { return Int64(value) }
        if let value = value as? NSNumber { return value.int64Value }
        if let value = value as? String { return Int64(value) }
        return nil
    }
}
