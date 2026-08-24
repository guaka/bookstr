import SwiftUI

struct WordsView: View {
    @EnvironmentObject private var container: AppContainer
    @State private var words: [VocabularyWord] = []
    @State private var errorMessage: String?
    @State private var destination: WordDestination?
    @State private var openingWordKey: String?
    @State private var query = ""
    @State private var sort = WordSort.recent
    @State private var installedMatches: [String: [DictionaryLookup]] = [:]

    var body: some View {
        Group {
            if words.isEmpty {
                ContentUnavailableView {
                    Label("Words", systemImage: "text.book.closed")
                } description: {
                    Text(emptyCopy)
                }
            } else {
                List {
                    if visibleWords.isEmpty, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("No words match “\(query)”.")
                            .foregroundStyle(.secondary)
                            .listRowSeparator(.hidden)
                    }
                    ForEach(visibleWords) { entry in
                        Button { Task { await open(entry) } } label: { wordRow(entry) }
                            .buttonStyle(.plain)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .listRowInsets(EdgeInsets(top: 10, leading: 4, bottom: 10, trailing: 4))
                            .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
                            .alignmentGuide(.listRowSeparatorTrailing) { $0[.trailing] }
                    }
                    .onDelete(perform: deleteWords)
                }
                .listStyle(.plain)
                .listRowSpacing(0)
                .contentMargins(.top, 0, for: .scrollContent)
                .contentMargins(.horizontal, 0, for: .scrollContent)
            }
        }
        .bookstrScreenTitle("Words")
        .searchable(text: $query, prompt: "Filter words")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort words", selection: $sort) {
                        ForEach(WordSort.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                } label: {
                    Label(sort.shortLabel, systemImage: "arrow.up.arrow.down")
                }
            }
        }
        .navigationDestination(item: $destination) { item in
            ReaderHostView(book: item.book, initialLocator: item.locator, highlightLocator: item.locator)
                .id("\(item.book.id):\(item.locator)")
        }
        .overlay(alignment: .bottom) {
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding()
            }
        }
        .overlay {
            if openingWordKey != nil {
                ProgressView("Downloading book…")
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .task {
            showCached()
            await refreshFromNetwork(force: false)
            await backfillDictionary()
            await refreshFromInstalledDictionaries()
            refreshInstalledMatches()
        }
        .onReceive(container.wordNavigation.$requestToken) { _ in
            guard let requestedWord = container.wordNavigation.requestedWord else { return }
            guard let target = container.wordNavigation.matchingWord(for: requestedWord, in: words) else {
                errorMessage = "Could not find “\(requestedWord)” in your saved words."
                return
            }
            Task { await open(target) }
        }
        .refreshable {
            await refreshFromNetwork(force: true)
            await backfillDictionary()
            await refreshFromInstalledDictionaries()
            refreshInstalledMatches()
        }
        .onReceive(NotificationCenter.default.publisher(for: .bookstrIdentityDidChange)) { _ in
            showCached()
            Task {
                await refreshFromNetwork(force: true)
                await backfillDictionary()
                await refreshFromInstalledDictionaries()
                refreshInstalledMatches()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .bookstrVocabularyDidChange)) { _ in
            showCached()
            refreshInstalledMatches()
        }
        .onReceive(NotificationCenter.default.publisher(for: .bookstrDictionariesDidChange)) { _ in
            Task {
                await refreshFromInstalledDictionaries()
                refreshInstalledMatches()
            }
        }
    }

    private var emptyCopy: String {
        container.settingsRepository.hasNostrIdentity
            ? "Words you look up while reading will appear here."
            : "Connect Nostr in Settings to sync saved words."
    }

    private var visibleWords: [VocabularyWord] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filtered = needle.isEmpty ? words : words.filter { entry in
            entry.word.lowercased().contains(needle)
                || entry.bookTitle.lowercased().contains(needle)
                || entry.contextSentence.lowercased().contains(needle)
                || displayedDefinitions(for: entry).contains { $0.lowercased().contains(needle) }
        }
        switch sort {
        case .recent:
            return filtered.sorted { $0.lastSeenAt > $1.lastSeenAt }
        case .alphabetical:
            return filtered.sorted { $0.word.localizedCaseInsensitiveCompare($1.word) == .orderedAscending }
        case .book:
            return filtered.sorted {
                let books = $0.bookTitle.localizedCaseInsensitiveCompare($1.bookTitle)
                return books == .orderedSame
                    ? $0.word.localizedCaseInsensitiveCompare($1.word) == .orderedAscending
                    : books == .orderedAscending
            }
        case .mostSeen:
            return filtered.sorted { $0.lookupCount > $1.lookupCount }
        case .firstSaved:
            return filtered.sorted { $0.firstSeenAt < $1.firstSeenAt }
        }
    }

    private func wordRow(_ entry: VocabularyWord) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(entry.word).font(.headline)
                if installedMatches[entry.key].isNilOrEmpty, !entry.partOfSpeech.isEmpty {
                    Text(entry.partOfSpeech)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let translation = entry.translation, !translation.isEmpty {
                Text("English: \(translation)")
                    .font(.subheadline)
            }
            if let matches = installedMatches[entry.key], !matches.isEmpty {
                ForEach(Array(matches.enumerated()), id: \.offset) { _, match in
                    VStack(alignment: .leading, spacing: 3) {
                        if !match.partOfSpeech.isEmpty {
                            Text(match.partOfSpeech)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                        ForEach(Array(match.definitions.enumerated()), id: \.offset) { _, definition in
                            Text(definition)
                                .font(.footnote)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.top, 2)
                }
            } else if !entry.definitions.isEmpty {
                ForEach(Array(entry.definitions.enumerated()), id: \.offset) { _, definition in
                    Text(definition)
                        .font(.footnote)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Text("No definition found")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if !entry.contextSentence.isEmpty {
                Text(highlightedContext(entry.contextSentence, word: entry.word))
                    .foregroundStyle(.secondary)
            }
            Text("\(entry.bookTitle) · tap to return")
                .font(.caption)
                .foregroundStyle(container.settingsRepository.theme.primary)
        }
    }

    @MainActor
    private func open(_ entry: VocabularyWord) async {
        guard openingWordKey == nil else { return }
        errorMessage = nil
        var book = container.catalogRepository.rememberedBooks().first { $0.id == entry.bookId }
        if book == nil, let results = try? await container.catalogRepository.search(entry.bookTitle, limit: 20) {
            book = results
                .first(where: { $0.id == entry.bookId || $0.title.caseInsensitiveCompare(entry.bookTitle) == .orderedSame })?
                .asCatalogBook()
        }
        guard let candidate = book else {
            errorMessage = "Could not find a downloadable copy of this book."
            return
        }
        openingWordKey = entry.key
        defer { openingWordKey = nil }
        let openedBook: CatalogBook
        do {
            openedBook = try await container.catalogRepository.prepareForOpening(book: candidate)
        } catch {
            errorMessage = "Book open failed: \(error.localizedDescription)"
            return
        }
        destination = WordDestination(book: openedBook, locator: entry.cfi)
    }

    private func highlightedContext(_ context: String, word: String) -> AttributedString {
        var result = AttributedString("“")
        var remaining = context[...]
        while !word.isEmpty, let match = remaining.range(of: word, options: [.caseInsensitive, .diacriticInsensitive]) {
            result += AttributedString(String(remaining[..<match.lowerBound]))
            var marked = AttributedString(String(remaining[match]))
            marked.backgroundColor = .bookstrHighlightGold
            marked.foregroundColor = Color(red: 28 / 255, green: 25 / 255, blue: 22 / 255)
            marked.font = .caption.bold()
            result += marked
            remaining = remaining[match.upperBound...]
        }
        result += AttributedString(String(remaining))
        result += AttributedString("”")
        result.font = .caption.italic()
        return result
    }

    private func showCached() {
        words = container.vocabularyRepository.all()
    }

    private func displayedDefinitions(for entry: VocabularyWord) -> [String] {
        let installed = installedMatches[entry.key]?.flatMap(\.definitions) ?? []
        return installed.isEmpty ? entry.definitions : installed
    }

    private func refreshInstalledMatches() {
        installedMatches = Dictionary(uniqueKeysWithValues: words.compactMap { entry in
            let matches = container.dictionaryRepository.lookupAllInstalled(word: entry.word)
            return matches.isEmpty ? nil : (entry.key, matches)
        })
    }

    private func deleteWords(at offsets: IndexSet) {
        let displayed = visibleWords
        let deleted = offsets.compactMap { index in
            displayed.indices.contains(index)
                ? container.vocabularyRepository.remove(key: displayed[index].key)
                : nil
        }
        if deleted.contains(where: { shouldClearWordFilter(query, deletedWord: $0.word) }) {
            query = ""
        }
        showCached()
        refreshInstalledMatches()
        Task {
            for tombstone in deleted {
                if !(await container.nostrSyncService.pushVocabularyWord(tombstone)) {
                    errorMessage = "The word was removed locally, but its Nostr tombstone could not be published."
                }
            }
        }
    }

    private func needsDictionary(_ word: VocabularyWord) -> Bool {
        let portuguese = word.language.lowercased().hasPrefix("pt")
            || container.dictionaryRepository.languageFor(context: word.contextSentence) == "pt"
        if container.dictionaryRepository.needsLemmaFollow(definitions: word.definitions, word: word.word) {
            return true
        }
        return word.definitions.isEmpty || (portuguese && (word.translation ?? "").isEmpty)
    }

    private func backfillDictionary() async {
        let missing = container.vocabularyRepository.all().filter(needsDictionary)
        guard !missing.isEmpty else { return }
        for word in missing {
            guard let result = try? await container.dictionaryRepository.lookup(
                word: word.word,
                language: word.language,
                context: word.contextSentence
            ) else { continue }
            container.vocabularyRepository.saveDefinition(
                key: word.key,
                partOfSpeech: result.partOfSpeech,
                definitions: result.definitions,
                translation: result.translation,
                sourceUrl: result.sourceUrl
            )
        }
        showCached()
    }

    private func refreshFromInstalledDictionaries() async {
        let candidates = container.vocabularyRepository.all().filter { word in
            let language = word.language.isEmpty
                ? container.dictionaryRepository.languageFor(context: word.contextSentence)
                : word.language
            return container.dictionaryRepository.hasInstalledPack(for: language)
        }
        for word in candidates {
            guard let result = try? await container.dictionaryRepository.lookup(
                word: word.word,
                language: word.language,
                context: word.contextSentence
            ) else { continue }
            container.vocabularyRepository.saveDefinition(
                key: word.key,
                partOfSpeech: result.partOfSpeech,
                definitions: result.definitions,
                translation: result.translation,
                sourceUrl: result.sourceUrl
            )
        }
        showCached()
    }

    private func refreshFromNetwork(force: Bool) async {
        errorMessage = nil
        guard container.settingsRepository.hasNostrIdentity else { return }
        do {
            _ = try await container.nostrSyncService.pullVocabulary(force: force)
            showCached()
        } catch {
            if words.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

func shouldClearWordFilter(_ query: String, deletedWord: String) -> Bool {
    query.trimmingCharacters(in: .whitespacesAndNewlines)
        .localizedCaseInsensitiveCompare(deletedWord.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame
}

private enum WordSort: String, CaseIterable, Identifiable {
    case recent
    case alphabetical
    case book
    case mostSeen
    case firstSaved

    var id: String { rawValue }

    var label: String {
        switch self {
        case .recent: "Recently seen"
        case .alphabetical: "Alphabetical (A–Z)"
        case .book: "Book, then word"
        case .mostSeen: "Most frequently seen"
        case .firstSaved: "First saved"
        }
    }

    var shortLabel: String {
        switch self {
        case .recent: "Recent"
        case .alphabetical: "A–Z"
        case .book: "Book"
        case .mostSeen: "Count"
        case .firstSaved: "First"
        }
    }
}

private extension Optional where Wrapped: Collection {
    var isNilOrEmpty: Bool { self?.isEmpty != false }
}

private struct WordDestination: Identifiable, Hashable {
    let book: CatalogBook
    let locator: String
    var id: String { "\(book.id):\(locator)" }
}
