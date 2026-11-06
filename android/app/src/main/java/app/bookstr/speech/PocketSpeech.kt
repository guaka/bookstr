package app.bookstr.speech

import java.io.File

/** Pinned Dutch Daan LiteRT bundle metadata for the Pocket TTS draft. */
object PocketSpeechModel {
    const val language = "nl"
    const val voice = "daan"
    const val label = "Pocket TTS · Daan"
    const val repository = "litert-community/pocket-tts"
    const val revision = "03f949ec418ccd4d153008f7ef9c58c754cc0616"
    const val bundleFile = "pocket_tts_nl_int8.litertlm"
    const val resolvedUrl = "https://huggingface.co/litert-community/pocket-tts/resolve/03f949ec418ccd4d153008f7ef9c58c754cc0616/pocket_tts_nl_int8.litertlm"
    const val bundleBytes = 125_247_496L
    const val sha256 = "e38af0d6b726c550548b0126c5563245d9ac563c6669b66af924a2b545b51387"
    const val license = "CC BY 4.0"
}

/** PCM returned by a Pocket runtime. Samples are normalized floating point audio. */
data class PocketSpeechAudio(val samples: FloatArray, val sampleRate: Int)

/**
 * Adapter seam for a future LiteRT integration. Keep native/runtime dependencies behind this
 * interface so the draft can be developed and tested without guessing their Android API. Tests
 * use fake implementations; this draft does not provide a LiteRT runtime.
 */
fun interface PocketSpeechRuntime {
    fun render(modelBundle: File, text: String, cancelled: () -> Boolean): PocketSpeechAudio
}

/** Small cancellation and result-validation boundary around an injected runtime. */
class PocketSpeech(private val runtime: PocketSpeechRuntime) {
    fun synthesize(modelBundle: File, text: String, cancelled: () -> Boolean): PocketSpeechAudio? {
        if (cancelled()) return null
        require(text.isNotBlank()) { "Text must not be blank" }
        val audio = runtime.render(modelBundle, text, cancelled)
        if (cancelled()) return null
        require(audio.sampleRate > 0) { "Sample rate must be positive" }
        require(audio.samples.isNotEmpty()) { "Voice could not generate audio" }
        return audio
    }
}
