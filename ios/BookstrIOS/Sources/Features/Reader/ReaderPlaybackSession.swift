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

enum ReaderPresentationOrigin: Equatable {
    case user
    case continuation
}

enum ReaderContinuationSelection {
    static func preferredLocalProgress(
        than session: ReaderSession?,
        progress: [BookProgress],
        availableBookIDs: Set<String>,
        launchWriteRecoveryWindow: Int64 = 60_000
    ) -> BookProgress? {
        let available = Set(availableBookIDs.map { $0.lowercased() })
        let local = progress
            .filter { available.contains($0.bookId.lowercased()) }
            .sorted { $0.updatedAt > $1.updatedAt }
        guard let recent = local.first else { return nil }
        guard let session else { return recent }
        guard let sessionUpdatedAt = session.updatedAt else { return recent }
        if recent.updatedAt > sessionUpdatedAt { return recent }

        // Older builds restored an EPUB and immediately rewrote its session and
        // progress, making that automatic launch look newer than the comic the
        // user had actually opened. Recover the interrupted book once; future
        // launches use the explicit reader selection stored by the new build.
        let isLaunchWrite = recent.bookId.caseInsensitiveCompare(session.bookId) == .orderedSame
            && abs(recent.updatedAt - sessionUpdatedAt) <= 2_000
        guard isLaunchWrite,
              let interrupted = local.first(where: {
                  $0.bookId.caseInsensitiveCompare(session.bookId) != .orderedSame
              }),
              interrupted.updatedAt <= sessionUpdatedAt,
              sessionUpdatedAt - interrupted.updatedAt <= launchWriteRecoveryWindow else { return nil }
        return interrupted
    }
}

final class ReaderPlaybackSession: ObservableObject {
    struct Item: Equatable {
        var book: CatalogBook
        var preparedURL: URL?
        var initialLocator: String?
        var highlightLocator: String?
        var highlightKind: ReaderHighlightKind?
        var origin: ReaderPresentationOrigin
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
        highlightKind: ReaderHighlightKind? = nil,
        origin: ReaderPresentationOrigin = .user
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
            highlightKind: highlightKind,
            origin: origin
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
