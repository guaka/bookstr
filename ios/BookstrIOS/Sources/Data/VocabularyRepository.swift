import Foundation

final class VocabularyRepository {
    private let fileStore: JSONFileStore
    private var cache: [String: VocabularyWord]
    private var bySyncId: [String: String]

    init(fileStore: JSONFileStore) {
        self.fileStore = fileStore
        let items = fileStore.load("vocabulary_words.json", as: [VocabularyWord].self, fallback: [])
        self.cache = Dictionary(uniqueKeysWithValues: items.map { ($0.key, $0) })
        self.bySyncId = Dictionary(items.map { ($0.syncId, $0.key) }, uniquingKeysWith: { _, latest in latest })
    }

    func all() -> [VocabularyWord] {
        cache.values.filter { !$0.deleted }.sorted { $0.lastSeenAt > $1.lastSeenAt }
    }

    func word(syncId: String) -> VocabularyWord? {
        guard let key = bySyncId[syncId] else { return nil }
        return cache[key]
    }

    @discardableResult
    func saveSelection(word: String, language: String, bookId: String, bookTitle: String, cfi: String, context: String) -> VocabularyWord {
        let normalizedLanguage = language.lowercased()
        let normalizedWord = word.lowercased()
        let key = "\(normalizedLanguage):\(normalizedWord)"
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let existing = cache[key]
        let entry = VocabularyWord(
            key: key,
            word: word,
            language: normalizedLanguage,
            syncId: existing?.syncId ?? UUID().uuidString,
            bookId: bookId,
            bookTitle: bookTitle,
            cfi: cfi,
            contextSentence: context,
            partOfSpeech: existing?.partOfSpeech ?? "",
            definitions: existing?.definitions ?? [],
            translation: existing?.translation,
            sourceUrl: existing?.sourceUrl ?? "",
            lookupCount: (existing?.lookupCount ?? 0) + 1,
            firstSeenAt: existing?.firstSeenAt ?? now,
            lastSeenAt: now,
            deleted: false
        )
        cache[key] = entry
        bySyncId[entry.syncId] = key
        flush()
        return entry
    }

    @discardableResult
    func mergeRemote(_ word: VocabularyWord) -> Bool {
        let existing = cache[word.key]
        if word.deleted {
            if existing == nil || word.lastSeenAt >= existing!.lastSeenAt {
                cache[word.key] = word
                bySyncId[word.syncId] = word.key
                return true
            }
            return false
        }
        if existing == nil || word.lastSeenAt >= existing!.lastSeenAt {
            cache[word.key] = word
            bySyncId[word.syncId] = word.key
            return true
        }
        return false
    }

    @discardableResult
    func remove(key: String) -> VocabularyWord? {
        guard let existing = cache[key], !existing.deleted else { return nil }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let tombstone = VocabularyWord(
            key: existing.key,
            word: existing.word,
            language: existing.language,
            syncId: existing.syncId,
            bookId: existing.bookId,
            bookTitle: existing.bookTitle,
            cfi: existing.cfi,
            contextSentence: existing.contextSentence,
            partOfSpeech: existing.partOfSpeech,
            definitions: existing.definitions,
            translation: existing.translation,
            sourceUrl: existing.sourceUrl,
            lookupCount: existing.lookupCount,
            firstSeenAt: existing.firstSeenAt,
            lastSeenAt: now,
            deleted: true
        )
        cache[key] = tombstone
        bySyncId[tombstone.syncId] = key
        flush()
        return tombstone
    }

    @discardableResult
    func saveDefinition(
        key: String,
        partOfSpeech: String,
        definitions: [String],
        translation: String?,
        sourceUrl: String
    ) -> VocabularyWord? {
        guard let existing = cache[key], !existing.deleted else { return nil }
        let updated = VocabularyWord(
            key: existing.key,
            word: existing.word,
            language: existing.language,
            syncId: existing.syncId,
            bookId: existing.bookId,
            bookTitle: existing.bookTitle,
            cfi: existing.cfi,
            contextSentence: existing.contextSentence,
            partOfSpeech: partOfSpeech.isEmpty ? existing.partOfSpeech : partOfSpeech,
            definitions: definitions.isEmpty ? existing.definitions : definitions,
            translation: (translation?.isEmpty == false ? translation : existing.translation),
            sourceUrl: sourceUrl.isEmpty ? existing.sourceUrl : sourceUrl,
            lookupCount: existing.lookupCount,
            firstSeenAt: existing.firstSeenAt,
            lastSeenAt: existing.lastSeenAt,
            deleted: false
        )
        cache[key] = updated
        flush()
        return updated
    }

    func persist() {
        flush()
    }

    static func parseRemote(_ json: [String: Any]) -> VocabularyWord? {
        let word = (json["word"] as? String)?.lowercased() ?? ""
        let language = (json["language"] as? String)?.lowercased() ?? ""
        guard !word.isEmpty, !language.isEmpty else { return nil }
        guard let syncId = json["syncId"] as? String, !syncId.isEmpty else { return nil }
        guard let bookId = json["bookId"] as? String, let bookTitle = json["bookTitle"] as? String else { return nil }
        let definitions = (json["definitions"] as? [Any])?.compactMap { $0 as? String } ?? []
        let updatedAt = int64(json["lastSeenAt"]) ?? int64(json["updatedAt"]) ?? 0
        return VocabularyWord(
            key: (json["key"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "\(language):\(word)",
            word: word,
            language: language,
            syncId: syncId,
            bookId: bookId,
            bookTitle: bookTitle,
            cfi: json["cfi"] as? String ?? "",
            contextSentence: json["contextSentence"] as? String ?? "",
            partOfSpeech: json["partOfSpeech"] as? String ?? "",
            definitions: definitions,
            translation: json["translation"] as? String,
            sourceUrl: json["sourceUrl"] as? String ?? "",
            lookupCount: int(json["lookupCount"]) ?? 1,
            firstSeenAt: int64(json["firstSeenAt"]) ?? updatedAt,
            lastSeenAt: updatedAt,
            deleted: json["deleted"] as? Bool ?? false
        )
    }

    private static func int64(_ value: Any?) -> Int64? {
        if let value = value as? Int64 { return value }
        if let value = value as? Int { return Int64(value) }
        if let value = value as? Double { return Int64(value) }
        if let value = value as? NSNumber { return value.int64Value }
        if let value = value as? String { return Int64(value) }
        return nil
    }

    private static func int(_ value: Any?) -> Int? {
        if let value = int64(value) { return Int(value) }
        return nil
    }

    private func flush() {
        fileStore.save("vocabulary_words.json", value: Array(cache.values))
    }
}
