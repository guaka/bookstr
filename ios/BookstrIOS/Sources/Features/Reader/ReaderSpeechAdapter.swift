import Foundation

/// Presents EPUB speech commands to the reader host.
@MainActor
struct ReaderSpeechAdapter {
    let state: ReaderSpeechState
    let isRetained: Bool
    let isPlaying: Bool
    let toggle: () -> Void
    let restart: () -> Void
    let updateRate: (Double) -> Void
    let stop: () -> Void

    init(epub controller: EPUBReaderController) {
        state = controller.speechState
        isRetained = controller.isSpeechRetained
        isPlaying = controller.isSpeaking
        toggle = { controller.toggleSpeech() }
        restart = { controller.restartSpeechWithCurrentSettings() }
        updateRate = { controller.updateSpeechRate($0) }
        stop = { controller.stopSpeechCompletely() }
    }


}
