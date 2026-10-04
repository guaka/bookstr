package app.bookstr.speech

import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File
import java.io.RandomAccessFile

/** Access only on the narration synthesis executor, including close(). */
class NeuralSpeech(private val models: SpeechModels) {
    private var loaded: String? = null
    private var engine: OfflineTts? = null

    fun synthesize(model: SpeechModel, text: String, file: File, cancelled: () -> Boolean) {
        val synthesizer = synthesizer(model)
        // Bound each native call (Kokoro has a hard phoneme limit) and stream PCM to disk.
        RandomAccessFile(file, "rw").use { output ->
            output.setLength(0)
            output.write(ByteArray(44))
            for (phrase in phrases(text)) {
                if (cancelled()) return
                val audio = synthesizer.generate(phrase, model.speaker)
                check(audio.samples.isNotEmpty()) { "Voice could not generate audio" }
                val pcm = java.nio.ByteBuffer.allocate(audio.samples.size * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                for (sample in audio.samples) pcm.putShort((sample.coerceIn(-1f, 1f) * 32767).toInt().toShort())
                output.write(pcm.array())
            }
            if (output.length() == 44L) output.write(ByteArray(16))
            val size = (output.length() - 44).toInt()
            output.seek(0)
            output.writeBytes("RIFF"); output.writeInt(Integer.reverseBytes(size + 36)); output.writeBytes("WAVEfmt ")
            output.writeInt(Integer.reverseBytes(16)); output.writeShort(256); output.writeShort(256)
            val rate = synthesizer.sampleRate()
            output.writeInt(Integer.reverseBytes(rate)); output.writeInt(Integer.reverseBytes(rate * 2))
            output.writeShort(512); output.writeShort(4096); output.writeBytes("data"); output.writeInt(Integer.reverseBytes(size))
        }
    }

    /** Generate independently playable phrase WAVs as soon as each native render completes. */
    fun synthesizePhrases(
        model: SpeechModel,
        text: String,
        directory: File,
        fileStem: String,
        cancelled: () -> Boolean,
        onPhraseReady: (index: Int, spokenPhrase: String, file: File) -> Unit,
    ) {
        val synthesizer = synthesizer(model)
        emitPhrases(
            text = text,
            directory = directory,
            fileStem = fileStem,
            cancelled = cancelled,
            render = { phrase ->
                val audio = synthesizer.generate(phrase, model.speaker)
                check(audio.samples.isNotEmpty()) { "Voice could not generate audio" }
                PhraseAudio(audio.samples, synthesizer.sampleRate())
            },
            onPhraseReady = onPhraseReady,
        )
    }

    private fun synthesizer(model: SpeechModel): OfflineTts {
        check(models.installed(model)) { "Download this voice in Settings first" }
        if (loaded != model.id) {
            close()
            val directory = models.directory(model)
            val config = OfflineTtsModelConfig(numThreads = 4)
            val tokens = File(directory, "tokens.txt").path
            val data = models.pronunciationDirectory(model).path
            val path = File(directory, model.model).path
            if (model.kind == "kokoro") {
                config.kokoro = OfflineTtsKokoroModelConfig(model = path, voices = File(directory, "voices.bin").path, tokens = tokens, dataDir = data, lang = model.engineLanguage.orEmpty())
            } else {
                config.vits = OfflineTtsVitsModelConfig(model = path, tokens = tokens, dataDir = data)
            }
            engine = OfflineTts(config = OfflineTtsConfig(model = config))
            loaded = model.id
        }
        return checkNotNull(engine)
    }

    fun close() { engine?.release(); engine = null; loaded = null }

    companion object {
        fun phrases(text: String): List<String> {
            val result = mutableListOf<String>()
            var remaining = text.trim()
            while (remaining.isNotEmpty()) {
                // The next sentence is rendered on the same executor as the current one.
                // A short first phrase lets playback resume before its longer tail is ready.
                val limit = if (result.isEmpty()) 70 else 140
                val window = remaining.take(limit)
                val end = if (remaining.length > limit) window.indexOfLast { it.isWhitespace() || it in ".!?;:," }.takeIf { it >= 0 }?.plus(1) ?: limit else remaining.length
                val phrase = remaining.take(end).trim()
                if (phrase.any { it.isLetterOrDigit() }) result += phrase
                remaining = remaining.drop(end).trimStart()
            }
            return result
        }

        internal fun emitPhrases(
            text: String,
            directory: File,
            fileStem: String,
            cancelled: () -> Boolean,
            render: (String) -> PhraseAudio,
            onPhraseReady: (index: Int, spokenPhrase: String, file: File) -> Unit,
        ) {
            directory.mkdirs()
            for ((index, phrase) in phrases(text).withIndex()) {
                if (cancelled()) return
                val file = File(directory, "$fileStem-$index.wav")
                try {
                    val audio = render(phrase)
                    if (cancelled()) {
                        file.delete()
                        return
                    }
                    PhraseWaveFile.write(file, audio.samples, audio.sampleRate)
                    onPhraseReady(index, phrase, file)
                } catch (failure: Throwable) {
                    file.delete()
                    throw failure
                }
            }
        }
    }
}

internal data class PhraseAudio(val samples: FloatArray, val sampleRate: Int)

internal object PhraseWaveFile {
    fun write(file: File, samples: FloatArray, sampleRate: Int) {
        val pcm = java.nio.ByteBuffer.allocate(samples.size * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        for (sample in samples) pcm.putShort((sample.coerceIn(-1f, 1f) * 32767).toInt().toShort())
        val dataSize = pcm.position()
        RandomAccessFile(file, "rw").use { output ->
            output.setLength(0)
            output.writeBytes("RIFF"); output.writeInt(Integer.reverseBytes(dataSize + 36)); output.writeBytes("WAVEfmt ")
            output.writeInt(Integer.reverseBytes(16)); output.writeShort(256); output.writeShort(256)
            output.writeInt(Integer.reverseBytes(sampleRate)); output.writeInt(Integer.reverseBytes(sampleRate * 2))
            output.writeShort(512); output.writeShort(4096); output.writeBytes("data"); output.writeInt(Integer.reverseBytes(dataSize))
            output.write(pcm.array())
        }
    }
}
