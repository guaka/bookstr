import Foundation

/// Result-driven language/format filters for Library and Search, matching the
/// web Home/Search selects: empty string means "all", options come from the
/// current list, and a stale selection falls back to all.
struct BookListFacetFilters: Equatable, Sendable {
    var language: String = ""
    var format: String = ""

    var isActive: Bool { !language.isEmpty || !format.isEmpty }

    static func normalizedLanguage(_ value: String?) -> String {
        let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty else { return "" }
        // Fold catalog names ("English") and regional tags ("pt-BR") to a base ISO code.
        return SpeechLanguageSettings.baseLanguage(raw)
    }

    static func normalizedFormat(_ value: String?) -> String {
        var raw = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if raw.hasPrefix(".") { raw.removeFirst() }
        if raw == "fb2.zip" { return "fb2" }
        return raw
    }

    func matches(language: String?, format: String?) -> Bool {
        let lang = Self.normalizedLanguage(language)
        let fmt = Self.normalizedFormat(format)
        if !self.language.isEmpty, self.language != lang { return false }
        if !self.format.isEmpty, self.format != fmt { return false }
        return true
    }

    static func languages(from values: [String?]) -> [String] {
        Array(Set(values.map(normalizedLanguage).filter { !$0.isEmpty })).sorted()
    }

    static func formats(from values: [String?]) -> [String] {
        Array(Set(values.map(normalizedFormat).filter { !$0.isEmpty })).sorted()
    }

    static func hasLanguageChoices(_ values: [String?]) -> Bool {
        Set(values.map(normalizedLanguage)).count > 1
    }

    static func hasFormatChoices(_ values: [String?]) -> Bool {
        Set(values.map(normalizedFormat)).count > 1
    }

    mutating func sanitize(languages: [String], formats: [String]) {
        if !language.isEmpty, !languages.contains(language) { language = "" }
        if !format.isEmpty, !formats.contains(format) { format = "" }
    }

    /// Compact label for list rows and filter menus: `EN`, `FR`, `EPUB`, …
    static func displayLabel(for value: String) -> String {
        let format = normalizedFormat(value)
        if ["epub", "pdf", "fb2", "cbr", "cbz"].contains(format) {
            return format.uppercased()
        }
        let base = normalizedLanguage(value)
        return base.isEmpty ? value.uppercased() : base.uppercased()
    }

    static func languageBadge(_ value: String?) -> String? {
        let base = normalizedLanguage(value)
        return base.isEmpty ? nil : base.uppercased()
    }
}
