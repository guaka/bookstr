package app.bookstr.speech

import com.google.mediapipe.tasks.audio.texttospeech.TextToSpeech
import com.google.mediapipe.tasks.audio.texttospeech.TextToSpeechOptions
import com.google.mediapipe.tasks.core.BaseOptions
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File

/** Owned by the serial narration executor. Cancellation is checked between bounded phrases. */
internal interface NeuralSpeechEngine : AutoCloseable {
    val sampleRate: Int
    fun generate(text: String): PhraseAudio
}

internal fun createNeuralSpeechEngine(model: SpeechModel, models: SpeechModels): NeuralSpeechEngine {
    val directory = models.directory(model)
    val path = File(directory, model.model).path
    if (model.kind == "pocket") {
        val task = TextToSpeech.create(TextToSpeechOptions(
            baseOptions = BaseOptions.builder().setModelAssetPath(path).build(),
            defaultVoiceId = PocketSpeechModel.voice,
            defaultLocale = "nl-NL",
        ))
        return object : NeuralSpeechEngine {
            override val sampleRate = 24_000
            override fun generate(text: String): PhraseAudio {
                val audio = task.synthesize(text)
                return PhraseAudio(audio.samples, audio.sampleRateHz)
            }
            override fun close() = task.close()
        }
    }
    val config = OfflineTtsModelConfig(numThreads = 4)
    val tokens = File(directory, "tokens.txt").path
    val data = models.pronunciationDirectory(model).path
    if (model.kind == "kokoro") {
        config.kokoro = OfflineTtsKokoroModelConfig(model = path, voices = File(directory, "voices.bin").path, tokens = tokens, dataDir = data, lang = model.engineLanguage.orEmpty())
    } else {
        config.vits = OfflineTtsVitsModelConfig(model = path, tokens = tokens, dataDir = data)
    }
    val task = OfflineTts(config = OfflineTtsConfig(model = config))
    return object : NeuralSpeechEngine {
        override val sampleRate: Int get() = task.sampleRate()
        override fun generate(text: String): PhraseAudio {
            val audio = task.generate(text, model.speaker)
            return PhraseAudio(audio.samples, sampleRate)
        }
        override fun close() = task.release()
    }
}
