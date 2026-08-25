import Foundation

struct SharedFavoriteRef: Codable, Equatable {
    var bookstrId: String?
    var libvaultMd5: String?
    var isbn: String?
    var url: String?
    var title: String?
    var author: String?
    var year: String?
    var format: String?
    var blossomSha256: String?
    var blossomUrl: String?
    var addedAt: Int64?
}

struct ExternalFavorite: Identifiable, Equatable {
    let key: String
    let title: String
    let author: String?
    let year: String?
    let url: String?
    let isbn: String?
    let libvaultMd5: String?
    let format: String?
    let blossomSha256: String?
    let blossomUrl: String?
    var addedAt: Int64? = nil

    var id: String { key }
}

struct SharedFavorites: Equatable {
    var bookIds: Set<String> = []
    var external: [ExternalFavorite] = []
}

struct BookCollection: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var description: String
    var updatedAt: Int64
    var items: [SharedFavoriteRef]
}

struct CollectionTombstone: Codable, Equatable {
    var id: String
    var deletedAt: Int64
}

struct CollectionSnapshot: Codable, Equatable {
    var collections: [BookCollection] = []
    var tombstones: [CollectionTombstone] = []
}

struct FavoriteChunkManifest: Equatable {
    var count: Int
    var prefix: String
}

enum FavoritesParser {
    /// Amber NIP-46 wraps ciphertext in another NIP-44 event. ~12KB ciphertext
    /// stays safely under typical 64KB relay limits after wrapping.
    static let maxRemoteDecryptChars = 12_000
    static let maxChunkPlaintextChars = 6_000

    static func serializeSharedFavoriteTags(_ refs: [SharedFavoriteRef]) -> String {
        serializeTags(collectionTags(refs: refs))
    }

    static func collectionTags(refs: [SharedFavoriteRef], updatedAt: Int64? = nil) -> [[String]] {
        let now = updatedAt ?? Int64(Date().timeIntervalSince1970)
        return [
            ["bookstr-collection", "2"],
            ["bookstr-publications", "1"],
            ["title", "Favorites"],
            ["updated", String(now)],
        ] + compactItemTags(refs: refs, fallbackAddedAt: now)
    }

    static func compactItemTags(refs: [SharedFavoriteRef], fallbackAddedAt: Int64) -> [[String]] {
        refs.flatMap { ref -> [[String]] in
            let addedAt = String(ref.addedAt.flatMap { $0 > 0 ? $0 : nil } ?? fallbackAddedAt)
            if let md5 = ref.libvaultMd5?.lowercased(), isMD5(md5) {
                var tags = [["book", "libvault", md5, addedAt]]
                tags.append([
                    "libvault-book", md5, ref.title ?? "", ref.author ?? "", ref.format ?? "", "0", ref.year ?? ""
                ])
                if let sha256 = ref.blossomSha256?.lowercased(), isSHA256(sha256),
                   let url = ref.blossomUrl ?? ref.url, url.lowercased().hasPrefix("https://") {
                    tags.append(["blossom", md5, sha256, url, ref.format ?? ""])
                }
                return tags
            }
            if let sha256 = ref.blossomSha256?.lowercased(), isSHA256(sha256) {
                var tag = ["book", "blossom", sha256, addedAt]
                if let locator = ref.blossomUrl ?? ref.url, !locator.isEmpty { tag.append(locator) }
                return [tag]
            }
            if let bookstrId = ref.bookstrId, !bookstrId.isEmpty {
                var tag = ["book", "bookstr", bookstrId, addedAt]
                if let locator = ref.url, !locator.isEmpty { tag.append(locator) }
                return [tag]
            }
            let isbn = normalizeISBN(ref.isbn)
            if !isbn.isEmpty {
                var tag = ["book", "isbn", isbn, addedAt]
                if let locator = ref.url, !locator.isEmpty { tag.append(locator) }
                return [tag]
            }
            if let url = ref.url, !url.isEmpty {
                return [["book", "url", url, addedAt]]
            }
            return []
        }
    }

    static func splitItemTags(_ tags: [[String]], limit: Int = maxChunkPlaintextChars) -> [[[String]]] {
        var chunks: [[[String]]] = []
        var current: [[String]] = []
        for tag in tags {
            let candidate = current + [tag]
            if !current.isEmpty, serializeTags(candidate).count > limit {
                chunks.append(current)
                current = [tag]
            } else {
                current = candidate
            }
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks.isEmpty ? [[]] : chunks
    }

    static func serializeTags(_ tags: [[String]]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: tags) else { return "[]" }
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    static func matches(_ ref: SharedFavoriteRef, book: CatalogBook) -> Bool {
        ref.bookstrId == book.id
            || (ref.libvaultMd5 != nil && ref.libvaultMd5?.lowercased() == book.libvaultMd5?.lowercased())
            || (!normalizeISBN(ref.isbn).isEmpty && normalizeISBN(ref.isbn) == normalizeISBN(book.isbn))
            || (ref.url != nil && (urlsMatch(ref.url, book.sourceUrl) || urlsMatch(ref.url, book.epubUrl)))
    }

    static func collectionIndexTags(_ snapshot: CollectionSnapshot) -> [[String]] {
        [["bookstr-collection-index", "1"]]
            + snapshot.collections.map { ["collection", $0.id, $0.title, String($0.updatedAt)] }
            + snapshot.tombstones.map { ["deleted", $0.id, String($0.deletedAt)] }
    }

    static func parseCollectionIndex(_ plaintext: String) -> (entries: [(id: String, title: String, updatedAt: Int64)], tombstones: [CollectionTombstone]) {
        guard let data = plaintext.data(using: .utf8),
              let tags = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return ([], []) }
        var entries: [(String, String, Int64)] = []
        var tombstones: [CollectionTombstone] = []
        for item in tags {
            guard let values = item as? [Any] else { continue }
            let parts = values.compactMap { $0 as? String }
            guard let name = parts.first else { continue }
            if name == "collection", parts.count > 3, isCollectionID(parts[1]) {
                entries.append((parts[1], parts[2].isEmpty ? "Untitled list" : parts[2], Int64(parts[3]) ?? 0))
            } else if name == "deleted", parts.count > 2, isCollectionID(parts[1]) {
                tombstones.append(CollectionTombstone(id: parts[1], deletedAt: Int64(parts[2]) ?? 0))
            }
        }
        let deleted = Set(tombstones.map(\.id))
        return (entries.filter { !deleted.contains($0.0) }, tombstones)
    }

    static func parseCollection(_ plaintext: String, id: String, fallbackTitle: String, fallbackUpdatedAt: Int64) -> BookCollection? {
        guard isCollectionID(id), let data = plaintext.data(using: .utf8),
              let tags = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return nil }
        var title = fallbackTitle
        var description = ""
        var updatedAt = fallbackUpdatedAt
        for item in tags {
            guard let values = item as? [Any] else { continue }
            let parts = values.compactMap { $0 as? String }
            if parts.first == "title", parts.count > 1, !parts[1].isEmpty { title = parts[1] }
            if parts.first == "description", parts.count > 1 { description = parts[1] }
            if parts.first == "updated", parts.count > 1 { updatedAt = Int64(parts[1]) ?? updatedAt }
        }
        return BookCollection(id: id, title: title, description: description, updatedAt: updatedAt,
                              items: parseSharedFavoriteTags(tags))
    }

    static func collectionTags(_ collection: BookCollection) -> [[String]] {
        [
            ["bookstr-collection", "2"],
            ["bookstr-publications", "1"],
            ["title", collection.title],
        ] + (collection.description.isEmpty ? [] : [["description", collection.description]])
            + [["updated", String(collection.updatedAt)]]
            + compactItemTags(refs: collection.items, fallbackAddedAt: collection.updatedAt)
    }

    static func chunkManifest(from plaintext: String) -> FavoriteChunkManifest? {
        guard
            let data = plaintext.data(using: .utf8),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [Any]
        else { return nil }
        return chunkManifest(from: raw)
    }

    static func chunkManifest(from value: [Any]) -> FavoriteChunkManifest? {
        for item in value {
            let parts: [String]
            if let strings = item as? [String] {
                parts = strings
            } else if let mixed = item as? [Any] {
                parts = mixed.compactMap { $0 as? String }
            } else {
                continue
            }
            guard (parts.first == "bookstr-chunks" || parts.first == "libvault-chunks"),
                  parts.count >= 2, let count = Int(parts[1]), (1...10_000).contains(count) else {
                continue
            }
            let rawPrefix = parts.count > 2 ? parts[2].trimmingCharacters(in: .whitespacesAndNewlines) : ""
            let prefix = rawPrefix.isEmpty ? NostrKinds.favoritesChunkPrefix : rawPrefix
            return FavoriteChunkManifest(count: count, prefix: prefix)
        }
        return nil
    }

    static func parseSharedFavoriteTags(_ plaintext: String) -> [SharedFavoriteRef] {
        guard
            let data = plaintext.data(using: .utf8),
            let raw = try? JSONSerialization.jsonObject(with: data)
        else { return [] }
        if let array = raw as? [Any] {
            return parseSharedFavoriteTags(array)
        }
        if let object = raw as? [String: Any], let tags = object["tags"] as? [Any] {
            return parseSharedFavoriteTags(tags)
        }
        return []
    }

    static func parseSharedFavoriteTags(_ value: [Any]) -> [SharedFavoriteRef] {
        var refs: [SharedFavoriteRef] = []
        var pendingURL: String?
        var currentIndex: Int?

        func validURL(_ value: String?) -> String? {
            guard let value, let url = URL(string: value),
                  url.scheme == "http" || url.scheme == "https", url.host != nil else { return nil }
            return value
        }

        func isURLOnly(_ ref: SharedFavoriteRef) -> Bool {
            ref.url != nil && ref.libvaultMd5 == nil && ref.bookstrId == nil
                && ref.isbn == nil && ref.blossomSha256 == nil
        }

        func replaceCurrent(_ transform: (SharedFavoriteRef) -> SharedFavoriteRef) {
            guard let currentIndex, refs.indices.contains(currentIndex) else { return }
            refs[currentIndex] = transform(refs[currentIndex])
        }

        func appendOrMerge(_ ref: SharedFavoriteRef) {
            let index = refs.firstIndex { existing in
                (ref.libvaultMd5 != nil && existing.libvaultMd5 == ref.libvaultMd5)
                    || (ref.bookstrId != nil && existing.bookstrId == ref.bookstrId)
                    || (ref.isbn != nil && normalizeISBN(existing.isbn) == normalizeISBN(ref.isbn))
                    || (ref.blossomSha256 != nil && existing.blossomSha256 == ref.blossomSha256)
                    || (ref.url != nil && existing.url == ref.url)
            }
            if let index {
                var old = refs[index]
                old.bookstrId = old.bookstrId ?? ref.bookstrId
                old.libvaultMd5 = old.libvaultMd5 ?? ref.libvaultMd5
                old.isbn = old.isbn ?? ref.isbn
                if old.addedAt == nil, ref.addedAt != nil { old.url = ref.url ?? old.url }
                else { old.url = old.url ?? ref.url }
                old.title = old.title ?? ref.title
                old.author = old.author ?? ref.author
                old.year = old.year ?? ref.year
                old.format = old.format ?? ref.format
                old.blossomSha256 = old.blossomSha256 ?? ref.blossomSha256
                old.blossomUrl = old.blossomUrl ?? ref.blossomUrl
                old.addedAt = [old.addedAt, ref.addedAt].compactMap { $0 }.min()
                refs[index] = old
                currentIndex = index
            } else if let currentIndex, refs.indices.contains(currentIndex),
                      (isURLOnly(refs[currentIndex]) && ref.libvaultMd5 != nil
                       || refs[currentIndex].libvaultMd5 != nil && isURLOnly(ref)) {
                var old = refs[currentIndex]
                old.libvaultMd5 = old.libvaultMd5 ?? ref.libvaultMd5
                old.url = old.url ?? ref.url
                old.addedAt = [old.addedAt, ref.addedAt].compactMap { $0 }.min()
                refs[currentIndex] = old
            } else {
                refs.append(ref)
                currentIndex = refs.count - 1
            }
        }

        for item in value {
            let parts: [String]
            if let strings = item as? [String] {
                parts = strings
            } else if let mixed = item as? [Any] {
                parts = mixed.compactMap { $0 as? String }
            } else {
                continue
            }
            guard let name = parts.first else { continue }
            switch name {
            case "book" where parts.count > 3:
                let namespace = parts[1]
                let identifier = parts[2]
                let addedAt = Int64(parts[3]).flatMap { $0 > 0 ? $0 : nil }
                let locator = validURL(parts.count > 4 ? parts[4] : nil) ?? pendingURL
                switch namespace {
                case "libvault" where isMD5(identifier):
                    appendOrMerge(SharedFavoriteRef(libvaultMd5: identifier.lowercased(), url: locator, addedAt: addedAt))
                case "bookstr" where !identifier.isEmpty:
                    appendOrMerge(SharedFavoriteRef(bookstrId: identifier, url: locator, addedAt: addedAt))
                case "isbn":
                    let isbn = normalizeISBN(identifier)
                    if !isbn.isEmpty { appendOrMerge(SharedFavoriteRef(isbn: isbn, url: locator, addedAt: addedAt)) }
                case "url" where validURL(identifier) != nil:
                    appendOrMerge(SharedFavoriteRef(url: identifier, addedAt: addedAt))
                case "blossom" where isSHA256(identifier):
                    appendOrMerge(SharedFavoriteRef(url: locator, blossomSha256: identifier.lowercased(),
                                                    blossomUrl: locator, addedAt: addedAt))
                default:
                    continue
                }
                pendingURL = nil
            case "r" where (parts.dropFirst().first?.isEmpty == false):
                pendingURL = parts[1]
            case "libvault" where isMD5(parts.dropFirst().first):
                let md5 = parts[1].lowercased()
                let legacyURL = validURL(parts.count > 2 ? parts[2] : nil) ?? pendingURL
                if let index = refs.firstIndex(where: { $0.libvaultMd5 == md5 }) {
                    if refs[index].url == nil { refs[index].url = legacyURL }
                    currentIndex = index
                } else if legacyURL != nil {
                    appendOrMerge(SharedFavoriteRef(libvaultMd5: md5, url: legacyURL))
                } else {
                    refs.append(SharedFavoriteRef(libvaultMd5: md5))
                    currentIndex = refs.count - 1
                }
                pendingURL = nil
            case "bookstr" where parts.count > 1 && !parts[1].isEmpty:
                appendOrMerge(
                    SharedFavoriteRef(
                        bookstrId: parts[1],
                        url: validURL(parts.count > 4 ? parts[4] : nil) ?? pendingURL,
                        title: parts.count > 2 && !parts[2].isEmpty ? parts[2] : nil,
                        author: parts.count > 3 && !parts[3].isEmpty ? parts[3] : nil
                    )
                )
                pendingURL = nil
            case "libvault-book" where isMD5(parts.dropFirst().first),
                 "bookstr-book" where isMD5(parts.dropFirst().first):
                let md5 = parts[1].lowercased()
                if let index = refs.firstIndex(where: { $0.libvaultMd5 == md5 }) {
                    currentIndex = index
                    replaceCurrent { current in
                        var next = current
                        if parts.count > 2, !parts[2].isEmpty { next.title = parts[2] }
                        if parts.count > 3, !parts[3].isEmpty { next.author = parts[3] }
                        if parts.count > 4, parts[4] == "pdf" || parts[4] == "epub" { next.format = parts[4] }
                        if parts.count > 6, !parts[6].isEmpty { next.year = parts[6] }
                        return next
                    }
                } else {
                    refs.append(
                        SharedFavoriteRef(
                            libvaultMd5: md5,
                            title: parts.count > 2 && !parts[2].isEmpty ? parts[2] : nil,
                            author: parts.count > 3 && !parts[3].isEmpty ? parts[3] : nil,
                            year: parts.count > 6 && !parts[6].isEmpty ? parts[6] : nil,
                            format: parts.count > 4 && (parts[4] == "pdf" || parts[4] == "epub") ? parts[4] : nil
                        )
                    )
                    currentIndex = refs.count - 1
                }
            case "libvault-added" where parts.count > 2 && isMD5(parts[1]):
                let md5 = parts[1].lowercased()
                guard let addedAt = Int64(parts[2]), addedAt > 0 else { continue }
                if let index = refs.firstIndex(where: { $0.libvaultMd5 == md5 }) {
                    currentIndex = index
                    replaceCurrent { current in
                        var next = current
                        next.addedAt = next.addedAt.map { min($0, addedAt) } ?? addedAt
                        return next
                    }
                } else {
                    refs.append(SharedFavoriteRef(libvaultMd5: md5, addedAt: addedAt))
                    currentIndex = refs.count - 1
                }
            case "blossom" where isMD5(parts.dropFirst().first):
                let md5 = parts[1].lowercased()
                if let index = refs.firstIndex(where: { $0.libvaultMd5 == md5 }) {
                    currentIndex = index
                    replaceCurrent { current in
                        var next = current
                        if parts.count > 2, !parts[2].isEmpty { next.blossomSha256 = parts[2] }
                        if parts.count > 3, !parts[3].isEmpty { next.blossomUrl = parts[3] }
                        if parts.count > 4, parts[4] == "pdf" || parts[4] == "epub" { next.format = parts[4] }
                        return next
                    }
                } else {
                    refs.append(
                        SharedFavoriteRef(
                            libvaultMd5: md5,
                            format: parts.count > 4 && (parts[4] == "pdf" || parts[4] == "epub") ? parts[4] : nil,
                            blossomSha256: parts.count > 2 && !parts[2].isEmpty ? parts[2] : nil,
                            blossomUrl: parts.count > 3 && !parts[3].isEmpty ? parts[3] : nil
                        )
                    )
                    currentIndex = refs.count - 1
                }
            case "i" where parts.count > 1 && parts[1].hasPrefix("isbn:"):
                let isbn = normalizeISBN(String(parts[1].dropFirst(5)))
                guard !isbn.isEmpty else { continue }
                if currentIndex != nil {
                    replaceCurrent { current in
                        var next = current
                        next.isbn = isbn
                        if next.url == nil, parts.count > 2, !parts[2].isEmpty {
                            next.url = parts[2]
                        }
                        return next
                    }
                } else {
                    refs.append(
                        SharedFavoriteRef(
                            isbn: isbn,
                            url: parts.count > 2 && !parts[2].isEmpty ? parts[2] : pendingURL
                        )
                    )
                    currentIndex = refs.count - 1
                }
                pendingURL = nil
            default:
                continue
            }
        }
        return refs
    }

    static func matchSharedFavorites(refs: [SharedFavoriteRef], books: [CatalogBook]) -> SharedFavorites {
        var matched = Set<String>()
        var external: [String: ExternalFavorite] = [:]

        for ref in refs {
            let isbn = normalizeISBN(ref.isbn)
            let book = books.first { candidate in
                candidate.id == ref.bookstrId
                    || (ref.libvaultMd5 != nil && candidate.libvaultMd5?.lowercased() == ref.libvaultMd5)
                    || (!isbn.isEmpty && normalizeISBN(candidate.isbn) == isbn)
                    || (ref.blossomSha256 != nil && candidate.blossomSha256?.lowercased() == ref.blossomSha256?.lowercased())
                    || (ref.url != nil && (urlsMatch(ref.url, candidate.sourceUrl) || urlsMatch(ref.url, candidate.epubUrl)))
            }
            if let book {
                matched.insert(book.id)
                continue
            }
            guard let key = ref.libvaultMd5 ?? ref.bookstrId ?? ref.blossomSha256
                    ?? (isbn.isEmpty ? nil : isbn) ?? ref.url else {
                continue
            }
            external[key] = ExternalFavorite(
                key: key,
                title: ref.title ?? fallbackTitle(for: ref, key: key),
                author: ref.author,
                year: ref.year,
                url: ref.url,
                isbn: isbn.isEmpty ? nil : isbn,
                libvaultMd5: ref.libvaultMd5,
                format: ref.format,
                blossomSha256: ref.blossomSha256,
                blossomUrl: ref.blossomUrl,
                addedAt: ref.addedAt
            )
        }
        return SharedFavorites(bookIds: matched, external: Array(external.values))
    }

    private static func fallbackTitle(for ref: SharedFavoriteRef, key: String) -> String {
        if let md5 = ref.libvaultMd5 { return "MD5 \(md5.prefix(10))…" }
        if let sha = ref.blossomSha256 { return "Blossom \(sha.prefix(10))…" }
        let isbn = normalizeISBN(ref.isbn)
        if !isbn.isEmpty { return "ISBN \(isbn)" }
        return key
    }

    private static func urlsMatch(_ lhs: String?, _ rhs: String?) -> Bool {
        guard let lhs, let rhs else { return false }
        if lhs == rhs { return true }
        guard var left = URLComponents(string: lhs), var right = URLComponents(string: rhs) else { return false }
        left.query = nil
        left.fragment = nil
        right.query = nil
        right.fragment = nil
        return left == right
    }

    static func normalizeISBN(_ value: String?) -> String {
        let normalized = (value ?? "").filter { $0.isNumber || $0 == "X" || $0 == "x" }.uppercased()
        return (normalized.count == 10 || normalized.count == 13) ? normalized : ""
    }

    private static func isMD5(_ value: String?) -> Bool {
        guard let value, value.count == 32 else { return false }
        return value.allSatisfy { $0.isHexDigit }
    }

    private static func isSHA256(_ value: String?) -> Bool {
        guard let value, value.count == 64 else { return false }
        return value.allSatisfy { $0.isHexDigit }
    }

    static func isCollectionID(_ value: String) -> Bool {
        value.range(of: #"^bookstr-collection-[a-f0-9]{32}$"#, options: .regularExpression) != nil
    }
}
