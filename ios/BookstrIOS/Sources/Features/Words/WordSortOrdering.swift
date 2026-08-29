import Foundation

enum WordSortKey: String, CaseIterable, Identifiable {
    case recent
    case recentlyAdded
    case alphabetical
    case book
    case mostSeen
    case firstSaved

    var id: String { rawValue }

    var label: String {
        switch self {
        case .recent: "Recently seen"
        case .recentlyAdded: "Recently added"
        case .alphabetical: "Alphabetical (A–Z)"
        case .book: "Book, then word"
        case .mostSeen: "Most frequently seen"
        case .firstSaved: "First saved"
        }
    }

    var shortLabel: String {
        switch self {
        case .recent: "Recent"
        case .recentlyAdded: "Added"
        case .alphabetical: "A–Z"
        case .book: "Book"
        case .mostSeen: "Count"
        case .firstSaved: "First"
        }
    }
}

func sortVocabularyWords(_ words: [VocabularyWord], by sort: WordSortKey) -> [VocabularyWord] {
    switch sort {
    case .recent:
        return words.sorted { $0.lastSeenAt > $1.lastSeenAt }
    case .recentlyAdded:
        return words.sorted { $0.firstSeenAt > $1.firstSeenAt }
    case .alphabetical:
        return words.sorted { $0.word.localizedCaseInsensitiveCompare($1.word) == .orderedAscending }
    case .book:
        return words.sorted {
            let books = $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle)
            return books == .orderedSame
                ? $0.word.localizedCaseInsensitiveCompare($1.word) == .orderedAscending
                : books == .orderedAscending
        }
    case .mostSeen:
        return words.sorted { $0.lookupCount > $1.lookupCount }
    case .firstSaved:
        return words.sorted { $0.firstSeenAt < $1.firstSeenAt }
    }
}
