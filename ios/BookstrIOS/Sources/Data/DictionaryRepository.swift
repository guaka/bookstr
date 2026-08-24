import Foundation
import SQLite3

struct DictionaryLookup: Equatable {
    var word: String
    var language: String
    var partOfSpeech: String
    var definitions: [String]
    var translation: String?
    var sourceUrl: String
}

struct DictionaryPack: Identifiable, Hashable {
    let id: String
    let label: String
    let sourceLanguage: String
    let targetLanguage: String
    let installed: Bool
    let bytes: Int64
}

struct DictionaryPairSelection: Equatable {
    var source: String
    var target: String

    init(source: String = "en", target: String = "pt") {
        self.source = source
        self.target = target
    }

    func availablePacks(in packs: [DictionaryPack]) -> [DictionaryPack] {
        packs.filter { !$0.installed }
    }

    func sources(in packs: [DictionaryPack]) -> [String] {
        Array(Set(availablePacks(in: packs).map(\.sourceLanguage))).sorted()
    }

    func targets(in packs: [DictionaryPack]) -> [String] {
        Array(Set(availablePacks(in: packs)
            .filter { $0.sourceLanguage == source }
            .map(\.targetLanguage))).sorted()
    }

    func selectedPack(in packs: [DictionaryPack]) -> DictionaryPack? {
        availablePacks(in: packs).first {
            $0.sourceLanguage == source && $0.targetLanguage == target
        }
    }

    mutating func normalize(using packs: [DictionaryPack]) {
        let available = availablePacks(in: packs)
        guard !available.isEmpty else {
            source = ""
            target = ""
            return
        }
        let validSources = sources(in: packs)
        if !validSources.contains(source) {
            source = validSources.contains("en") ? "en" : validSources[0]
        }
        let validTargets = targets(in: packs)
        if !validTargets.contains(target) {
            target = validTargets.contains("pt") ? "pt" : validTargets[0]
        }
    }

    mutating func selectSource(_ value: String, using packs: [DictionaryPack]) {
        source = value
        normalize(using: packs)
    }

    mutating func selectTarget(_ value: String, using packs: [DictionaryPack]) {
        target = value
        normalize(using: packs)
    }

    mutating func didInstall(_ pack: DictionaryPack, using packs: [DictionaryPack]) {
        source = pack.sourceLanguage
        target = pack.targetLanguage
        normalize(using: packs)
    }
}

final class DictionaryRepository {
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 20
        return URLSession(configuration: config)
    }()

    private let packDirectory: URL

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        packDirectory = support.appendingPathComponent("bookstr/dictionaries", isDirectory: true)
        try? FileManager.default.createDirectory(at: packDirectory, withIntermediateDirectories: true)
    }

    func packs() -> [DictionaryPack] {
        Self.packSpecs.map { spec in
            let url = packURL(spec.id)
            let values = try? url.resourceValues(forKeys: [.fileSizeKey])
            return DictionaryPack(id: spec.id, label: spec.label, sourceLanguage: spec.source,
                                  targetLanguage: spec.target,
                                  installed: FileManager.default.fileExists(atPath: url.path),
                                  bytes: Int64(values?.fileSize ?? 0))
        }
    }

    func installPack(_ id: String) async throws {
        guard Self.packSpecs.contains(where: { $0.id == id }),
              let remote = URL(string: "https://download.wikdict.com/dictionaries/sqlite/2/\(id).sqlite3")
        else { throw URLError(.badURL) }
        let (temporary, response) = try await URLSession.shared.download(from: remote)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        let size = (try? temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 1024 else { throw URLError(.cannotDecodeContentData) }
        let destination = packURL(id)
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.moveItem(at: temporary, to: destination)
    }

    func removePack(_ id: String) {
        try? FileManager.default.removeItem(at: packURL(id))
    }

    func hasInstalledPack(for language: String) -> Bool {
        let code = language.lowercased().split(separator: "-").first.map(String.init) ?? language.lowercased()
        return Self.packSpecs.contains {
            $0.source == code && FileManager.default.fileExists(atPath: packURL($0.id).path)
        }
    }

    func lookup(word: String, language: String, context: String) async throws -> DictionaryLookup {
        let candidates = lookupCandidates(for: word)
        guard !candidates.isEmpty else {
            throw URLError(.badURL)
        }
        let preferred = language.lowercased().hasPrefix("pt") ? "pt" : languageFor(context: context)
        for wordCandidate in candidates {
            for languageCandidate in [preferred, "en", "pt"] where !languageCandidate.isEmpty {
                if let offline = lookupOffline(word: wordCandidate, language: languageCandidate) { return offline }
            }
            if let first = try await lookupLanguage(word: wordCandidate, language: preferred, followLemma: true) {
                return first
            }
            let fallback = preferred == "pt" ? "en" : "pt"
            if let second = try await lookupLanguage(word: wordCandidate, language: fallback, followLemma: true) {
                return second
            }
        }
        throw URLError(.fileDoesNotExist)
    }

    /// EPUB text can use either an ASCII hyphen or one of the typographic
    /// hyphens. Keep the exact form first and only try the stem if it fails.
    func lookupCandidates(for word: String) -> [String] {
        let normalized = word.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { return [] }
        guard let dash = normalized.firstIndex(where: { $0 == "-" || $0 == "‐" || $0 == "‑" }),
              dash != normalized.startIndex else { return [normalized] }
        let stem = String(normalized[..<dash]).trimmingCharacters(in: .whitespacesAndNewlines)
        return stem.isEmpty || stem == normalized ? [normalized] : [normalized, stem]
    }

    /// Returns every exact match from every installed WikDict source language.
    /// This is intentionally separate from `lookup`, which still prefers the
    /// language of the book for the reader's inline dictionary.
    func lookupAllInstalled(word: String) -> [DictionaryLookup] {
        let candidates = lookupCandidates(for: word)
        guard !candidates.isEmpty else { return [] }
        let sourceLanguages: Set<String> = Set(Self.packSpecs.compactMap { spec -> String? in
            guard FileManager.default.fileExists(atPath: packURL(spec.id).path) else { return nil }
            return spec.source
        })
        let languages = sourceLanguages.sorted { (Self.languages[$0] ?? $0) < (Self.languages[$1] ?? $1) }
        for candidate in candidates {
            let matches = languages.compactMap { lookupOffline(word: candidate, language: $0) }
            if !matches.isEmpty { return matches }
        }
        return []
    }

    private func lookupOffline(word: String, language: String) -> DictionaryLookup? {
        let installed = Self.packSpecs.filter {
            $0.source == language && FileManager.default.fileExists(atPath: packURL($0.id).path)
        }.sorted {
            let left = $0.target == "en" ? 0 : ($0.target == "pt" ? 1 : 2)
            let right = $1.target == "en" ? 0 : ($1.target == "pt" ? 1 : 2)
            return left == right ? $0.label < $1.label : left < right
        }
        var definitions: [String] = []
        var targets: [String] = []
        for spec in installed {
            var database: OpaquePointer?
            guard sqlite3_open_v2(packURL(spec.id).path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK,
                  let database else { continue }
            defer { sqlite3_close(database) }
            var statement: OpaquePointer?
            let sql = "SELECT trans_list, sense_list FROM translation_grouped " +
                "WHERE written_rep = ? COLLATE NOCASE ORDER BY score DESC, importance DESC"
            guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else { continue }
            defer { sqlite3_finalize(statement) }
            word.withCString { pointer in sqlite3_bind_text(statement, 1, pointer, -1, nil) }
            var rows: [String] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                let translations = sqlite3_column_text(statement, 0).map { String(cString: $0) } ?? ""
                let sense = sqlite3_column_text(statement, 1).map { String(cString: $0) } ?? ""
                let cleaned = translations.replacingOccurrences(of: " | ", with: ", ").trimmingCharacters(in: .whitespaces)
                let row = sense.isEmpty ? cleaned : "\(cleaned) — \(sense)"
                if !row.isEmpty, !rows.contains(row) { rows.append(row) }
            }
            if !rows.isEmpty {
                targets.append(spec.target.uppercased())
                definitions.append(contentsOf: rows.map { "\(spec.target.uppercased()) · \($0)" })
            }
        }
        guard !definitions.isEmpty else { return nil }
        return DictionaryLookup(word: word, language: language,
                                partOfSpeech: "\(Self.languages[language] ?? language.uppercased()) → \(targets.joined(separator: ", "))",
                                definitions: definitions, translation: nil,
                                sourceUrl: "https://www.wikdict.com/")
    }

    private func packURL(_ id: String) -> URL {
        packDirectory.appendingPathComponent("\(id).sqlite3")
    }

    private struct PackSpec {
        let id: String
        let label: String
        let source: String
        let target: String
    }

    private static let languages: [String: String] = [
        "bg": "Bulgarian", "ca": "Catalan", "cs": "Czech", "da": "Danish", "de": "German",
        "el": "Greek", "en": "English", "es": "Spanish", "fi": "Finnish", "fr": "French",
        "ga": "Irish", "id": "Indonesian", "it": "Italian", "ja": "Japanese", "ku": "Kurdish",
        "la": "Latin", "lt": "Lithuanian", "mg": "Malagasy", "nl": "Dutch", "no": "Norwegian",
        "pl": "Polish", "pt": "Portuguese", "ru": "Russian", "sv": "Swedish", "tr": "Turkish",
        "zh": "Chinese"
    ]

    private static let packSpecs: [PackSpec] = languages.flatMap { source, sourceName in
        languages.compactMap { target, targetName in
            guard source != target else { return nil }
            return PackSpec(id: "\(source)-\(target)", label: "\(sourceName) → \(targetName)",
                            source: source, target: target)
        }
    }.sorted { $0.label < $1.label }

    func needsLemmaFollow(definitions: [String], word: String) -> Bool {
        guard lemma(from: definitions, word: word) != nil else { return false }
        return definitions.allSatisfy { isInflectionGloss($0, word: word) || isInflectionNoise($0, word: word) }
    }

    func lemma(from definitions: [String], word: String) -> String? {
        let normalizedWord = word.lowercased()
        for line in definitions {
            if let lemma = lemma(in: line), lemma != normalizedWord {
                return lemma
            }
        }
        return nil
    }

    func merge(inflection: DictionaryLookup, lemma entry: DictionaryLookup) -> DictionaryLookup {
        let note = inflection.definitions
            .compactMap { line -> String? in
                guard lemma(in: line) != nil else { return nil }
                return line.trimmingCharacters(in: CharacterSet(charactersIn: ".,;: "))
            }
            .first
        var definitions: [String] = []
        if let note, !note.isEmpty {
            definitions.append(note)
        }
        for definition in entry.definitions {
            if !definitions.contains(definition) {
                definitions.append(definition)
            }
            if definitions.count == 4 { break }
        }
        return DictionaryLookup(
            word: inflection.word,
            language: inflection.language,
            partOfSpeech: entry.partOfSpeech.isEmpty ? inflection.partOfSpeech : entry.partOfSpeech,
            definitions: definitions,
            translation: entry.translation ?? inflection.translation,
            sourceUrl: inflection.sourceUrl
        )
    }

    func languageFor(context: String) -> String {
        let normalized = " \(context.lowercased()) "
        let portugueseSignals = [" de ", " para ", " que ", " não ", " uma ", " com ", " por ", "ção"]
        return portugueseSignals.contains(where: normalized.contains) ? "pt" : "en"
    }

    func parseExtract(_ extract: String, language: String, word: String) -> (partOfSpeech: String, definitions: [String], translation: String?) {
        let wanted = language == "pt" ? "Português" : "English"
        let lines = extract.split(separator: "\n", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        guard let languageIndex = lines.firstIndex(where: { headingText($0).caseInsensitiveCompare(wanted) == .orderedSame }) else {
            return ("", [], translation(from: extract))
        }
        let languageLevel = headingLevel(lines[languageIndex])
        let end = (languageIndex + 1 ..< lines.count).first { index in
            let level = headingLevel(lines[index])
            return level > 0 && level <= languageLevel
        } ?? lines.count
        let ignored = try! NSRegularExpression(
            pattern: "^(Etimologia|Pronúncia|Tradução|Traduções|Ver também|Ligações externas|Etymology.*|Pronunciation|Translations|Related terms|Derived terms|See also|Further reading|Anagrams)$",
            options: [.caseInsensitive]
        )
        var partOfSpeech = ""
        var definitions: [String] = []
        var accepting = false
        let section = Array(lines[languageIndex + 1 ..< end])
        for line in section {
            let level = headingLevel(line)
            if level > languageLevel {
                let heading = headingText(line)
                let isIgnored = ignored.firstMatch(in: heading, range: NSRange(heading.startIndex..., in: heading)) != nil
                accepting = !isIgnored && !heading.isEmpty
                if accepting && partOfSpeech.isEmpty {
                    partOfSpeech = heading
                }
                continue
            }
            if !accepting || line.isEmpty { continue }
            if isInflectionNoise(line, word: word) { continue }
            if isHeadwordPronunciation(line) { continue }
            let lettersOnly = line.unicodeScalars.filter { CharacterSet.letters.contains($0) }.map(String.init).joined().lowercased()
            let wordLetters = word.unicodeScalars.filter { CharacterSet.letters.contains($0) }.map(String.init).joined().lowercased()
            if lettersOnly == wordLetters { continue }
            if line.hasPrefix("IPA") || line.hasPrefix("Rhymes:") || line.hasPrefix("Hyphenation:") { continue }
            if line.count < 3 || definitions.contains(line) { continue }
            definitions.append(line)
            if definitions.count == 4 { break }
        }
        return (partOfSpeech, definitions, translation(from: section.joined(separator: "\n")) ?? translation(from: extract))
    }

    func translation(from text: String) -> String? {
        let pattern = try! NSRegularExpression(
            pattern: #"(?im)^(?:[\*\-]\s*)?Ingl[eê]s\s*:\s*(.+)$"#
        )
        let nsText = text as NSString
        guard let match = pattern.firstMatch(in: text, range: NSRange(location: 0, length: nsText.length)),
              match.numberOfRanges > 1
        else { return nil }
        let raw = nsText.substring(with: match.range(at: 1))
            .replacingOccurrences(of: "[[", with: "")
            .replacingOccurrences(of: "]]", with: "")
            .replacingOccurrences(of: "'", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let first = raw.split(whereSeparator: { $0 == ";" || $0 == "," }).first.map(String.init) ?? raw
        let cleaned = first.trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? nil : cleaned
    }

    func translation(fromHTML html: String) -> String? {
        let pattern = try! NSRegularExpression(
            pattern: #"Ingl[eê]s(?:\s*</[^>]+>)*\s*:\s*([^<\n]+)"#,
            options: [.caseInsensitive]
        )
        let nsHTML = html as NSString
        guard let match = pattern.firstMatch(in: html, range: NSRange(location: 0, length: nsHTML.length)),
              match.numberOfRanges > 1
        else { return nil }
        let raw = nsHTML.substring(with: match.range(at: 1))
            .replacingOccurrences(of: "[[", with: "")
            .replacingOccurrences(of: "]]", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return raw.isEmpty ? nil : raw
    }

    private func lookupLanguage(word: String, language: String, followLemma: Bool) async throws -> DictionaryLookup? {
        let host = language == "pt" ? "pt.wiktionary.org" : "en.wiktionary.org"
        guard let extract = try await fetchExtract(host: host, word: word) else { return nil }
        var parsed = parseExtract(extract, language: language, word: word)
        if language == "pt", parsed.translation == nil, let html = try await fetchHTML(host: host, word: word) {
            parsed.translation = translation(fromHTML: html)
        }
        if parsed.definitions.isEmpty && parsed.translation == nil { return nil }
        var result = DictionaryLookup(
            word: word,
            language: language,
            partOfSpeech: parsed.partOfSpeech,
            definitions: parsed.definitions,
            translation: parsed.translation,
            sourceUrl: "https://\(host)/wiki/\(word.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? word)"
        )
        if followLemma, let lemmaWord = lemma(from: parsed.definitions, word: word),
           let base = try await lookupLanguage(word: lemmaWord, language: language, followLemma: false) {
            result = merge(inflection: result, lemma: base)
        }
        return result
    }

    func isHeadwordPronunciation(_ line: String) -> Bool {
        line.range(
            of: #"^[A-Za-zÀ-ÿ]+(?:\.[A-Za-zÀ-ÿ]+)+(?:,\s+\w+)?$"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    func isInflectionNoise(_ line: String, word: String) -> Bool {
        let lower = line.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let stem = word.lowercased()
        guard lower.hasPrefix(stem) else { return false }
        let rest = lower.dropFirst(stem.count).trimmingCharacters(in: .whitespacesAndNewlines)
        guard rest.hasPrefix(",") else { return false }
        let tag = rest.dropFirst().trimmingCharacters(in: .whitespaces)
        return tag == "plural" || tag.hasPrefix("plural ")
            || tag == "feminino" || tag.hasPrefix("feminino ")
            || tag == "masculino" || tag.hasPrefix("masculino ")
            || tag == "singular" || tag.hasPrefix("singular ")
    }

    func isInflectionGloss(_ line: String, word: String) -> Bool {
        lemma(in: line) != nil || isInflectionNoise(line, word: word)
    }

    private func lemma(in line: String) -> String? {
        let pattern = try! NSRegularExpression(
            pattern: #"(?i)(?:plural|feminino|masculino|diminutivo|aumentativo|superlativo|particípio(?:\s+passado)?|gerúndio|infinitivo|forma\s+(?:feminina|masculina|plural))\s+de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]*)"#
        )
        let english = try! NSRegularExpression(
            pattern: #"(?i)(?:plural|feminine|masculine|diminutive|past\s+participle)\s+of\s+([A-Za-z][A-Za-z'’\-]*)"#
        )
        let nsLine = line as NSString
        let range = NSRange(location: 0, length: nsLine.length)
        let match = pattern.firstMatch(in: line, range: range) ?? english.firstMatch(in: line, range: range)
        guard let match, match.numberOfRanges > 1 else { return nil }
        let lemma = nsLine.substring(with: match.range(at: 1))
            .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:[] "))
            .lowercased()
        return lemma.isEmpty ? nil : lemma
    }

    private func fetchExtract(host: String, word: String) async throws -> String? {
        var components = URLComponents(string: "https://\(host)/w/api.php")
        components?.queryItems = [
            URLQueryItem(name: "action", value: "query"),
            URLQueryItem(name: "prop", value: "extracts"),
            URLQueryItem(name: "explaintext", value: "1"),
            URLQueryItem(name: "redirects", value: "1"),
            URLQueryItem(name: "titles", value: word),
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "formatversion", value: "2")
        ]
        guard let url = components?.url else { return nil }
        let (data, response) = try await Self.session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let pages = (json?["query"] as? [String: Any])?["pages"] as? [[String: Any]]
        let extract = pages?.first?["extract"] as? String
        return extract?.isEmpty == false ? extract : nil
    }

    private func fetchHTML(host: String, word: String) async throws -> String? {
        var components = URLComponents(string: "https://\(host)/w/api.php")
        components?.queryItems = [
            URLQueryItem(name: "action", value: "parse"),
            URLQueryItem(name: "page", value: word),
            URLQueryItem(name: "prop", value: "text"),
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "formatversion", value: "2")
        ]
        guard let url = components?.url else { return nil }
        let (data, response) = try await Self.session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (json?["parse"] as? [String: Any])?["text"] as? String
    }

    private func headingLevel(_ line: String) -> Int {
        guard let match = try? NSRegularExpression(pattern: "^(=+)\\s*.*?\\s*\\1$")
            .firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
              match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: line)
        else { return 0 }
        return line[range].count
    }

    private func headingText(_ line: String) -> String {
        line.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "=")).trimmingCharacters(in: .whitespaces)
    }
}
