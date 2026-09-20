package app.bookstr.speech

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class NeuralSpeechTest {
    @Test fun missingVoiceFailsBeforeNativeInitialization() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = SpeechModels(context)
        val speech = NeuralSpeech(store)
        val model = store.models.first().copy(id = "not-installed")
        val file = File(context.cacheDir, "missing-voice.wav")
        try { assertTrue(runCatching { speech.synthesize(model, "Hello", file) { false } }.isFailure) }
        finally { speech.close(); file.delete() }
    }

    @Test fun downloadedNeuralVoicesGeneratePlayablePcm() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = SpeechModels(context)
        val ids = InstrumentationRegistry.getArguments().getString("speechModelIds", "piper_nl_nl_dii,kokoro_en").split(',')
        val neural = NeuralSpeech(store)
        val file = File(context.cacheDir, "speech-regression.wav")
        try {
            for (id in ids) {
                val model = store.models.first { it.id == id }
                if (!store.installed(model)) store.install(model) {}
                assertTrue(store.installed(model))
                neural.synthesize(model, when (model.language) {
                    "nl" -> "Hallo, dit is een Nederlands boek. Vandaag lezen we samen."
                    "pt-pt" -> "Hoje estamos a ler um livro juntos."
                    "fr" -> "Aujourd’hui nous lisons un livre ensemble."
                    "de" -> "Heute lesen wir zusammen ein Buch."
                    "es" -> "Hoy estamos leyendo un libro juntos."
                    "ca" -> "Avui llegim un llibre junts."
                    else -> "Today we are reading a book together."
                }, file) { false }
                val data = file.readBytes()
                assertEquals("RIFF", String(data, 0, 4)); assertEquals("WAVE", String(data, 8, 4))
                val buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
                assertEquals(data.size - 44, buffer.getInt(40)); assertTrue(buffer.getInt(24) > 16000)
                assertTrue(data.size > 10000)
                assertTrue(data.drop(44).any { it != 0.toByte() })
                neural.synthesize(model, "...", file) { false }
                assertEquals(60L, file.length())
                neural.synthesize(model, "Cancel this phrase.", file) { true }
                assertEquals(44L, file.length())
            }
        } finally { neural.close(); file.delete() }
    }
}
