import SwiftUI

private enum WordsPaneMode: String, CaseIterable, Identifiable {
    case words
    case marks

    var id: String { rawValue }
    var label: String { self == .words ? "Words" : "Marks" }
}

struct WordsView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var playback: ReaderPlaybackSession
    @State private var mode: WordsPaneMode = .words
    @State private var words: [VocabularyWord] = []
    @State private var marks: [BookSnippet] = []
    @State private var errorMessage: String?
    @State private var openingWordKey: String?
    @State private var query = ""
    @State private var sort = WordSortKey.recent
    @State private var installedMatches: [String: [DictionaryLookup]] = [:]

    var body: some View {
        Group {
            if mode == .words {
                wordsContent
            } else {
                marksContent
            }
        }
        .bookstrScreenTitle("Words")
        .searchable(text: $query, prompt: mode == .words ? "Filter words" : "Filter marks")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("List", selection: $mode) {
                    ForEach(WordsPaneMode.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 220)
                .accessibilityIdentifier("words-marks-mode")
            }
            if mode == .words {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Sort words", selection: $sort) {
                            ForEach(WordSortKey.allCases) { option in
                                Text(option.label).tag(option)
                            }
                        }
                    } label: {
                        Label(sort.shortLabel, systemImage: "arrow.up.arrow.down")
                    }
                }
            }
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
            if mode == .words {
                await backfillDictionary()
                await refreshFromInstalledDictionaries()
                refreshInstalledMatches()
            }
        }
        .onChange(of: mode) { _, newMode in
            showCached()
            if newMode == .marks {
                marks = container.snippetRepository.all()
            }
            Task { await refreshFromNetwork(force: false) }
        }
        .onReceive(container.wordNavigation.$requestToken) { _ in
            guard mode == .words else { return }
            guard let requestedWord = container.wordNavigation.requestedWord else { return }
            guard let target = container.wordNavigation.matchingWord(for: requestedWord, in: words) else {
                errorMessage = "Could not find “\(requestedWord)” in your saved words."
                return
            }
            Task { await openWord(target) }
        }
        .refreshable {
            await refreshFromNetwork(force: true)
            if mode == .words {
                await backfillDictionary()
                await refreshFromInstalledDictionaries()
                refreshInstalledMatches()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .bookstrIdentityDidChange)) { _ in
            showCached()
            Task {
                await refreshFromNetwork(force: true)
                if mode == .words {
                    await backfillDictionary()
                    await refreshFromInstalledDictionaries()
                    refreshInstalledMatches()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .bookstrVocabularyDidChange)) { _ in
            showCached()
            refreshInstalledMatches()
        }
        .onReceive(NotificationCenter.default.publisher(for: .bookstrSnippetsDidChange)) { _ in
            showCached()
        }
        .onReceive(NotificationCenter.default.publisher(for: .bookstrDictionariesDidChange)) { _ in
            Task {
                await refreshFromInstalledDictionaries()
                refreshInstalledMatches()
            }
        }
    }

    @ViewBuilder
    private var wordsContent: some View {
        if words.isEmpty {
            ContentUnavailableView {
                Label("Words", systemImage: "text.book.closed")
            } description: {
                Text(wordsEmptyCopy)
            }
        } else {
            List {
                if visibleWords.isEmpty, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("No words match “\(query)”.")
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                }
                ForEach(visibleWords) { entry in
                    Button { Task { await openWord(entry) } } label: { wordRow(entry) }
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

    @ViewBuilder
    private var marksContent: some View {
        if marks.isEmpty {
            ContentUnavailableView {
                Label("Marks", systemImage: "bookmark")
            } description: {
                Text(marksEmptyCopy)
            }
        } else {
            List {
                if visibleMarks.isEmpty, !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("No marks match “\(query)”.")
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                }
                ForEach(visibleMarks) { entry in
                    Button { Task { await openMark(entry) } } label: { markRow(entry) }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .listRowInsets(EdgeInsets(top: 10, leading: 4, bottom: 10, trailing: 4))
                        .accessibilityIdentifier("mark-row-\(entry.syncId)")
                }
                .onDelete(perform: deleteMarks)
            }
            .listStyle(.plain)
            .listRowSpacing(0)
            .contentMargins(.top, 0, for: .scrollContent)
            .contentMargins(.horizontal, 0, for: .scrollContent)
            .accessibilityIdentifier("marks-list")
        }
    }

    private var wordsEmptyCopy: String {
        "Words you save while reading appear here."
    }

    private var marksEmptyCopy: String {
        "Passages you mark while reading appear here."
    }

    private var visibleWords: [VocabularyWord] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filtered = needle.isEmpty ? words : words.filter { entry in
            entry.word.lowercased().contains(needle)
                || entry.bookTitle.lowercased().contains(needle)
                || entry.contextSentence.lowercased().contains(needle)
                || displayedDefinitions(for: entry).contains { $0.lowercased().contains(needle) }
        }
        return sortVocabularyWords(filtered, by: sort)
    }

    private var visibleMarks: [BookSnippet] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filtered = needle.isEmpty ? marks : marks.filter { entry in
            entry.text.lowercased().contains(needle)
                || entry.bookTitle.lowercased().contains(needle)
                || entry.author.lowercased().contains(needle)
        }
        return filtered.sorted { $0.updatedAt > $1.updatedAt }
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

    private func markRow(_ entry: BookSnippet) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(entry.text)
                .font(.body)
                .lineLimit(4)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(entry.bookTitle) · tap to return")
                .font(.caption)
                .foregroundStyle(container.settingsRepository.theme.primary)
        }
    }

    @MainActor
    private func openWord(_ entry: VocabularyWord) async {
        _ = container.vocabularyRepository.recordSeen(key: entry.key)
        showCached()
        await openBook(id: entry.bookId, title: entry.bookTitle, locator: entry.cfi, openingKey: entry.key)
    }

    @MainActor
    private func openMark(_ entry: BookSnippet) async {
        await openBook(id: entry.bookId, title: entry.bookTitle, locator: entry.locator, openingKey: entry.syncId)
    }

    @MainActor
    private func openBook(id: String, title: String, locator: String, openingKey: String) async {
        guard openingWordKey == nil else { return }
        errorMessage = nil
        var book = container.catalogRepository.rememberedBooks().first { $0.id == id }
        if book == nil, let results = try? await container.catalogRepository.search(title, limit: 20) {
            book = results
                .first(where: { $0.id == id || $0.title.caseInsensitiveCompare(title) == .orderedSame })?
                .asCatalogBook()
        }
        guard let candidate = book else {
            errorMessage = "Could not find a downloadable copy of this book."
            return
        }
        openingWordKey = openingKey
        defer { openingWordKey = nil }
        let openedBook: CatalogBook
        do {
            openedBook = try await container.catalogRepository.prepareForOpening(book: candidate)
        } catch {
            errorMessage = "Book open failed: \(error.localizedDescription)"
            return
        }
        playback.present(book: openedBook, initialLocator: locator, highlightLocator: locator)
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
        marks = container.snippetRepository.all()
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

    private func deleteMarks(at offsets: IndexSet) {
        let displayed = visibleMarks
        let deleted = offsets.compactMap { index in
            displayed.indices.contains(index)
                ? container.snippetRepository.remove(syncId: displayed[index].syncId)
                : nil
        }
        showCached()
        Task {
            for tombstone in deleted {
                if !(await container.nostrSyncService.pushSnippet(tombstone)) {
                    errorMessage = "The mark was removed locally, but its Nostr tombstone could not be published."
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
            _ = try await container.nostrSyncService.pullApplicationData(force: force)
            showCached()
        } catch {
            if (mode == .words && words.isEmpty) || (mode == .marks && marks.isEmpty) {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private extension Optional where Wrapped: Collection {
    var isNilOrEmpty: Bool { self?.isEmpty != false }
}
