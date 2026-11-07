package app.bookstr.speech

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.Charset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class NeuralSpeechWaveTest {
    @get:Rule val temporary = TemporaryFolder()

    private class FakeEngine(
        private val audio: (String) -> PhraseAudio = { PhraseAudio(floatArrayOf(0.25f), 24_000) },
    ) : NeuralSpeechEngine {
        override val sampleRate = 24_000
        val rendered = mutableListOf<String>()
        override fun generate(text: String): PhraseAudio {
            rendered += text
            return audio(text)
        }
        override fun close() = Unit
    }

    private fun speech(engine: FakeEngine): NeuralSpeech {
        val model = SpeechModel("test", "nl", "Test", "repo", "pin", "pocket", "model", listOf(SpeechModelFile("model", 1)))
        val store = SpeechModels(temporary.newFolder(), listOf(model))
        File(store.directory(model), "model").apply { parentFile!!.mkdirs(); writeText("x") }
        return NeuralSpeech(store) { _, _ -> engine }
    }

    private fun u16(bytes: ByteArray, offset: Int) = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).getShort(offset).toInt() and 0xffff
    private fun u32(bytes: ByteArray, offset: Int) = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).getInt(offset)
    private fun fourcc(bytes: ByteArray, offset: Int) = String(bytes, offset, 4, Charset.forName("US-ASCII"))

    @Test fun emptyPhraseInputProducesSixteenBytesOfSilentPcm() {
        val engine = FakeEngine()
        val speech = speech(engine)
        val file = temporary.newFile()

        speech.synthesize(speechModel(), " ... ! ", file) { false }

        val wav = file.readBytes()
        assertEquals(60, wav.size)
        assertEquals("RIFF", fourcc(wav, 0))
        assertEquals(52, u32(wav, 4))
        assertEquals("WAVE", fourcc(wav, 8))
        assertEquals(16, u32(wav, 40))
        assertTrue(wav.copyOfRange(44, 60).all { it == 0.toByte() })
        assertTrue(engine.rendered.isEmpty())
        speech.close()
    }

    @Test fun cancellationBeforeFirstRenderLeavesOnlyPlaceholderHeader() {
        val engine = FakeEngine()
        val speech = speech(engine)
        val file = temporary.newFile()

        speech.synthesize(speechModel(), "Hallo wereld.", file) { true }

        assertEquals(44, file.length())
        assertTrue(engine.rendered.isEmpty())
        speech.close()
    }

    @Test fun emptyEngineAudioIsRejected() {
        val engine = FakeEngine { PhraseAudio(floatArrayOf(), 24_000) }
        val speech = speech(engine)
        val file = temporary.newFile()

        val failure = runCatching { speech.synthesize(speechModel(), "Hallo.", file) { false } }.exceptionOrNull()

        assertTrue(failure is IllegalStateException)
        assertEquals(listOf("Hallo."), engine.rendered)
        speech.close()
    }

    @Test fun longMultiPhraseOutputConcatenatesClampedPcmAndWritesConsistentHeader() {
        val engine = FakeEngine { PhraseAudio(floatArrayOf(1.5f, -1.5f, 0.5f), 24_000) }
        val speech = speech(engine)
        val file = temporary.newFile()
        val text = "word ".repeat(80)

        speech.synthesize(speechModel(), text, file) { false }

        val wav = file.readBytes()
        val phraseCount = NeuralSpeech.phrases(text).size
        val dataSize = phraseCount * 3 * 2
        assertTrue(phraseCount > 1)
        assertEquals(phraseCount, engine.rendered.size)
        assertEquals("RIFF", fourcc(wav, 0)); assertEquals(dataSize + 36, u32(wav, 4))
        assertEquals("WAVE", fourcc(wav, 8)); assertEquals("fmt ", fourcc(wav, 12))
        assertEquals(16, u32(wav, 16)); assertEquals(1, u16(wav, 20)); assertEquals(1, u16(wav, 22))
        assertEquals(24_000, u32(wav, 24)); assertEquals(48_000, u32(wav, 28))
        assertEquals(2, u16(wav, 32)); assertEquals(16, u16(wav, 34))
        assertEquals("data", fourcc(wav, 36)); assertEquals(dataSize, u32(wav, 40)); assertEquals(44 + dataSize, wav.size)
        val samples = ByteBuffer.wrap(wav, 44, dataSize).order(ByteOrder.LITTLE_ENDIAN)
        repeat(phraseCount) {
            assertEquals(32767, samples.short.toInt())
            assertEquals(-32767, samples.short.toInt())
            assertEquals((0.5f * 32767).toInt(), samples.short.toInt())
        }
        speech.close()
    }

    @Test fun phraseSynthesisChecksCancellationBeforeRendering() {
        val engine = FakeEngine()
        val speech = speech(engine)
        val directory = temporary.newFolder()

        speech.synthesizePhrases(speechModel(), "Hallo wereld.", directory, "cancel", { true }) { _, _, _ ->
            throw AssertionError("Cancelled phrase was delivered")
        }

        assertTrue(engine.rendered.isEmpty())
        assertTrue(directory.listFiles().orEmpty().isEmpty())
        speech.close()
    }

    @Test fun phraseRenderFailureRemovesIncompleteOutputAndPropagates() {
        val failure = IllegalArgumentException("render failed")
        val engine = FakeEngine { throw failure }
        val speech = speech(engine)
        val directory = temporary.newFolder()

        val observed = runCatching {
            speech.synthesizePhrases(speechModel(), "Hallo.", directory, "failed", { false }) { _, _, _ -> }
        }.exceptionOrNull()

        assertTrue(observed === failure)
        assertFalse(File(directory, "failed-0.wav").exists())
        speech.close()
    }

    private fun speechModel() = SpeechModel("test", "nl", "Test", "repo", "pin", "pocket", "model", listOf(SpeechModelFile("model", 1)))
}
