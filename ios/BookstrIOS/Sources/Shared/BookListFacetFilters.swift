import Foundation

/// Result-driven language/format filters for Library and Search, matching the
/// web Home/Search selects: empty string means "all", options come from the
/// current list, and a stale selection falls back to all.
struct BookListFacetFilters: Equatable, Sendable {
    var language: String = ""
    var format: String = ""

    var isActive: Bool { !language.isEmpty || !format.isEmpty }

    static func normalizedLanguage(_ value: String?) -> String {
        let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        guard !raw.isEmpty else { return "" }
        // Compare on the base tag so "pt", "pt-pt", and "pt-BR" share one facet.
        return raw.split(separator: "-").first.map(String.init) ?? raw
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

    mutating func sanitize(languages: [String], formats: [String]) {
        if !language.isEmpty, !languages.contains(language) { language = "" }
        if !format.isEmpty, !formats.contains(format) { format = "" }
    }

    static func displayLabel(for value: String) -> String {
        let format = normalizedFormat(value)
        if ["epub", "pdf", "fb2", "cbr", "cbz"].contains(format) {
            return format.uppercased()
        }
        let base = normalizedLanguage(value)
        if let name = Locale.current.localizedString(forLanguageCode: base), !name.isEmpty {
            return name
        }
        return value.uppercased()
    }
}
