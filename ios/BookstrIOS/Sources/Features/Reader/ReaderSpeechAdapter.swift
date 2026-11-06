import Foundation

/// Presents EPUB and FB2 speech controllers to the host through one small,
/// format-neutral command surface without hiding their format-specific work.
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

    init(fb2 controller: FB2ReaderController, playback: SpeechPlaybackChoice) {
        state = controller.speechState
        isRetained = controller.isSpeechRetained
        isPlaying = controller.isSpeaking
        toggle = { controller.toggleSpeech(playback: playback) }
        restart = { controller.restartSpeech(playback: playback) }
        updateRate = { controller.updateSpeechRate($0) }
        stop = { controller.stopSpeechCompletely() }
    }
}
