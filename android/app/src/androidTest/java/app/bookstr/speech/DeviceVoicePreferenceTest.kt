package app.bookstr.speech

import android.content.Context
import android.content.ContextWrapper
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import androidx.test.core.app.ApplicationProvider
import app.bookstr.NarrationService
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.Locale

class DeviceVoicePreferenceTest {
    private class Engine(context: Context) : TextToSpeech(context, {}) {
        val dutch = Voice("Dutch device voice", Locale.forLanguageTag("nl-NL"), Voice.QUALITY_HIGH, Voice.LATENCY_NORMAL, false, emptySet())
        var selected: Voice? = null
        var text: String? = null
        var selectedLocale: Locale? = null
        override fun getVoices(): Set<Voice> = setOf(dutch)
        override fun setVoice(voice: Voice): Int { selected = voice; return SUCCESS }
        override fun isLanguageAvailable(locale: Locale): Int = LANG_AVAILABLE
        override fun setLanguage(locale: Locale): Int { selectedLocale = locale; return LANG_AVAILABLE }
        override fun synthesizeToFile(text: CharSequence, params: android.os.Bundle, file: File, utteranceId: String): Int {
            this.text = text.toString(); return SUCCESS
        }
    }
    @Test fun supersededNeuralFailuresAreDiscardedAndCurrentFailuresStopPlayback() {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val settings = SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        val before = settings.voice("nl")
        val root = File(app.cacheDir, "missing-neural-fixture").apply { deleteRecursively(); mkdirs() }
        val gate = java.util.concurrent.CountDownLatch(1)
        lateinit var service: NarrationService
        lateinit var engine: Engine
        lateinit var executor: java.util.concurrent.ExecutorService
        lateinit var session: android.support.v4.media.session.MediaSessionCompat
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        fun field(name: String) = NarrationService::class.java.getDeclaredField(name).apply { isAccessible = true }
        try {
            instrumentation.runOnMainSync {
                service = NarrationService()
                ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java).apply { isAccessible = true }.invoke(service, app)
                field("speechModels\$delegate").set(service, lazy { SpeechModels(root, SpeechModels(app).models) })
                engine = Engine(app); field("textToSpeech").set(service, engine)
                session = android.support.v4.media.session.MediaSessionCompat(app, "speech-failure-test")
                field("mediaSession").set(service, session)
                field("speechLanguage").set(service, "nl")
                field("speechText").set(service, "Hallo wereld.")
                settings.setVoice("nl", "piper_nl_nl_dii")
                executor = field("neuralExecutor").get(service) as java.util.concurrent.ExecutorService
                executor.execute { gate.await(10, java.util.concurrent.TimeUnit.SECONDS) }
                val start = NarrationService::class.java.getDeclaredMethod("startSpeakingAt", Int::class.javaPrimitiveType).apply { isAccessible = true }
                start.invoke(service, 0)
                field("speechText").set(service, "Volgende tekst.")
                start.invoke(service, 0)
            }
            gate.countDown()
            executor.submit {}.get(10, java.util.concurrent.TimeUnit.SECONDS)
            instrumentation.runOnMainSync {
                assertEquals(3, field("generation").getInt(service))
                assertEquals(android.support.v4.media.session.PlaybackStateCompat.STATE_ERROR, session.controller.playbackState?.state)
                assertTrue((field("audioFiles").get(service) as Map<*, *>).isEmpty())
            }
        } finally {
            gate.countDown()
            instrumentation.runOnMainSync { engine.shutdown(); session.release(); settings.setVoice("nl", before) }
            executor.shutdown(); root.deleteRecursively()
        }
    }
    @Test fun appliesDevicePreferenceToSynthesisAndKeepsNeuralIndependentOfSystemInitialization() {
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().runOnMainSync {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val service = NarrationService()
        ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java).apply { isAccessible = true }.invoke(service, app)
        fun field(name: String, value: Any) { NarrationService::class.java.getDeclaredField(name).apply { isAccessible = true }.set(service, value) }
        val settings = SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        val before = settings.voice("nl")
        val engine = Engine(app)
        try {
            settings.setVoice("nl", engine.dutch.name)
            field("textToSpeech", engine); field("speechLanguage", "nl"); field("speechText", "Hallo wereld.")
            NarrationService::class.java.getDeclaredMethod("startSpeakingAt", Int::class.javaPrimitiveType).apply { isAccessible = true }.invoke(service, 0)
            assertEquals(engine.dutch, engine.selected); assertEquals("Hallo wereld.", engine.text)
            settings.setVoice("nl", "uninstalled")
            NarrationService::class.java.getDeclaredMethod("selectVoice", TextToSpeech::class.java, String::class.java).apply { isAccessible = true }.invoke(service, engine, "nl")
            assertEquals("nl", engine.selectedLocale?.language)
            settings.setVoice("nl", "piper_nl_nl_dii")
            service.onInit(TextToSpeech.ERROR)
        } finally { engine.shutdown(); settings.setVoice("nl", before) }
        }
    }
}
