import Combine
import Foundation

enum ReaderSpeechState: String, Equatable {
    case idle
    case preparing
    case playing
    case paused
}

enum ReaderSpeechPausePolicy {
    static let expiration: TimeInterval = 300

    static func shouldExpire(pausedAt: Date, now: Date) -> Bool {
        now.timeIntervalSince(pausedAt) >= expiration
    }
}

enum ReaderSpeechRetention {
    static func isRetained(
        speaking: Bool,
        systemSpeaking: Bool,
        systemPaused: Bool,
        neuralPlaying: Bool,
        neuralPaused: Bool,
        pendingRequest: Bool = false,
        preparing: Bool = false
    ) -> Bool {
        speaking || systemSpeaking || systemPaused || neuralPlaying || neuralPaused || pendingRequest || preparing
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

enum ReaderLayoutOrientation: Equatable {
    case portrait
    case landscapeLeft
    case landscapeRight
}

enum ReaderDynamicIslandEdge: Equatable {
    case none
    case top
    case leading
    case trailing
}

/// A single geometry contract for reader chrome. Keeping these values derived
/// from the live safe area prevents rotation from changing the publication's
/// viewport for arbitrary device-specific constants.
struct ReaderChromeMetrics: Equatable {
    static let dynamicIslandInsetThreshold: CGFloat = 51

    let width: CGFloat
    let height: CGFloat
    let safeTop: CGFloat
    let safeLeading: CGFloat
    let safeBottom: CGFloat
    let safeTrailing: CGFloat
    let orientation: ReaderLayoutOrientation

    var dynamicIslandEdge: ReaderDynamicIslandEdge {
        switch orientation {
        case .portrait:
            return safeTop >= Self.dynamicIslandInsetThreshold ? .top : .none
        case .landscapeLeft:
            return max(safeLeading, safeTrailing) >= Self.dynamicIslandInsetThreshold ? .leading : .none
        case .landscapeRight:
            return max(safeLeading, safeTrailing) >= Self.dynamicIslandInsetThreshold ? .trailing : .none
        }
    }

    var headerHeight: CGFloat {
        max(48, safeTop + 44)
    }

    var controlsTopInset: CGFloat { max(safeTop, 0) }
    var contentTopInset: CGFloat { headerHeight }
    var horizontalControlInset: CGFloat { max(6, max(safeLeading, safeTrailing) + 6) }
    var islandTopInset: CGFloat { max(7, safeTop - 51) }
    var clockTopPadding: CGFloat { max(1, islandTopInset - 6) }
    var progressHeight: CGFloat { max(18, safeBottom + 8) }
    var activationZoneHeight: CGFloat { max(58, safeBottom + 52) }

    var bottomCornerRadius: CGFloat {
        let physicalInset = max(safeBottom + 12, max(safeLeading, safeTrailing) * 0.85)
        guard physicalInset > 12 else { return 0 }
        return min(56, max(20, physicalInset))
    }
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
    static let openSpeechSettingsNotification = Notification.Name("bookstrOpenSpeechSettings")

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
        // Keep the last opened book mounted so Continue / Back → reopen skips a
        // cold WKWebView + EPUB decode. Remount when jumping to a highlight.
        if var current = item, current.book.id == book.id, highlightLocator == nil, highlightKind == nil {
            if let preparedURL {
                current.preparedURL = preparedURL
            }
            item = current
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
        // Hide without tearing down so returning to the same book is instant.
        isVisible = false
    }

    func updateSpeechState(retained: Bool, playing: Bool) {
        speechRetained = retained
        isSpeechPlaying = retained && playing
    }

    func toggleSpeech() {
        speechToggleToken += 1
        NotificationCenter.default.post(name: Self.toggleSpeechNotification, object: self)
    }
}
