import Combine
import Foundation

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

/// Geometry contract shared by the app shell and reader chrome. Keeping these
/// values separate from playback state prevents rotation concerns from leaking
/// into the reader lifecycle model.
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
        dynamicIslandEdge == .top ? max(48, safeTop) : max(48, safeTop + 44)
    }
    var controlsTopInset: CGFloat { max(safeTop, 0) }
    var contentTopInset: CGFloat { headerHeight }
    var horizontalControlInset: CGFloat { max(6, max(safeLeading, safeTrailing) + 6) }
    var islandTopInset: CGFloat { max(7, safeTop - 51) }
    var clockTopPadding: CGFloat { max(0, islandTopInset - 8) }
    var progressHeight: CGFloat { max(18, safeBottom + 8) }
    var activationZoneHeight: CGFloat { max(58, safeBottom + 52) }

    var bottomCornerRadius: CGFloat {
        let physicalInset = max(safeBottom + 12, max(safeLeading, safeTrailing) * 0.85)
        guard physicalInset > 12 else { return 0 }
        return min(56, max(20, physicalInset))
    }
}

@MainActor
final class ReaderChromeVisibilityController: ObservableObject {
    @Published private(set) var isButtonIslandVisible = false
    private var dismissalTask: Task<Void, Never>?
    private let dismissalDelay: Duration

    init(dismissalDelay: Duration = .seconds(4)) {
        self.dismissalDelay = dismissalDelay
    }

    func reveal() {
        isButtonIslandVisible = true
        scheduleDismissal()
    }

    func hide() {
        dismissalTask?.cancel()
        dismissalTask = nil
        isButtonIslandVisible = false
    }

    func scheduleDismissal() {
        dismissalTask?.cancel()
        dismissalTask = Task { [weak self, dismissalDelay] in
            try? await Task.sleep(for: dismissalDelay)
            guard !Task.isCancelled else { return }
            self?.isButtonIslandVisible = false
        }
    }

    func cancel() {
        dismissalTask?.cancel()
        dismissalTask = nil
    }

    deinit {
        dismissalTask?.cancel()
    }
}
