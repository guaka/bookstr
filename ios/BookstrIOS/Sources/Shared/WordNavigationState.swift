import Foundation

final class WordNavigationState: ObservableObject {
    @Published private(set) var requestedWord: String?
    @Published private(set) var requestToken: Int = 0

    func request(word: String) {
        let normalized = word.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }
        requestedWord = normalized
        requestToken += 1
    }

    func matchingWord(for query: String, in words: [VocabularyWord]) -> VocabularyWord? {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return nil }
        return words.first(where: { $0.word.lowercased() == needle })
    }
}

