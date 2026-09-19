import Foundation

struct SpeechLanguageSetting: Codable, Equatable {
    var voiceIdentifier: String
    var rate: Double?

    init(voiceIdentifier: String = "", rate: Double? = nil) {
        self.voiceIdentifier = voiceIdentifier
        self.rate = rate
    }
}

enum SpeechPlaybackEngine: Equatable {
    case neural(SpeechEngineID)
    case apple
}

struct SpeechPlaybackChoice: Equatable {
    var languageTag: String
    var voiceIdentifier: String
    var rate: Double

    var neuralEngine: SpeechEngineID? {
        guard let engine = SpeechEngineID(rawValue: voiceIdentifier), engine.isNeural else { return nil }
        return engine
    }

    var engine: SpeechPlaybackEngine {
        if let neuralEngine {
            return .neural(neuralEngine)
        }
        return .apple
    }
}

enum SpeechVoiceID {
    static let systemDefault = ""

    static func speakers(for language: String) -> [(id: String, name: String)] {
        SpeechEngineID.allCases
            .filter { $0.isNeural && $0.supports(language: language) }
            .map { ($0.rawValue, $0.label) }
    }
}

enum SpeechLanguageSettings {
    static let defaultRate = 0.48
    static let minimumRate = 0.35
    static let maximumRate = 0.60
    static let speechEngineKey = "speech_engine"
    /// Always available in TTS settings, regardless of library contents.
    static let seededLanguageTags = ["en", "pt-pt", "fr", "de", "es", "ca"]

    static func preferredLanguageTag(_ raw: String) -> String {
        let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "_", with: "-")
            .lowercased()
            .folding(options: .diacriticInsensitive, locale: Locale(identifier: "en"))
        if normalized.isEmpty { return "en" }
        if normalized.hasPrefix("portugu") { return "pt-pt" }
        let parts = normalized.split(separator: "-").map(String.init)
        let base = iso639Base(parts.first ?? normalized)
        let region = parts.dropFirst().first
        if base == "pt" {
            if region == "br" { return "pt-br" }
            return "pt-pt"
        }
        if let region { return "\(base)-\(region)" }
        return base
    }

    static func iso639Base(_ code: String) -> String {
        switch code {
        case "por", "portuguese": "pt"
        case "eng", "english": "en"
        case "fra", "fre", "french", "francais": "fr"
        case "deu", "ger", "german", "deutsch": "de"
        case "spa", "spanish", "espanol", "castellano": "es"
        case "cat", "catalan", "catala": "ca"
        default: code
        }
    }

    static func resolve(
        bookLanguage: String,
        settingsByLanguage: [String: SpeechLanguageSetting],
        defaultRate: Double = defaultRate
    ) -> SpeechPlaybackChoice {
        let languageTag = preferredLanguageTag(bookLanguage)
        let setting = setting(for: languageTag, in: settingsByLanguage)
        return SpeechPlaybackChoice(
            languageTag: languageTag,
            voiceIdentifier: setting?.voiceIdentifier ?? SpeechVoiceID.systemDefault,
            rate: clampRate(setting?.rate ?? defaultRate)
        )
    }

    static func setting(
        for languageTag: String,
        in settings: [String: SpeechLanguageSetting]
    ) -> SpeechLanguageSetting? {
        let requested = preferredLanguageTag(languageTag)
        if let exact = settings[requested] { return exact }
        let base = baseLanguage(requested)
        if let languageOnly = settings[base] { return languageOnly }
        let regional = settings.filter { baseLanguage($0.key) == base && $0.key != base }
        if regional.count == 1, let only = regional.first { return only.value }
        return nil
    }

    static func migrateLegacyEngine(
        _ raw: String?,
        into settings: [String: SpeechLanguageSetting]
    ) -> [String: SpeechLanguageSetting] {
        guard settings.isEmpty,
              let raw, let engine = SpeechEngineID(rawValue: raw), engine.isNeural
        else { return settings }
        var next = settings
        next[engine.preferredLanguageTag] = SpeechLanguageSetting(voiceIdentifier: engine.rawValue)
        return next
    }

    /// Fold stale keys like `english` into canonical tags such as `en`.
    static func canonicalizeSettingsKeys(
        _ settings: [String: SpeechLanguageSetting]
    ) -> [String: SpeechLanguageSetting] {
        var next: [String: SpeechLanguageSetting] = [:]
        for (key, value) in settings {
            let tag = preferredLanguageTag(key)
            if let existing = next[tag] {
                if existing.voiceIdentifier.isEmpty && !value.voiceIdentifier.isEmpty {
                    next[tag] = value
                } else if existing.rate == nil, value.rate != nil {
                    next[tag] = SpeechLanguageSetting(
                        voiceIdentifier: existing.voiceIdentifier.isEmpty ? value.voiceIdentifier : existing.voiceIdentifier,
                        rate: value.rate
                    )
                }
            } else {
                next[tag] = value
            }
        }
        return next
    }

    static func clampRate(_ rate: Double) -> Double {
        min(max(rate, minimumRate), maximumRate)
    }

    static func isEnglish(_ languageTag: String) -> Bool {
        baseLanguage(languageTag) == "en"
    }

    static func isPortuguese(_ languageTag: String) -> Bool {
        baseLanguage(languageTag) == "pt"
    }

    static func isFrench(_ languageTag: String) -> Bool {
        baseLanguage(languageTag) == "fr"
    }

    static func isGerman(_ languageTag: String) -> Bool {
        baseLanguage(languageTag) == "de"
    }

    static func isSpanish(_ languageTag: String) -> Bool {
        baseLanguage(languageTag) == "es"
    }

    static func isCatalan(_ languageTag: String) -> Bool {
        baseLanguage(languageTag) == "ca"
    }

    static func baseLanguage(_ languageTag: String) -> String {
        preferredLanguageTag(languageTag).split(separator: "-").first.map(String.init) ?? "en"
    }

    /// Languages available for TTS settings: seeded EU set plus every language on the user's books.
    static func languagesForBookCodes(_ codes: [String]) -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for raw in codes + seededLanguageTags {
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            let tag = preferredLanguageTag(trimmed)
            let base = baseLanguage(tag)
            guard seen.insert(base).inserted else { continue }
            ordered.append(base == "pt" ? "pt-pt" : base)
        }
        return ordered.sorted {
            displayName(for: $0).localizedCaseInsensitiveCompare(displayName(for: $1)) == .orderedAscending
        }
    }

    static func displayName(for languageTag: String) -> String {
        let tag = preferredLanguageTag(languageTag)
        let base = baseLanguage(tag)
        if let name = Locale.current.localizedString(forLanguageCode: base), !name.isEmpty {
            return name
        }
        return base.uppercased()
    }

    static func decodeSettings(_ data: Data?) -> [String: SpeechLanguageSetting] {
        guard let data, !data.isEmpty else { return [:] }
        let decoded = (try? JSONDecoder().decode([String: SpeechLanguageSetting].self, from: data)) ?? [:]
        return canonicalizeSettingsKeys(decoded)
    }

    static func encodeSettings(_ settings: [String: SpeechLanguageSetting]) -> Data? {
        try? JSONEncoder().encode(canonicalizeSettingsKeys(settings))
    }
}

/// Process-lifetime cache for the Settings TTS language list.
enum SpeechLanguageListCache {
    private static let lock = NSLock()
    private static var cached: [String]?

    static func peek() -> [String]? {
        lock.lock()
        defer { lock.unlock() }
        return cached
    }

    static func replace(_ languages: [String]) {
        lock.lock()
        cached = languages
        lock.unlock()
    }

    static func invalidate() {
        lock.lock()
        cached = nil
        lock.unlock()
    }
}
