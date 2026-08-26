import Foundation

func shouldClearWordFilter(_ query: String, deletedWord: String) -> Bool {
    query.trimmingCharacters(in: .whitespacesAndNewlines)
        .localizedCaseInsensitiveCompare(deletedWord.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame
}
