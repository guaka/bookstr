import Foundation
import Combine

struct SavedHighlightRequest: Equatable {
    let kind: ReaderHighlightKind
    let locator: String
    let text: String
}

final class WordNavigationState: ObservableObject {
    @Published private(set) var requestedWord: String?
    @Published private(set) var requestedHighlight: SavedHighlightRequest?
    @Published private(set) var requestToken: Int = 0

    func request(word: String) {
        let normalized = word.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }
        requestedWord = normalized
        requestedHighlight = SavedHighlightRequest(kind: .word, locator: "", text: normalized)
        requestToken += 1
    }

    func request(kind: ReaderHighlightKind, locator: String, text: String = "") {
        let normalizedLocator = locator.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedLocator.isEmpty || !normalizedText.isEmpty else { return }
        requestedWord = kind == .word && !normalizedText.isEmpty ? normalizedText : nil
        requestedHighlight = SavedHighlightRequest(
            kind: kind,
            locator: normalizedLocator,
            text: normalizedText
        )
        requestToken += 1
    }

    func matchingWord(for request: SavedHighlightRequest, in words: [VocabularyWord]) -> VocabularyWord? {
        let locator = request.locator.trimmingCharacters(in: .whitespacesAndNewlines)
        if !locator.isEmpty, let exact = words.first(where: { $0.cfi == locator }) { return exact }
        return matchingWord(for: request.text, in: words)
    }

    func matchingWord(for query: String, in words: [VocabularyWord]) -> VocabularyWord? {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return nil }
        return words.first(where: { $0.word.caseInsensitiveCompare(needle) == .orderedSame })
    }

    func matchingMark(for request: SavedHighlightRequest, in marks: [BookSnippet]) -> BookSnippet? {
        let locator = request.locator.trimmingCharacters(in: .whitespacesAndNewlines)
        if !locator.isEmpty, let exact = marks.first(where: { $0.locator == locator }) { return exact }
        let text = request.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return marks.first(where: { $0.text.caseInsensitiveCompare(text) == .orderedSame })
    }
}
