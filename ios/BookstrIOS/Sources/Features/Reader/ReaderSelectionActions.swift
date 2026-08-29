import Foundation

enum ReaderSelectionKind: Equatable {
    case empty
    case words(String)
    case mark
}

enum ReaderSelectionActions {
    private static let wordToken = #"^\p{L}+(?:['’\-]\p{L}+)*$"#

    static func normalizedText(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func kind(for selection: String) -> ReaderSelectionKind {
        let text = normalizedText(selection)
        guard !text.isEmpty else { return .empty }
        let tokens = text.split(separator: " ").map(String.init)
        guard tokens.count <= 2 else { return .mark }
        guard tokens.allSatisfy(isWordToken) else { return .mark }
        return .words(text)
    }

    static func phraseForVocabulary(from selection: String) -> String? {
        if case let .words(phrase) = kind(for: selection) { return phrase }
        return nil
    }

    static func offersMark(for selection: String) -> Bool {
        kind(for: selection) == .mark
    }

    private static func isWordToken(_ token: String) -> Bool {
        token.range(of: wordToken, options: .regularExpression) != nil
    }
}
