package app.bookstr.speech

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class NeuralSpeechLifecycleTest {
    @get:Rule val temporary = TemporaryFolder()
    private fun model(id: String) = SpeechModel(id, "nl", id, "repo", "pin", "pocket", "model", listOf(SpeechModelFile("model", 1)))
    private class Engine : NeuralSpeechEngine {
        override val sampleRate = 24_000
        var closed = false
        var calls = 0
        var samples = floatArrayOf(-0.5f, 0.5f)
        override fun generate(text: String): PhraseAudio { calls++; return PhraseAudio(samples, sampleRate) }
        override fun close() { closed = true }
    }
    @Test fun reusesEngineThenClosesOnVoiceSwitchAndExplicitClose() {
        val first = model("pocket"); val second = model("piper")
        val store = SpeechModels(temporary.newFolder(), listOf(first, second))
        for (model in store.models) File(store.directory(model), "model").apply { parentFile!!.mkdirs(); writeText("x") }
        val engines = mutableListOf<Engine>()
        val speech = NeuralSpeech(store) { _, _ -> Engine().also { engines += it } }
        val wav = temporary.newFile()
        speech.synthesize(first, "Hallo.", wav) { false }
        speech.synthesize(first, "Nog een zin.", wav) { false }
        assertEquals(1, engines.size); assertEquals(2, engines.single().calls)
        assertEquals(24_000, ByteBuffer.wrap(wav.readBytes()).order(ByteOrder.LITTLE_ENDIAN).getInt(24))
        speech.synthesize(second, "Dag.", wav) { false }
        assertTrue(engines.first().closed); assertFalse(engines.last().closed)
        speech.close(); speech.close()
        assertTrue(engines.last().closed)
        speech.synthesize(first, "Terug.", wav) { false }
        assertEquals(3, engines.size)
        speech.close()
    }
    @Test fun missingModelAndFailedFactoryCanBeRetried() {
        val model = model("pocket")
        val store = SpeechModels(temporary.newFolder(), listOf(model))
        var fail = true
        var calls = 0
        val speech = NeuralSpeech(store) { _, _ -> calls++; check(!fail); Engine() }
        val wav = temporary.newFile()
        assertTrue(runCatching { speech.synthesize(model, "Hallo", wav) { false } }.isFailure)
        assertEquals(0, calls)
        File(store.directory(model), "model").apply { parentFile!!.mkdirs(); writeText("x") }
        assertTrue(runCatching { speech.synthesize(model, "Hallo", wav) { false } }.isFailure)
        fail = false
        speech.synthesize(model, "Hallo", wav) { false }
        assertEquals(2, calls)
        speech.close()
    }
    @Test fun phrasesKeepReaderOffsetsAndDiscardAudioAfterCancellation() {
        val model = model("pocket")
        val store = SpeechModels(temporary.newFolder(), listOf(model))
        File(store.directory(model), "model").apply { parentFile!!.mkdirs(); writeText("x") }
        val engine = Engine()
        val speech = NeuralSpeech(store) { _, _ -> engine }
        val output = temporary.newFolder()
        val phrases = mutableListOf<String>()
        speech.synthesizePhrases(model, "Dit is Nederlands.", output, "first", { false }) { _, phrase, file ->
            phrases += phrase
            assertTrue(file.length() > 44)
        }
        assertEquals(listOf("Dit is Nederlands."), phrases)
        speech.synthesizePhrases(model, "Hallo", output, "cancelled", { engine.calls >= 2 }) { _, _, _ -> fail("Cancelled audio delivered") }
        assertFalse(File(output, "cancelled-0.wav").exists())
        engine.samples = floatArrayOf()
        assertTrue(runCatching { speech.synthesizePhrases(model, "Hallo", output, "empty", { false }) { _, _, _ -> } }.isFailure)
        assertFalse(File(output, "empty-0.wav").exists())
        speech.close()
    }
}
