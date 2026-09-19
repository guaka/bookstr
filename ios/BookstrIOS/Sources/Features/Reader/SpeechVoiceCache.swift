import AVFoundation
import Foundation

/// Process-lifetime cache for Apple TTS voices (listing is expensive on iOS).
enum SpeechVoiceCache {
    private static let lock = NSLock()
    private static var cachedVoices: [AVSpeechSynthesisVoice]?

    static func allVoices() -> [AVSpeechSynthesisVoice] {
        lock.lock()
        defer { lock.unlock() }
        if let cachedVoices { return cachedVoices }
        let voices = AVSpeechSynthesisVoice.speechVoices()
        cachedVoices = voices
        return voices
    }

    static func voices(for language: String) -> [AVSpeechSynthesisVoice] {
        let base = SpeechLanguageSettings.baseLanguage(language)
        return allVoices()
            .filter { SpeechLanguageSettings.baseLanguage($0.language) == base }
            .sorted {
                if $0.quality != $1.quality { return $0.quality.rawValue > $1.quality.rawValue }
                return $0.name < $1.name
            }
    }

    static func warm() {
        _ = allVoices()
    }

    /// Test hook to clear the cache between cases.
    static func resetForTesting() {
        lock.lock()
        cachedVoices = nil
        lock.unlock()
    }
}
