package app.bookstr.speech

import android.app.Application
import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import app.bookstr.NarrationService
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class NarrationVoicePreferenceTest {
    private class Engine(context: Context) : TextToSpeech(context, {}) {
        val dutch = Voice("Dutch device voice", Locale.forLanguageTag("nl-NL"), Voice.QUALITY_HIGH, Voice.LATENCY_NORMAL, false, emptySet())
        var selected: Voice? = null
        var selectedLocale: Locale? = null
        override fun getVoices(): Set<Voice> = setOf(dutch)
        override fun setVoice(voice: Voice): Int { selected = voice; return SUCCESS }
        override fun isLanguageAvailable(locale: Locale): Int = LANG_AVAILABLE
        override fun setLanguage(locale: Locale): Int { selectedLocale = locale; return LANG_AVAILABLE }
    }
    @Test fun missingNeuralVoiceReportsAnErrorAndStoppedSynthesisCannotReportStaleErrors() {
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        val settings = SpeechSettings(service.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        settings.setVoice("nl", "piper_nl_nl_dii")
        fun speak() = service.onStartCommand(android.content.Intent().setAction("app.bookstr.action.NARRATION_SPEAK")
            .putExtra("text", "Hallo wereld.").putExtra("language", "nl").putExtra("book_id", "test"), 0, 1)
        fun drain() {
            val executor = NarrationService::class.java.getDeclaredField("neuralExecutor").apply { isAccessible = true }.get(service) as java.util.concurrent.ExecutorService
            executor.submit {}.get(5, java.util.concurrent.TimeUnit.SECONDS)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        }
        val application = org.robolectric.Shadows.shadowOf(org.robolectric.RuntimeEnvironment.getApplication())
        try {
            speak(); drain()
            assertTrue(application.broadcastIntents.any { it.getStringExtra(NarrationService.EXTRA_MESSAGE)?.contains("could not read") == true })
            val before = application.broadcastIntents.size
            speak()
            service.onStartCommand(android.content.Intent().setAction("app.bookstr.action.NARRATION_STOP"), 0, 2)
            drain()
            assertFalse(application.broadcastIntents.drop(before).any { it.getStringExtra(NarrationService.EXTRA_MESSAGE)?.contains("could not read") == true })
            val engine = Engine(service)
            NarrationService::class.java.getDeclaredField("textToSpeech").apply { isAccessible = true }.set(service, engine)
            settings.setVoice("nl", engine.dutch.name)
            service.onInit(TextToSpeech.SUCCESS)
            speak()
            assertEquals(engine.dutch, engine.selected)
        } finally { controller.destroy() }
    }
    @Test fun selectedDeviceVoiceOverridesTheEngineDefaultAndMissingVoiceFallsBack() {
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        val settings = SpeechSettings(service.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        val engine = Engine(service)
        val select = NarrationService::class.java.getDeclaredMethod("selectVoice", TextToSpeech::class.java, String::class.java).apply { isAccessible = true }
        try {
            settings.setVoice("nl", engine.dutch.name)
            select.invoke(service, engine, "Dutch")
            assertEquals(engine.dutch, engine.selected)
            settings.setVoice("nl", "uninstalled voice")
            select.invoke(service, engine, "nl")
            assertEquals("nl", engine.selectedLocale?.language)
            settings.setVoice("nl", "piper_nl_nl_dii")
            NarrationService::class.java.getDeclaredField("speechLanguage").apply { isAccessible = true }.set(service, "nl")
            service.onInit(TextToSpeech.ERROR)
        } finally { engine.shutdown(); controller.destroy() }
    }
}
