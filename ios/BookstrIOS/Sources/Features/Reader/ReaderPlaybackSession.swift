import Combine
import Foundation

enum ReaderSpeechRetention {
    static func isRetained(
        speaking: Bool,
        systemSpeaking: Bool,
        systemPaused: Bool,
        neuralPlaying: Bool,
        neuralPaused: Bool,
        pendingRequest: Bool = false
    ) -> Bool {
        speaking || systemSpeaking || systemPaused || neuralPlaying || neuralPaused || pendingRequest
    }
}

enum ReaderHighlightKind: String, Equatable {
    case word
    case mark
}

final class ReaderPlaybackSession: ObservableObject {
    struct Item: Equatable {
        var book: CatalogBook
        var preparedURL: URL?
        var initialLocator: String?
        var highlightLocator: String?
        var highlightKind: ReaderHighlightKind?
    }

    static let toggleSpeechNotification = Notification.Name("bookstrToggleReaderSpeech")

    @Published private(set) var item: Item?
    @Published private(set) var isVisible = false
    @Published private(set) var speechRetained = false
    @Published private(set) var isSpeechPlaying = false
    @Published private(set) var speechToggleToken = 0
    @Published private(set) var presentationNonce = 0

    var showsBackgroundSpeechControl: Bool {
        item != nil && !isVisible && speechRetained
    }

    func present(
        book: CatalogBook,
        preparedURL: URL? = nil,
        initialLocator: String? = nil,
        highlightLocator: String? = nil,
        highlightKind: ReaderHighlightKind? = nil
    ) {
        if item?.book.id == book.id, speechRetained {
            isVisible = true
            return
        }
        let next = Item(
            book: book,
            preparedURL: preparedURL,
            initialLocator: initialLocator,
            highlightLocator: highlightLocator,
            highlightKind: highlightKind
        )
        if item != next {
            presentationNonce += 1
            speechRetained = false
            isSpeechPlaying = false
        }
        item = next
        isVisible = true
    }

    func requestClose() {
        if speechRetained {
            isVisible = false
            return
        }
        clear()
    }

    func updateSpeechState(retained: Bool, playing: Bool) {
        speechRetained = retained
        isSpeechPlaying = retained && playing
        if !retained && !isVisible {
            clear()
        }
    }

    func toggleSpeech() {
        speechToggleToken += 1
        NotificationCenter.default.post(name: Self.toggleSpeechNotification, object: self)
    }

    private func clear() {
        item = nil
        isVisible = false
        speechRetained = false
        isSpeechPlaying = false
    }
}
